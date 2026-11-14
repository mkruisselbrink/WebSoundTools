// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Multi-Stage Real-Time Acoustic Feedback & Ringing Detector coordinating spectral
 * discriminators with temporal track persistence, sinusoidal crest factor gating, and 5s latching.
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
  FeedbackSensitivityMode,
  FeedbackThresholdProfile,
  FeedbackTrackState,
};

interface InternalTrack {
  id: string;
  frequencyHz: number;
  prominenceDb: number;
  initialProminenceDb: number;
  peakLevelDb: number;
  estimatedQ: number;
  consecutiveFrames: number;
  durationMs: number;
  firstDetectedAt: string;
  state: 'candidate' | FeedbackTrackState;
  latchElapsedMs: number;
  matchedInCurrentFrame: boolean;
  powerWindow: Float32Array;
  powerIndex: number;
  powerCount: number;
}

export interface FeedbackDetectorProcessParams {
  readonly slotId: string;
  readonly slotName: string;
  readonly slotColor: string;
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly splOffsetDb: number;
  readonly dtMs?: number;
  readonly module: Float32Array;
  readonly refModule?: Float32Array;
  readonly referenceRmsDb?: number;
  readonly nowTimeStr?: string;
}

export class FeedbackDetector {
  private mode: FeedbackSensitivityMode = 'foh-normal';
  private customProfile: FeedbackThresholdProfile = { ...FEEDBACK_PROFILES.custom };
  private readonly scratch: FeedbackScratchBuffers = {
    bgModule: new Float32Array(0),
    bgRef: new Float32Array(0),
    prefixPowerM: new Float64Array(0),
    prefixPowerR: new Float64Array(0),
    promDbScratch: new Float32Array(0),
  };
  private tracks: InternalTrack[] = [];
  private nextTrackSeq = 1;

  constructor(mode: FeedbackSensitivityMode = 'foh-normal') {
    this.mode = mode;
  }

  setMode(mode: FeedbackSensitivityMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      if (mode === 'off') {
        this.tracks = [];
      }
    }
  }

  getMode(): FeedbackSensitivityMode {
    return this.mode;
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
      module,
      refModule,
    } = params;
    const dtMs = params.dtMs ?? 40;
    const binCount = module.length;
    if (binCount < 8 || fftSize <= 0 || sampleRate <= 0) {
      return [];
    }

    const df = sampleRate / fftSize;

    if (this.scratch.bgModule.length !== binCount) {
      this.scratch.bgModule = new Float32Array(binCount);
      this.scratch.bgRef = new Float32Array(binCount);
      this.scratch.prefixPowerM = new Float64Array(binCount + 1);
      this.scratch.prefixPowerR = new Float64Array(binCount + 1);
      this.scratch.promDbScratch = new Float32Array(binCount);
    }

    const { candidates, refEnergyActive } = scanSpectrumForCandidates({
      module,
      refModule,
      referenceRmsDb: params.referenceRmsDb,
      df,
      profile,
      scratch: this.scratch,
    });

    for (const track of this.tracks) {
      track.matchedInCurrentFrame = false;
    }

    const requiredOnsetFrames = refEnergyActive
      ? profile.onsetFrames
      : Math.ceil(profile.onsetFrames * 1.5);

    const nowTimeStr = params.nowTimeStr ?? new Date().toTimeString().slice(0, 8);

    for (const cand of candidates) {
      const tolHz = computeTrackMatchToleranceHz(cand.frequencyHz, df);
      let matchedTrack: InternalTrack | null = null;
      let bestDist = Infinity;

      for (const track of this.tracks) {
        if (track.matchedInCurrentFrame) continue;
        const dist = Math.abs(track.frequencyHz - cand.frequencyHz);
        if (dist <= tolHz && dist < bestDist) {
          bestDist = dist;
          matchedTrack = track;
        }
      }

      if (matchedTrack) {
        matchedTrack.matchedInCurrentFrame = true;
        matchedTrack.frequencyHz = 0.35 * matchedTrack.frequencyHz + 0.65 * cand.frequencyHz;
        matchedTrack.prominenceDb = cand.prominenceDb;
        matchedTrack.peakLevelDb = cand.peakLevelDbFs + splOffsetDb;
        matchedTrack.estimatedQ = 0.4 * matchedTrack.estimatedQ + 0.6 * cand.estimatedQ;
        matchedTrack.consecutiveFrames++;
        matchedTrack.durationMs += dtMs;
        matchedTrack.latchElapsedMs = 0;

        matchedTrack.powerWindow[matchedTrack.powerIndex] = cand.powerLinear;
        matchedTrack.powerIndex = (matchedTrack.powerIndex + 1) % matchedTrack.powerWindow.length;
        if (matchedTrack.powerCount < matchedTrack.powerWindow.length) {
          matchedTrack.powerCount++;
        }

        const crestDb = this.computeTrackCrestFactorDb(matchedTrack);
        const prominenceGrowthDb = cand.prominenceDb - matchedTrack.initialProminenceDb;

        if (matchedTrack.consecutiveFrames >= requiredOnsetFrames) {
          const qualifiesForFeedback =
            cand.prominenceDb >= profile.feedbackProminenceDb &&
            crestDb <= profile.maxCrestFactorDb &&
            (refEnergyActive ||
              prominenceGrowthDb >= 1.5 ||
              cand.prominenceDb >= profile.feedbackProminenceDb + 2.0);

          if (qualifiesForFeedback) {
            matchedTrack.state = 'feedback';
          } else if (matchedTrack.state !== 'feedback') {
            matchedTrack.state = 'ringing';
          }
        }
      } else {
        const powerWindow = new Float32Array(6);
        powerWindow[0] = cand.powerLinear;
        const newTrack: InternalTrack = {
          id: `${slotId}-fb-${this.nextTrackSeq++}`,
          frequencyHz: cand.frequencyHz,
          prominenceDb: cand.prominenceDb,
          initialProminenceDb: cand.prominenceDb,
          peakLevelDb: cand.peakLevelDbFs + splOffsetDb,
          estimatedQ: cand.estimatedQ,
          consecutiveFrames: 1,
          durationMs: dtMs,
          firstDetectedAt: nowTimeStr,
          state: requiredOnsetFrames <= 1 ? 'ringing' : 'candidate',
          latchElapsedMs: 0,
          matchedInCurrentFrame: true,
          powerWindow,
          powerIndex: 1,
          powerCount: 1,
        };
        this.tracks.push(newTrack);
      }
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

    const stateRank = (s: InternalTrack['state']): number => {
      if (s === 'feedback') return 3;
      if (s === 'ringing') return 2;
      if (s === 'latched') return 1;
      return 0;
    };

    survivingTracks.sort((a, b) => {
      const rankDiff = stateRank(b.state) - stateRank(a.state);
      if (rankDiff !== 0) return rankDiff;
      return b.prominenceDb - a.prominenceDb;
    });

    this.tracks = survivingTracks.slice(0, MAX_ACTIVE_TRACKS_PER_SLOT * 2);

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
