// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure spectral discriminators and sensitivity profiles for acoustic feedback detection:
 *  - Guard-excluded 1/3-octave local prominence
 *  - 3-point parabolic peak interpolation & window-aware -3 dB Q estimation
 *  - Harmonic overtone (2f0/3f0) & subharmonic (f0/2) veto
 *  - Dual-channel M/R reference rejection
 */

import { smoothMagnitudeOctave } from '@foh/dsp';

export const MAX_ACTIVE_TRACKS_PER_SLOT = 6;
export const MAX_VISIBLE_CALLOUT_FLAGS = 8;
export const MAX_RING_LOG_ENTRIES = 50;
export const DEFAULT_LATCH_DURATION_MS = 5000;

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
    onsetFrames: 4,
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
    onsetFrames: 2,
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

export interface CandidatePeak {
  readonly binIndex: number;
  readonly frequencyHz: number;
  readonly prominenceDb: number;
  readonly peakLevelDbFs: number;
  readonly estimatedQ: number;
  readonly powerLinear: number;
  readonly hasHarmonicStructure: boolean;
}

export interface FeedbackScratchBuffers {
  bgModule: Float32Array;
  bgRef: Float32Array;
  prefixPowerM: Float64Array;
  prefixPowerR: Float64Array;
  promDbScratch: Float32Array;
}

export function computeTrackMatchToleranceHz(freqHz: number, binWidthHz: number): number {
  const oneTwentyFourthOctave = freqHz * (Math.pow(2, 1 / 24) - 1);
  return Math.max(1.5 * binWidthHz, Math.min(oneTwentyFourthOctave, 120.0));
}

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

export function computeGuardExcludedBackground(
  k: number,
  octaveBgVal: number,
  prefixPower: Float64Array,
  binCount: number
): number {
  const octLow = Math.floor(k * 0.890898718);
  const octHigh = Math.ceil(k * 1.122462048);
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

export function findHalfPowerCrossingHz(
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
    if (step >= 2 && curAmp > prevAmp * 1.15) {
      return prevBin * df;
    }
    prevBin = idx;
    prevAmp = curAmp;
  }

  return prevBin * df;
}

export function detectHarmonicStructure(
  promDbScratch: Float32Array,
  binIndex: number,
  f0: number,
  df: number,
  promDb: number,
  binCount: number
): boolean {
  const maxPromAround = (centerBin: number): number => {
    let best = 0;
    for (let b = Math.max(1, centerBin - 1); b <= Math.min(binCount - 2, centerBin + 1); b++) {
      if (promDbScratch[b] > best) {
        best = promDbScratch[b];
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

  const binHalf = Math.round((0.5 * f0) / df);
  if (binHalf >= 2 && binHalf < binIndex - 1) {
    const subProm = maxPromAround(binHalf);
    if (subProm >= promDb - 3.0 && subProm >= 8.0) {
      return true;
    }
  }

  return false;
}

export function scanSpectrumForCandidates(params: {
  readonly module: Float32Array;
  readonly refModule: Float32Array | undefined;
  readonly referenceRmsDb: number | undefined;
  readonly df: number;
  readonly profile: FeedbackThresholdProfile;
  readonly scratch: FeedbackScratchBuffers;
}): { readonly candidates: CandidatePeak[]; readonly refEnergyActive: boolean } {
  const { module, refModule, referenceRmsDb, df, profile, scratch } = params;
  const binCount = module.length;

  smoothMagnitudeOctave(module, scratch.bgModule, 3);
  scratch.prefixPowerM[0] = 0;
  for (let k = 0; k < binCount; k++) {
    const v = module[k];
    scratch.prefixPowerM[k + 1] = scratch.prefixPowerM[k] + v * v;
  }

  const hasActiveRef =
    refModule !== undefined &&
    refModule.length === binCount &&
    (referenceRmsDb === undefined || referenceRmsDb > -55.0);

  let refEnergyActive = false;
  if (hasActiveRef && refModule) {
    let maxRef = 0;
    for (let k = 1; k < binCount; k++) {
      if (refModule[k] > maxRef) maxRef = refModule[k];
    }
    if (maxRef > 1e-3) {
      refEnergyActive = true;
      smoothMagnitudeOctave(refModule, scratch.bgRef, 3);
      scratch.prefixPowerR[0] = 0;
      for (let k = 0; k < binCount; k++) {
        const v = refModule[k];
        scratch.prefixPowerR[k + 1] = scratch.prefixPowerR[k] + v * v;
      }
    }
  }

  const minBin = Math.max(2, Math.ceil(60.0 / df));
  const maxBin = Math.min(binCount - 3, Math.floor(16000.0 / df));
  const EPS = 1e-12;

  scratch.promDbScratch.fill(0);
  for (let k = 1; k < binCount - 1; k++) {
    const mVal = module[k];
    const bgVal = computeGuardExcludedBackground(
      k,
      scratch.bgModule[k],
      scratch.prefixPowerM,
      binCount
    );
    if (mVal > EPS && bgVal > EPS) {
      scratch.promDbScratch[k] = 20.0 * Math.log10(mVal / bgVal);
    }
  }

  const candidates: CandidatePeak[] = [];

  for (let k = minBin; k <= maxBin; k++) {
    const magC = module[k];
    const magL = module[k - 1];
    const magR = module[k + 1];

    if (!(magC > magL && magC >= magR && magC > EPS)) {
      continue;
    }

    const levelDbFs = 20.0 * Math.log10(magC);
    if (levelDbFs < profile.noiseGateDbFs) {
      continue;
    }

    const promDb = scratch.promDbScratch[k];
    if (promDb < profile.ringingProminenceDb) {
      continue;
    }

    if (profile.refRejectionEnabled && refEnergyActive && refModule) {
      const rVal = refModule[k];
      const rBg = computeGuardExcludedBackground(
        k,
        scratch.bgRef[k],
        scratch.prefixPowerR,
        binCount
      );
      const promRefDb = rVal > EPS && rBg > EPS ? 20.0 * Math.log10(rVal / rBg) : 0.0;
      if (promRefDb >= promDb - 5.0 || promDb - promRefDb < 8.0) {
        continue;
      }
    }

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

    const fL = findHalfPowerCrossingHz(module, k, -1, targetHalfPowerAmp, df);
    const fR = findHalfPowerCrossingHz(module, k, 1, targetHalfPowerAmp, df);
    const bwHz = Math.max(fR - fL, 0.75 * df);
    const estimatedQ = f0 / bwHz;

    const effectiveMinQ = computeWindowAwareMinQ(profile.minQ, f0, df);
    if (estimatedQ < effectiveMinQ) {
      continue;
    }

    const hasHarmonicStructure = detectHarmonicStructure(
      scratch.promDbScratch,
      k,
      f0,
      df,
      promDb,
      binCount
    );

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

  candidates.sort((a, b) => b.prominenceDb - a.prominenceDb);
  return { candidates, refEnergyActive };
}
