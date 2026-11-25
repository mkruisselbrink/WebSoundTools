// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Multi-Stage Real-Time Acoustic Feedback & Ringing Detector coordinating unaveraged
 * spectral discriminators, phase-vocoder pitch stability, post-transient overhang detection,
 * sinusoidal crest/growth gating, closed-loop Reference tagging, and 5s latching.
 */

import {
  ISO_31_BAND_FREQUENCIES_HZ,
  findNearestIso31Band,
  formatIsoBandLabel,
  frequencyToMusicalNote,
} from '@foh/acoustics';
import {
  DEFAULT_LATCH_DURATION_MS,
  DetectedFeedbackTrack,
  FEEDBACK_PROFILES,
  FeedbackCulpritAttribution,
  FeedbackLoopLocation,
  FeedbackReferenceMode,
  FeedbackScratchBuffers,
  FeedbackSensitivityMode,
  FeedbackThresholdProfile,
  FeedbackTrackState,
  MAX_ACTIVE_TRACKS_PER_SLOT,
  MAX_RING_LOG_ENTRIES,
  MAX_VISIBLE_CALLOUT_FLAGS,
  computeTrackMatchToleranceHz,
  computeWindowAwareMinQ,
  scanSpectrumForCandidates,
} from './feedback-discriminators.js';
import {
  SpectrumPhaseHistory,
  TrackPitchStatsBuffer,
  createTrackPitchStatsBuffer,
  evaluateTrackPitchStability,
  pushTrackPitchSample,
} from './feedback-phase-tracker.js';

export {
  DEFAULT_LATCH_DURATION_MS,
  FEEDBACK_PROFILES,
  ISO_31_BAND_FREQUENCIES_HZ,
  MAX_ACTIVE_TRACKS_PER_SLOT,
  MAX_RING_LOG_ENTRIES,
  MAX_VISIBLE_CALLOUT_FLAGS,
  computeTrackMatchToleranceHz,
  computeWindowAwareMinQ,
  findNearestIso31Band,
  formatIsoBandLabel,
  frequencyToMusicalNote,
};
export type {
  DetectedFeedbackTrack,
  FeedbackCulpritAttribution,
  FeedbackLoopLocation,
  FeedbackReferenceMode,
  FeedbackSensitivityMode,
  FeedbackThresholdProfile,
  FeedbackTrackState,
};

interface InternalTrack {
  id: string;
  frequencyHz: number;
  prominenceDb: number;
  initialProminenceDb: number;
  initialLevelDbFs: number;
  maxBgLevelDbFs: number;
  peakLevelDb: number;
  estimatedQ: number;
  consecutiveFrames: number;
  risingFrames: number;
  lastLevelDbFs: number;
  durationMs: number;
  firstDetectedAt: string;
  firstOnsetSeq: number;
  state: 'candidate' | FeedbackTrackState;
  loopLocation?: FeedbackLoopLocation;
  latchElapsedMs: number;
  matchedInCurrentFrame: boolean;
  powerWindow: Float32Array;
  powerIndex: number;
  powerCount: number;
  pitchStats: TrackPitchStatsBuffer;
}

export interface FeedbackDetectorProcessParams {
  readonly slotId: string;
  readonly slotName: string;
  readonly slotColor: string;
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly splOffsetDb: number;
  readonly dtMs?: number;
  /** Unaveraged complex FFT spectrum of Measurement channel (preferred over `module`) */
  readonly specMRe?: Float32Array;
  readonly specMIm?: Float32Array;
  /** Unaveraged complex FFT spectrum of Reference channel */
  readonly specRRe?: Float32Array;
  readonly specRIm?: Float32Array;
  /** Number of new time-domain samples elapsed since previous frame (enables phase-vocoder tracking) */
  readonly hopSamples?: number;
  /** Fallback linear RMS magnitude spectrum when raw complex FFT arrays are not supplied */
  readonly module: Float32Array;
  readonly refModule?: Float32Array;
  readonly referenceRmsDb?: number;
  readonly refMode?: FeedbackReferenceMode;
  readonly nowTimeStr?: string;
}

export class FeedbackDetector {
  private mode: FeedbackSensitivityMode = 'foh-normal';
  private refMode: FeedbackReferenceMode | undefined;
  private customProfile: FeedbackThresholdProfile = { ...FEEDBACK_PROFILES.custom };
  private readonly scratch: FeedbackScratchBuffers = {
    instModule: new Float32Array(0),
    instRefModule: new Float32Array(0),
    bgModule: new Float32Array(0),
    bgRef: new Float32Array(0),
    prefixPowerM: new Float64Array(0),
    prefixPowerR: new Float64Array(0),
    promDbScratch: new Float32Array(0),
  };
  private readonly phaseHistory = new SpectrumPhaseHistory();
  private tracks: InternalTrack[] = [];
  private nextTrackSeq = 1;
  private frameSeq = 0;

  constructor(
    mode: FeedbackSensitivityMode = 'foh-normal',
    refMode?: FeedbackReferenceMode
  ) {
    this.mode = mode;
    this.refMode = refMode;
  }

  setMode(mode: FeedbackSensitivityMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      if (mode === 'off') {
        this.tracks = [];
        this.phaseHistory.reset();
      }
    }
  }

  getMode(): FeedbackSensitivityMode {
    return this.mode;
  }

  setRefMode(refMode: FeedbackReferenceMode | undefined): void {
    this.refMode = refMode;
  }

  getRefMode(): FeedbackReferenceMode | undefined {
    return this.refMode;
  }

  setCustomProfile(partial: Partial<FeedbackThresholdProfile>): void {
    this.customProfile = { ...this.customProfile, ...partial };
  }

  getActiveProfile(): FeedbackThresholdProfile | null {
    if (this.mode === 'off') {
      return null;
    }
    if (this.mode === 'custom') {
      return this.customProfile;
    }
    return FEEDBACK_PROFILES[this.mode];
  }

  reset(): void {
    this.tracks = [];
    this.phaseHistory.reset();
  }

  processFrame(params: FeedbackDetectorProcessParams): DetectedFeedbackTrack[] {
    const profile = this.getActiveProfile();
    if (!profile) {
      return [];
    }

    const {
      slotId,
      slotName,
      slotColor,
      sampleRate,
      fftSize,
      splOffsetDb,
      specMRe,
      specMIm,
      specRRe,
      specRIm,
    } = params;
    const dtMs = params.dtMs ?? 40;
    const hasComplexM =
      specMRe !== undefined &&
      specMIm !== undefined &&
      specMRe.length === specMIm.length &&
      specMRe.length >= 8;

    const binCount = hasComplexM ? specMRe.length : params.module.length;
    if (binCount < 8 || fftSize <= 0 || sampleRate <= 0) {
      return [];
    }

    // If complex spectra were passed with hopSamples === 0 (no new audio arrived), return current snapshot without advancing counters
    if (hasComplexM && params.hopSamples !== undefined && params.hopSamples <= 0) {
      return this.exportTracks(slotId, slotName, slotColor, profile);
    }

    this.frameSeq++;
    const df = sampleRate / fftSize;

    if (this.scratch.bgModule.length !== binCount) {
      this.scratch.instModule = new Float32Array(binCount);
      this.scratch.instRefModule = new Float32Array(binCount);
      this.scratch.bgModule = new Float32Array(binCount);
      this.scratch.bgRef = new Float32Array(binCount);
      this.scratch.prefixPowerM = new Float64Array(binCount + 1);
      this.scratch.prefixPowerR = new Float64Array(binCount + 1);
      this.scratch.promDbScratch = new Float32Array(binCount);
    }

    let activeModule = params.module;
    if (hasComplexM) {
      const outM = this.scratch.instModule;
      for (let k = 0; k < binCount; k++) {
        const re = specMRe[k];
        const im = specMIm[k];
        outM[k] = Math.sqrt(0.5 * (re * re + im * im));
      }
      activeModule = outM;
    }

    let activeRefModule = params.refModule;
    if (
      specRRe !== undefined &&
      specRIm !== undefined &&
      specRRe.length === binCount &&
      specRIm.length === binCount
    ) {
      const outR = this.scratch.instRefModule;
      for (let k = 0; k < binCount; k++) {
        const re = specRRe[k];
        const im = specRIm[k];
        outR[k] = Math.sqrt(0.5 * (re * re + im * im));
      }
      activeRefModule = outR;
    }

    const effectiveRefMode = params.refMode ?? this.refMode;
    const { candidates } = scanSpectrumForCandidates({
      module: activeModule,
      refModule: activeRefModule,
      referenceRmsDb: params.referenceRmsDb,
      df,
      profile,
      refMode: effectiveRefMode,
      scratch: this.scratch,
    });

    for (const track of this.tracks) {
      track.matchedInCurrentFrame = false;
    }

    const hopSamples = params.hopSamples ?? Math.round((dtMs * sampleRate) / 1000);
    const nowTimeStr = params.nowTimeStr ?? new Date().toTimeString().slice(0, 8);

    for (const cand of candidates) {
      let instFreqHz = cand.frequencyHz;
      let phaseStepCos = 1.0;
      let hasPhaseLockSample = false;

      if (hasComplexM) {
        const phaseEst = this.phaseHistory.refinePeak({
          binIndex: cand.binIndex,
          parabolicDelta: cand.parabolicDelta,
          curRe: specMRe,
          curIm: specMIm,
          fftSize,
          sampleRate,
          hopSamples,
        });
        instFreqHz = phaseEst.refinedFreqHz;
        phaseStepCos = phaseEst.phaseStepCos;
        hasPhaseLockSample = phaseEst.hasPhaseLockSample;
      }

      const tolHz = computeTrackMatchToleranceHz(instFreqHz, df);
      let matchedTrack: InternalTrack | null = null;
      let bestDist = Infinity;

      for (const track of this.tracks) {
        if (track.matchedInCurrentFrame) continue;
        const dist = Math.abs(track.frequencyHz - instFreqHz);
        if (dist <= tolHz && dist < bestDist) {
          bestDist = dist;
          matchedTrack = track;
        }
      }

      if (matchedTrack) {
        matchedTrack.matchedInCurrentFrame = true;
        matchedTrack.frequencyHz = 0.35 * matchedTrack.frequencyHz + 0.65 * instFreqHz;
        matchedTrack.prominenceDb = cand.prominenceDb;
        matchedTrack.peakLevelDb = cand.peakLevelDbFs + splOffsetDb;
        matchedTrack.estimatedQ = 0.4 * matchedTrack.estimatedQ + 0.6 * cand.estimatedQ;
        matchedTrack.consecutiveFrames++;
        if (cand.peakLevelDbFs >= matchedTrack.lastLevelDbFs - 0.15) {
          matchedTrack.risingFrames++;
        } else {
          matchedTrack.risingFrames = Math.max(0, matchedTrack.risingFrames - 1);
        }
        matchedTrack.lastLevelDbFs = cand.peakLevelDbFs;
        if (cand.bgLevelDbFs > matchedTrack.maxBgLevelDbFs) {
          matchedTrack.maxBgLevelDbFs = cand.bgLevelDbFs;
        }
        if (cand.loopLocation) {
          matchedTrack.loopLocation = cand.loopLocation;
        }
        matchedTrack.durationMs += dtMs;
        matchedTrack.latchElapsedMs = 0;

        matchedTrack.powerWindow[matchedTrack.powerIndex] = cand.powerLinear;
        matchedTrack.powerIndex =
          (matchedTrack.powerIndex + 1) % matchedTrack.powerWindow.length;
        if (matchedTrack.powerCount < matchedTrack.powerWindow.length) {
          matchedTrack.powerCount++;
        }

        pushTrackPitchSample(
          matchedTrack.pitchStats,
          instFreqHz,
          phaseStepCos,
          hasPhaseLockSample
        );

        this.evaluateTrackStatePromotion(matchedTrack, cand, profile, hasComplexM);
      } else {
        const powerWindow = new Float32Array(6);
        powerWindow[0] = cand.powerLinear;
        const newTrack: InternalTrack = {
          id: `${slotId}-fb-${this.nextTrackSeq++}`,
          frequencyHz: instFreqHz,
          prominenceDb: cand.prominenceDb,
          initialProminenceDb: cand.prominenceDb,
          initialLevelDbFs: cand.peakLevelDbFs,
          maxBgLevelDbFs: cand.bgLevelDbFs,
          peakLevelDb: cand.peakLevelDbFs + splOffsetDb,
          estimatedQ: cand.estimatedQ,
          consecutiveFrames: 1,
          risingFrames: 1,
          lastLevelDbFs: cand.peakLevelDbFs,
          durationMs: dtMs,
          firstDetectedAt: nowTimeStr,
          firstOnsetSeq: this.frameSeq,
          state: profile.onsetFrames <= 1 ? 'ringing' : 'candidate',
          loopLocation: cand.loopLocation,
          latchElapsedMs: 0,
          matchedInCurrentFrame: true,
          powerWindow,
          powerIndex: 1,
          powerCount: 1,
          pitchStats: createTrackPitchStatsBuffer(instFreqHz),
        };
        this.tracks.push(newTrack);
      }
    }

    if (hasComplexM) {
      this.phaseHistory.commitSpectrum(specMRe, specMIm, fftSize, sampleRate);
    }

    const survivingTracks: InternalTrack[] = [];
    for (const track of this.tracks) {
      if (track.matchedInCurrentFrame) {
        survivingTracks.push(track);
        continue;
      }
      if (track.state === 'candidate') {
        continue;
      }
      track.state = 'latched';
      track.latchElapsedMs += dtMs;
      if (track.latchElapsedMs < profile.latchDurationMs) {
        survivingTracks.push(track);
      }
    }

    const stateRank = (s: InternalTrack['state']): number =>
      s === 'feedback' ? 3 : s === 'ringing' ? 2 : s === 'latched' ? 1 : 0;

    survivingTracks.sort((a, b) => {
      const rankDiff = stateRank(b.state) - stateRank(a.state);
      return rankDiff !== 0 ? rankDiff : b.prominenceDb - a.prominenceDb;
    });

    this.tracks = survivingTracks.slice(0, MAX_ACTIVE_TRACKS_PER_SLOT * 2);
    return this.exportTracks(slotId, slotName, slotColor, profile);
  }

  /** Returns true if any candidate, active, or latched narrowband peak is currently tracked. */
  hasAnyCandidateOrActiveTrack(): boolean {
    return this.tracks.some((t) => t.matchedInCurrentFrame);
  }

  /** Returns the earliest frame sequence when an active track around `freqHz` began (for onset-lead culprit ranking). */
  getTrackOnsetSeqNear(freqHz: number, toleranceHz: number): number | undefined {
    let earliest: number | undefined;
    for (const t of this.tracks) {
      if (t.state === 'candidate') continue;
      if (Math.abs(t.frequencyHz - freqHz) <= toleranceHz) {
        if (earliest === undefined || t.firstOnsetSeq < earliest) {
          earliest = t.firstOnsetSeq;
        }
      }
    }
    return earliest;
  }

  private evaluateTrackStatePromotion(
    track: InternalTrack,
    cand: {
      readonly prominenceDb: number;
      readonly peakLevelDbFs: number;
      readonly bgLevelDbFs: number;
    },
    profile: FeedbackThresholdProfile,
    hasComplexPhase: boolean
  ): void {
    const { pitchStdCents, phaseCoherence } = evaluateTrackPitchStability(track.pitchStats);

    if (hasComplexPhase && track.pitchStats.phaseSampleCount >= 2) {
      if (
        pitchStdCents > profile.maxPitchStdCents ||
        phaseCoherence < profile.minPhaseCoherence
      ) {
        return;
      }
    }

    const crestDb = this.computeTrackCrestFactorDb(track);
    const levelGrowthDb = cand.peakLevelDbFs - track.initialLevelDbFs;
    const isMonotonicGrowth =
      track.risingFrames >= Math.max(3, track.consecutiveFrames - 1) &&
      levelGrowthDb >= 1.5;
    const isSteadyOrGrowing =
      (crestDb <= profile.maxCrestFactorDb && levelGrowthDb >= -3.0) ||
      isMonotonicGrowth;

    // Post-transient overhang: surrounding 1/3-octave background dropped >= 4.5 dB while narrowband ring hangs
    const bgDropDb = track.maxBgLevelDbFs - cand.bgLevelDbFs;
    const prominenceJumpDb = cand.prominenceDb - track.initialProminenceDb;
    const isPostTransientOverhang =
      bgDropDb >= 4.5 &&
      prominenceJumpDb >= 3.5 &&
      cand.peakLevelDbFs >= track.initialLevelDbFs - 6.0;

    if (
      track.consecutiveFrames >= profile.onsetFrames &&
      cand.prominenceDb >= profile.feedbackProminenceDb &&
      isSteadyOrGrowing
    ) {
      track.state = 'feedback';
      return;
    }

    if (track.state === 'feedback') {
      return;
    }

    const overhangFrames = Math.max(2, profile.onsetFrames - 1);
    const steadyRingingFrames =
      this.mode === 'foh-normal' ? profile.onsetFrames + 2 : profile.onsetFrames;

    if (
      (isPostTransientOverhang && track.consecutiveFrames >= overhangFrames) ||
      (track.consecutiveFrames >= steadyRingingFrames && isSteadyOrGrowing)
    ) {
      track.state = 'ringing';
    }
  }

  private exportTracks(
    slotId: string,
    slotName: string,
    slotColor: string,
    profile: FeedbackThresholdProfile
  ): DetectedFeedbackTrack[] {
    const output: DetectedFeedbackTrack[] = [];
    for (const track of this.tracks) {
      if (track.state === 'candidate') continue;
      const { isoBandHz, isoBandLabel } = findNearestIso31Band(track.frequencyHz);
      const latchRatio =
        track.state === 'latched'
          ? Math.max(0, 1.0 - track.latchElapsedMs / Math.max(1, profile.latchDurationMs))
          : 1.0;

      output.push({
        id: track.id,
        slotId,
        slotName,
        slotColor,
        state: track.state,
        frequencyHz: track.frequencyHz,
        isoBandHz,
        isoBandLabel,
        musicalNote: frequencyToMusicalNote(track.frequencyHz),
        prominenceDb: track.prominenceDb,
        peakLevelDb: track.peakLevelDb,
        estimatedQ: track.estimatedQ,
        durationMs: track.durationMs,
        firstDetectedAt: track.firstDetectedAt,
        latchRemainingRatio: latchRatio,
        ...(track.loopLocation ? { loopLocation: track.loopLocation } : {}),
      });

      if (output.length >= MAX_ACTIVE_TRACKS_PER_SLOT) {
        break;
      }
    }
    return output;
  }

  private computeTrackCrestFactorDb(track: InternalTrack): number {
    if (track.powerCount <= 0) {
      return 3.0;
    }
    let maxP = 0;
    let sumP = 0;
    for (let i = 0; i < track.powerCount; i++) {
      const p = track.powerWindow[i];
      if (p > maxP) maxP = p;
      sumP += p;
    }
    const meanP = sumP / track.powerCount;
    if (meanP <= 1e-24) {
      return 3.0;
    }
    return 3.0103 + 10.0 * Math.log10(Math.max(1.0, maxP / meanP));
  }
}
