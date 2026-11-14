/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Multi-Stage Real-Time Acoustic Feedback & Ringing Detector (`src/dsp/feedback-detector.ts`).
 *
 * Combines 5 physical discriminators:
 *  1. Local Spectral Prominence above 1/3-Octave Smoothed Background Envelope
 *  2. 3-Point Parabolic Peak Interpolation & Window-Resolution-Aware Q Factor Gate
 *  3. Sinusoidal Bin Crest Factor Check
 *  4. Harmonic Series Veto (Overtone 2f0/3f0 & Subharmonic f0/2 Check)
 *  5. Dual-Channel M/R Reference Discriminator (with Single-Channel Fallback Mode)
 */

import { smoothMagnitudeOctave } from './smoothing.js';

export const MAX_ACTIVE_TRACKS_PER_SLOT = 6;
export const MAX_VISIBLE_CALLOUT_FLAGS = 8;
export const MAX_RING_LOG_ENTRIES = 50;
export const DEFAULT_LATCH_DURATION_MS = 5000;

export const ISO_31_BAND_FREQUENCIES_HZ: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500,
  16000, 20000,
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type FeedbackSensitivityMode =
  | 'off'
  | 'foh-normal'
  | 'monitor-sensitive'
  | 'custom';

export type FeedbackTrackState = 'ringing' | 'feedback' | 'latched';

export interface FeedbackThresholdProfile {
  readonly ringingProminenceDb: number;
  readonly feedbackProminenceDb: number;
  readonly minQ: number;
  readonly onsetFrames: number;
  readonly maxCrestFactorDb: number;
  readonly noiseGateDbFs: number;
  readonly refRejectionEnabled: boolean;
  readonly harmonicVetoEnabled: boolean;
  readonly latchDurationMs: number;
}

export const FEEDBACK_PROFILES: Record<
  Exclude<FeedbackSensitivityMode, 'off'>,
  FeedbackThresholdProfile
> = {
  'foh-normal': {
    ringingProminenceDb: 11.0,
    feedbackProminenceDb: 14.5,
    minQ: 12.0,
    onsetFrames: 4, // 160 ms @ 25 Hz (240 ms when R inactive)
    maxCrestFactorDb: 4.5,
    noiseGateDbFs: -55.0,
    refRejectionEnabled: true,
    harmonicVetoEnabled: true,
    latchDurationMs: DEFAULT_LATCH_DURATION_MS,
  },
  'monitor-sensitive': {
    ringingProminenceDb: 8.5,
    feedbackProminenceDb: 12.0,
    minQ: 8.0,
    onsetFrames: 2, // 80 ms @ 25 Hz (120 ms when R inactive)
    maxCrestFactorDb: 5.5,
    noiseGateDbFs: -60.0,
    refRejectionEnabled: true,
    harmonicVetoEnabled: true,
    latchDurationMs: DEFAULT_LATCH_DURATION_MS,
  },
  custom: {
    ringingProminenceDb: 10.0,
    feedbackProminenceDb: 13.5,
    minQ: 10.0,
    onsetFrames: 3,
    maxCrestFactorDb: 5.0,
    noiseGateDbFs: -55.0,
    refRejectionEnabled: true,
    harmonicVetoEnabled: true,
    latchDurationMs: DEFAULT_LATCH_DURATION_MS,
  },
};

export interface DetectedFeedbackTrack {
  readonly id: string;
  readonly slotId: string;
  readonly slotName: string;
  readonly slotColor: string;
  readonly state: FeedbackTrackState;
  readonly frequencyHz: number;
  readonly isoBandHz: number;
  readonly isoBandLabel: string;
  readonly musicalNote: string;
  readonly prominenceDb: number;
  readonly peakLevelDb: number;
  readonly estimatedQ: number;
  readonly durationMs: number;
  readonly firstDetectedAt: string;
  readonly latchRemainingRatio: number;
}

/**
 * Formats an ISO 31-band center frequency as a compact engineer-friendly label (e.g. "2.5 kHz", "630 Hz").
 */
export function formatIsoBandLabel(isoHz: number): string {
  if (isoHz >= 1000) {
    const k = isoHz / 1000;
    return Number.isInteger(k) ? `${k} kHz` : `${Number(k.toFixed(2))} kHz`;
  }
  return `${isoHz} Hz`;
}

/**
 * Maps any frequency `freqHz` to its nearest standard 31-band ISO 1/3-octave center frequency.
 */
export function findNearestIso31Band(freqHz: number): {
  isoBandHz: number;
  isoBandLabel: string;
} {
  const clamped = Math.max(20, Math.min(20000, freqHz));
  let bestHz = ISO_31_BAND_FREQUENCIES_HZ[0];
  let bestDist = Math.abs(Math.log2(clamped / bestHz));

  for (let i = 1; i < ISO_31_BAND_FREQUENCIES_HZ.length; i++) {
    const candidate = ISO_31_BAND_FREQUENCIES_HZ[i];
    const dist = Math.abs(Math.log2(clamped / candidate));
    if (dist < bestDist) {
      bestDist = dist;
      bestHz = candidate;
    }
  }
  return {
    isoBandHz: bestHz,
    isoBandLabel: formatIsoBandLabel(bestHz),
  };
}

/**
 * Converts a frequency in Hz (`A4 = 440 Hz`) to its musical note and cents deviation (e.g. `A4 (+0c)`, `D#7 (-8c)`).
 */
export function frequencyToMusicalNote(freqHz: number): string {
  if (!(freqHz > 0)) {
    return '—';
  }
  const exactMidi = 69 + 12 * Math.log2(freqHz / 440.0);
  const roundedMidi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - roundedMidi) * 100);
  const noteIndex = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteName = NOTE_NAMES[noteIndex];
  const sign = cents >= 0 ? '+' : '';
  return `${noteName}${octave} (${sign}${cents}c)`;
}

/**
 * Computes the bounded hybrid frequency matching tolerance in Hz for tracking a ring across frames:
 *   Δf_match(f0) = max(1.5 * df, min(f0 * (2^(1/24) - 1), 120 Hz))
 */
export function computeTrackMatchToleranceHz(freqHz: number, binWidthHz: number): number {
  const oneTwentyFourthOctave = freqHz * (Math.pow(2, 1 / 24) - 1);
  return Math.max(1.5 * binWidthHz, Math.min(oneTwentyFourthOctave, 120.0));
}

/**
 * Computes the FFT window-resolution-aware effective minimum Q threshold at `freqHz`.
 * At low frequencies and smaller FFT sizes (e.g. 4096 @ 48 kHz, Δf = 11.7 Hz), the Hann window's
 * own -3 dB main-lobe width (1.44 * Δf) bounds the maximum measurable Q of a pure sinusoid.
 */
export function computeWindowAwareMinQ(
  targetMinQ: number,
  freqHz: number,
  binWidthHz: number
): number {
  if (binWidthHz <= 0) {
    return targetMinQ;
  }
  const windowMaxResolvableQ = freqHz / (1.44 * binWidthHz);
  return Math.min(targetMinQ, Math.max(4.0, 0.55 * windowMaxResolvableQ));
}

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

interface CandidatePeak {
  binIndex: number;
  frequencyHz: number;
  prominenceDb: number;
  peakLevelDbFs: number;
  estimatedQ: number;
  powerLinear: number;
  hasHarmonicStructure: boolean;
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
  private bgModule: Float32Array = new Float32Array(0);
  private bgRef: Float32Array = new Float32Array(0);
  private prefixPowerM: Float64Array = new Float64Array(0);
  private prefixPowerR: Float64Array = new Float64Array(0);
  private promDbScratch: Float32Array = new Float32Array(0);
  private tracks: InternalTrack[] = [];
  private nextTrackSeq: number = 1;

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

    // Ensure zero-allocation scratch buffers match binCount
    if (this.bgModule.length !== binCount) {
      this.bgModule = new Float32Array(binCount);
      this.bgRef = new Float32Array(binCount);
      this.prefixPowerM = new Float64Array(binCount + 1);
      this.prefixPowerR = new Float64Array(binCount + 1);
      this.promDbScratch = new Float32Array(binCount);
    }

    // Stage 1: Compute 1/3-octave smoothed background envelope + guard-band-excluded prefix power
    // so narrow peaks at low frequencies (where 1/3-octave is only a few bins wide) never inflate their own background
    smoothMagnitudeOctave(module, this.bgModule, 3);
    this.prefixPowerM[0] = 0;
    for (let k = 0; k < binCount; k++) {
      const v = module[k];
      this.prefixPowerM[k + 1] = this.prefixPowerM[k] + v * v;
    }

    const hasActiveRef =
      refModule !== undefined &&
      refModule.length === binCount &&
      (params.referenceRmsDb === undefined || params.referenceRmsDb > -55.0);

    let refEnergyActive = false;
    if (hasActiveRef && refModule) {
      let maxRef = 0;
      for (let k = 1; k < binCount; k++) {
        if (refModule[k] > maxRef) maxRef = refModule[k];
      }
      if (maxRef > 1e-3) {
        refEnergyActive = true;
        smoothMagnitudeOctave(refModule, this.bgRef, 3);
        this.prefixPowerR[0] = 0;
        for (let k = 0; k < binCount; k++) {
          const v = refModule[k];
          this.prefixPowerR[k + 1] = this.prefixPowerR[k] + v * v;
        }
      }
    }

    const minBin = Math.max(2, Math.ceil(60.0 / df));
    const maxBin = Math.min(binCount - 3, Math.floor(16000.0 / df));
    const EPS = 1e-12;

    // Precompute local prominence in dB across the passband so Harmonic Veto is O(1) per candidate
    this.promDbScratch.fill(0);
    for (let k = 1; k < binCount - 1; k++) {
      const mVal = module[k];
      const bgVal = this.computeGuardExcludedBackground(k, this.bgModule[k], this.prefixPowerM, binCount);
      if (mVal > EPS && bgVal > EPS) {
        this.promDbScratch[k] = 20.0 * Math.log10(mVal / bgVal);
      }
    }

    const candidates: CandidatePeak[] = [];

    for (let k = minBin; k <= maxBin; k++) {
      const magC = module[k];
      const magL = module[k - 1];
      const magR = module[k + 1];

      // Local maximum check
      if (!(magC > magL && magC >= magR && magC > EPS)) {
        continue;
      }

      const levelDbFs = 20.0 * Math.log10(magC);
      if (levelDbFs < profile.noiseGateDbFs) {
        continue;
      }

      const promDb = this.promDbScratch[k];
      if (promDb < profile.ringingProminenceDb) {
        continue;
      }

      // Stage 4 (early check when R active): Dual-Channel M/R Reference Discriminator
      if (profile.refRejectionEnabled && refEnergyActive && refModule) {
        const rVal = refModule[k];
        const rBg = this.computeGuardExcludedBackground(k, this.bgRef[k], this.prefixPowerR, binCount);
        const promRefDb =
          rVal > EPS && rBg > EPS ? 20.0 * Math.log10(rVal / rBg) : 0.0;
        // If peak prominence is already present in Reference R (within 5 dB of M), reject as program tone
        if (promRefDb >= promDb - 5.0 || promDb - promRefDb < 8.0) {
          continue;
        }
      }

      // Stage 2: 3-Point Parabolic Peak Interpolation & -3 dB Bandwidth / Q Estimation
      const alpha = Math.log(Math.max(EPS, magL));
      const beta = Math.log(Math.max(EPS, magC));
      const gamma = Math.log(Math.max(EPS, magR));
      const denom = alpha - 2.0 * beta + gamma;
      let delta = 0.0;
      if (Math.abs(denom) > 1e-12) {
        delta = Math.max(-0.5, Math.min(0.5, (0.5 * (alpha - gamma)) / denom));
      }
      const f0 = (k + delta) * df;
      const peakAmp = Math.exp(beta - 0.25 * (alpha - gamma) * delta);
      const targetHalfPowerAmp = peakAmp * Math.SQRT1_2;

      // Walk left and right up to 32 bins to find -3.01 dB crossings
      const fL = this.findHalfPowerCrossingHz(module, k, -1, targetHalfPowerAmp, df);
      const fR = this.findHalfPowerCrossingHz(module, k, 1, targetHalfPowerAmp, df);
      const bwHz = Math.max(fR - fL, 0.75 * df);
      const estimatedQ = f0 / bwHz;

      const effectiveMinQ = computeWindowAwareMinQ(profile.minQ, f0, df);
      if (estimatedQ < effectiveMinQ) {
        continue;
      }

      // Stage 3.5: Harmonic Series Veto (check 2*f0, 3*f0 overtones and f0/2 subharmonic)
      const hasHarmonicStructure = this.detectHarmonicStructure(k, f0, df, promDb, binCount);

      // In single-channel mode (no active R), enforce Harmonic Veto unless runaway prominence >= 20 dB
      if (!refEnergyActive && profile.harmonicVetoEnabled && hasHarmonicStructure && promDb < 20.0) {
        continue;
      }

      candidates.push({
        binIndex: k,
        frequencyHz: f0,
        prominenceDb: promDb,
        peakLevelDbFs: levelDbFs,
        estimatedQ,
        powerLinear: peakAmp * peakAmp,
        hasHarmonicStructure,
      });
    }

    // Sort candidates by prominence descending
    candidates.sort((a, b) => b.prominenceDb - a.prominenceDb);

    // Mark all existing tracks unmatched for this frame
    for (const track of this.tracks) {
      track.matchedInCurrentFrame = false;
    }

    // Required onset frames (1.5x longer when Reference channel R is inactive)
    const requiredOnsetFrames = refEnergyActive
      ? profile.onsetFrames
      : Math.ceil(profile.onsetFrames * 1.5);

    const nowTimeStr =
      params.nowTimeStr ?? new Date().toTimeString().slice(0, 8);

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

    // Advance unmatched tracks into 5-second visual latch or expire them
    const survivingTracks: InternalTrack[] = [];
    for (const track of this.tracks) {
      if (track.matchedInCurrentFrame) {
        survivingTracks.push(track);
        continue;
      }

      if (track.state === 'candidate') {
        // Candidate never reached onset persistence; drop immediately
        continue;
      }

      track.state = 'latched';
      track.latchElapsedMs += dtMs;
      if (track.latchElapsedMs < profile.latchDurationMs) {
        survivingTracks.push(track);
      }
    }

    // Priority sort: feedback > ringing > latched > candidate, then by prominence descending
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

  /**
   * Computes local background RMS amplitude around bin `k` while excluding a 5-bin guard region
   * `[k-2 .. k+2]` (the candidate peak's own FFT window main lobe) so low-frequency narrowband
   * peaks do not bias their own 1/3-octave background estimate.
   */
  private computeGuardExcludedBackground(
    k: number,
    octaveBgVal: number,
    prefixPower: Float64Array,
    binCount: number
  ): number {
    const octLow = Math.floor(k * 0.890898718); // 2^(-1/6)
    const octHigh = Math.ceil(k * 1.122462048); // 2^(+1/6)
    const L = Math.max(1, Math.min(k - 8, octLow));
    const R = Math.min(binCount - 2, Math.max(k + 8, octHigh));
    const gL = Math.max(L, k - 2);
    const gR = Math.min(R, k + 2);

    const totalBins = R - L + 1;
    const guardBins = gR >= gL ? gR - gL + 1 : 0;
    const bgBins = totalBins - guardBins;
    if (bgBins <= 0) {
      return octaveBgVal;
    }

    const totalPower = prefixPower[R + 1] - prefixPower[L];
    const guardPower = gR >= gL ? prefixPower[gR + 1] - prefixPower[gL] : 0;
    const bgRms = Math.sqrt(Math.max(0, (totalPower - guardPower) / bgBins));
    return octaveBgVal > 0 ? Math.min(octaveBgVal, bgRms) : bgRms;
  }

  private findHalfPowerCrossingHz(
    module: Float32Array,
    centerBin: number,
    direction: -1 | 1,
    targetAmp: number,
    df: number
  ): number {
    const maxWalk = 32;
    const limit =
      direction < 0
        ? Math.max(1, centerBin - maxWalk)
        : Math.min(module.length - 2, centerBin + maxWalk);

    let prevBin = centerBin;
    let prevAmp = module[centerBin];

    for (let step = 1; step <= maxWalk; step++) {
      const idx = centerBin + step * direction;
      if ((direction < 0 && idx < limit) || (direction > 0 && idx > limit)) {
        break;
      }
      const curAmp = module[idx];
      if (curAmp <= targetAmp) {
        const span = Math.max(1e-12, prevAmp - curAmp);
        const frac = (prevAmp - targetAmp) / span;
        return (prevBin + direction * frac) * df;
      }
      // Stop walking if we enter an adjacent rising peak
      if (step >= 2 && curAmp > prevAmp * 1.15) {
        return prevBin * df;
      }
      prevBin = idx;
      prevAmp = curAmp;
    }

    return prevBin * df;
  }

  private detectHarmonicStructure(
    binIndex: number,
    f0: number,
    df: number,
    promDb: number,
    binCount: number
  ): boolean {
    const maxPromAround = (centerBin: number): number => {
      let best = 0;
      for (let b = Math.max(1, centerBin - 1); b <= Math.min(binCount - 2, centerBin + 1); b++) {
        if (this.promDbScratch[b] > best) {
          best = this.promDbScratch[b];
        }
      }
      return best;
    };

    const bin2 = Math.round((2.0 * f0) / df);
    const bin3 = Math.round((3.0 * f0) / df);
    const hasOvertones =
      bin2 < binCount - 2 &&
      bin3 < binCount - 2 &&
      maxPromAround(bin2) >= 6.0 &&
      maxPromAround(bin3) >= 6.0;

    if (hasOvertones) {
      return true;
    }

    // Subharmonic check: is f0 the 2nd harmonic of a strong fundamental at f0 / 2?
    const binHalf = Math.round((0.5 * f0) / df);
    if (binHalf >= 2 && binHalf < binIndex - 1) {
      const subProm = maxPromAround(binHalf);
      if (subProm >= promDb - 3.0 && subProm >= 8.0) {
        return true;
      }
    }

    return false;
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
    // Note: powerWindow stores RMS^2 peak power; for a steady sinusoid peak-to-mean across frames is ~1.0 (0 dB frame variance, +3.01 dB sinusoidal crest)
    return 3.0103 + 10.0 * Math.log10(Math.max(1.0, maxP / meanP));
  }
}
