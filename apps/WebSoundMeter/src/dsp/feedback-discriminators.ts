// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure spectral discriminators and sensitivity profiles for acoustic feedback detection:
 *  - Sparse-safe guard-excluded local prominence with broadband program floor
 *  - 3-point parabolic peak interpolation & window-aware -3 dB Q estimation
 *  - Full harmonic comb sieve (subharmonics f0/2..f0/6 and overtones 2f0..4f0)
 *  - Closed-loop Reference (M/R) loop-location tagging & optional Playback Stem Veto
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

export type FeedbackReferenceMode = 'closed-loop-mix' | 'playback-veto' | 'ignore';

export type FeedbackLoopLocation = 'in-mix' | 'stage-only';

export type FeedbackTrackState = 'ringing' | 'feedback' | 'latched';

export interface FeedbackCulpritAttribution {
  readonly channelIndex: number;
  readonly channelName: string;
  readonly confidencePct: number;
  readonly runnerUpLabel?: string;
}

export interface FeedbackThresholdProfile {
  readonly ringingProminenceDb: number;
  readonly feedbackProminenceDb: number;
  readonly minQ: number;
  readonly onsetFrames: number;
  readonly maxCrestFactorDb: number;
  readonly maxPitchStdCents: number;
  readonly minPhaseCoherence: number;
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
    ringingProminenceDb: 11.5,
    feedbackProminenceDb: 14.5,
    minQ: 12.0,
    onsetFrames: 5,
    maxCrestFactorDb: 4.3,
    maxPitchStdCents: 4.2,
    minPhaseCoherence: 0.72,
    noiseGateDbFs: -55.0,
    refRejectionEnabled: false,
    harmonicVetoEnabled: true,
    latchDurationMs: DEFAULT_LATCH_DURATION_MS,
  },
  'monitor-sensitive': {
    ringingProminenceDb: 8.5,
    feedbackProminenceDb: 12.0,
    minQ: 8.0,
    onsetFrames: 3,
    maxCrestFactorDb: 5.2,
    maxPitchStdCents: 6.5,
    minPhaseCoherence: 0.62,
    noiseGateDbFs: -60.0,
    refRejectionEnabled: false,
    harmonicVetoEnabled: true,
    latchDurationMs: DEFAULT_LATCH_DURATION_MS,
  },
  custom: {
    ringingProminenceDb: 10.5,
    feedbackProminenceDb: 13.5,
    minQ: 10.0,
    onsetFrames: 4,
    maxCrestFactorDb: 4.8,
    maxPitchStdCents: 5.0,
    minPhaseCoherence: 0.68,
    noiseGateDbFs: -55.0,
    refRejectionEnabled: false,
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
  /** Whether the ring is also present in the Reference mix bus ('in-mix') or only on stage/room ('stage-only') */
  readonly loopLocation?: FeedbackLoopLocation;
  /** Pinpointed mixer input channel driving the feedback loop when Mixer Input Watch is active */
  readonly culprit?: FeedbackCulpritAttribution;
  /** Optional Virtual EQ routing key (e.g. 'mixer-ch-13' for per-culprit channel strip cheat-sheets) */
  readonly notchTargetKey?: string;
  readonly notchTargetLabel?: string;
}

export interface CandidatePeak {
  readonly binIndex: number;
  readonly parabolicDelta: number;
  readonly frequencyHz: number;
  readonly prominenceDb: number;
  readonly peakLevelDbFs: number;
  readonly bgLevelDbFs: number;
  readonly estimatedQ: number;
  readonly powerLinear: number;
  readonly hasHarmonicStructure: boolean;
  readonly loopLocation?: FeedbackLoopLocation;
}

export interface FeedbackScratchBuffers {
  instModule: Float32Array;
  instRefModule: Float32Array;
  bgModule: Float32Array;
  bgRef: Float32Array;
  prefixPowerM: Float64Array;
  prefixPowerR: Float64Array;
  promDbScratch: Float32Array;
}

export function computeTrackMatchToleranceHz(freqHz: number, binWidthHz: number): number {
  const oneThirtySixthOctave = freqHz * (Math.pow(2, 1 / 36) - 1);
  return Math.max(1.35 * binWidthHz, Math.min(oneThirtySixthOctave, 90.0));
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

/**
 * Computes a sparse-safe local background amplitude around bin `k`, excluding the peak's own
 * main lobe/skirts (`gL..gR`) and flooring against guard-excluded broadband program activity
 * (`80 Hz – 8 kHz`) so quiet inter-harmonic gaps in speech/solo instruments never inflate prominence.
 */
export function computeGuardExcludedBackground(
  k: number,
  octaveBgVal: number,
  prefixPower: Float64Array,
  binCount: number,
  broadbandStartBin: number = 0,
  broadbandEndBin: number = 0
): number {
  const octLow = Math.floor(k * 0.840896415); // -1/4 octave
  const octHigh = Math.ceil(k * 1.189207115); // +1/4 octave
  const L = Math.max(1, Math.min(k - 8, octLow));
  const R = Math.min(binCount - 2, Math.max(k + 8, octHigh));
  const guardRadius = Math.max(2, Math.min(8, Math.ceil(k * 0.012)));
  const gL = Math.max(L, k - guardRadius);
  const gR = Math.min(R, k + guardRadius);

  const totalBins = R - L + 1;
  const guardBins = gR >= gL ? gR - gL + 1 : 0;
  const bgBins = totalBins - guardBins;

  const guardPower = gR >= gL ? prefixPower[gR + 1] - prefixPower[gL] : 0;
  let localBgRms = octaveBgVal;
  if (bgBins > 0) {
    const totalPower = prefixPower[R + 1] - prefixPower[L];
    const rawGuardRms = Math.sqrt(Math.max(0, (totalPower - guardPower) / bgBins));
    localBgRms = octaveBgVal > 0 ? Math.min(octaveBgVal, rawGuardRms) : rawGuardRms;
  }

  // Floor against guard-excluded broadband program energy so sparse tonal speech/music gaps don't collapse to 0
  if (broadbandEndBin > broadbandStartBin + 16) {
    const bbTotalPow = prefixPower[broadbandEndBin + 1] - prefixPower[broadbandStartBin];
    const overlapL = Math.max(broadbandStartBin, gL);
    const overlapR = Math.min(broadbandEndBin, gR);
    const bbGuardPow =
      overlapR >= overlapL ? prefixPower[overlapR + 1] - prefixPower[overlapL] : 0;
    const bbBins = Math.max(
      1,
      broadbandEndBin - broadbandStartBin + 1 - Math.max(0, overlapR - overlapL + 1)
    );
    const otherProgramRms = Math.sqrt(Math.max(0, (bbTotalPow - bbGuardPow) / bbBins));
    return Math.max(localBgRms, 0.42 * otherProgramRms);
  }

  return localBgRms;
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

/**
 * Full Harmonic Comb Sieve testing whether a candidate at `f0` (`binIndex`) belongs to a
 * musical harmonic series—either as the fundamental (with overtones `2f0..4f0`) or as the
 * `n`-th overtone (`n = 2..6`, catching vocal formants on 3rd–6th harmonics).
 */
export function detectHarmonicStructure(
  module: Float32Array,
  promDbScratch: Float32Array,
  binIndex: number,
  f0: number,
  df: number,
  promDb: number,
  binCount: number
): boolean {
  const candAmp = module[binIndex];
  if (candAmp <= 1e-12) return false;

  const peakAroundHz = (targetHz: number): { prom: number; amp: number } => {
    const center = Math.round(targetHz / df);
    const radius = Math.max(1, Math.min(4, Math.ceil((targetHz * 0.018) / df)));
    let bestProm = 0;
    let bestAmp = 0;
    const lo = Math.max(1, center - radius);
    const hi = Math.min(binCount - 2, center + radius);
    for (let b = lo; b <= hi; b++) {
      if (promDbScratch[b] > bestProm) {
        bestProm = promDbScratch[b];
      }
      if (module[b] > bestAmp) {
        bestAmp = module[b];
      }
    }
    return { prom: bestProm, amp: bestAmp };
  };

  // 1. Overtone check (is f0 the fundamental of a musical tone with 2f0, 3f0, 4f0?)
  // Require companion harmonics to be within -16 dB of candAmp so mild clipping (-24 dB) on true feedback isn't vetoed
  const minCompanionAmp = candAmp * 0.158; // -16 dB relative to candidate
  let activeOvertones = 0;
  for (let mult = 2; mult <= 4; mult++) {
    const targetHz = mult * f0;
    if (targetHz >= (binCount - 3) * df) break;
    const h = peakAroundHz(targetHz);
    if (h.prom >= 5.5 && h.amp >= minCompanionAmp) {
      activeOvertones++;
      // Strong 2nd harmonic alone (flute, whistle, synth, vowel) is sufficient
      if (mult === 2 && h.prom >= 7.5 && h.amp >= candAmp * 0.22) {
        return true;
      }
    }
  }
  if (activeOvertones >= 2) {
    return true;
  }

  // 2. Subharmonic / Harmonic-Grid check (is f0 = n * f_fund the 2nd..6th harmonic of a note?)
  for (let n = 2; n <= 6; n++) {
    const fundHz = f0 / n;
    if (fundHz < 55.0) break;
    const fund = peakAroundHz(fundHz);
    if (n === 2) {
      if (fund.prom >= Math.max(6.5, promDb - 7.0) && fund.amp >= candAmp * 0.2) {
        return true;
      }
      continue;
    }

    // For n = 3..6 (vocal formants, brass, guitar harmonics), confirm fundamental + at least 1 other partial on grid
    if (fund.prom < 5.0 || fund.amp < candAmp * 0.1) {
      continue;
    }
    let gridSiblings = 1; // fundamental matched
    for (let m = 2; m <= n + 1; m++) {
      if (m === n) continue;
      const sibHz = m * fundHz;
      if (sibHz >= (binCount - 3) * df) break;
      const sib = peakAroundHz(sibHz);
      if (sib.prom >= 5.0 && sib.amp >= candAmp * 0.1) {
        gridSiblings++;
        if (gridSiblings >= 2) {
          return true;
        }
      }
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
  readonly refMode?: FeedbackReferenceMode;
  readonly scratch: FeedbackScratchBuffers;
}): { readonly candidates: CandidatePeak[]; readonly refEnergyActive: boolean } {
  const { module, refModule, referenceRmsDb, df, profile, scratch } = params;
  const refMode: FeedbackReferenceMode =
    params.refMode ?? (profile.refRejectionEnabled ? 'playback-veto' : 'closed-loop-mix');
  const binCount = module.length;

  smoothMagnitudeOctave(module, scratch.bgModule, 3);
  scratch.prefixPowerM[0] = 0;
  for (let k = 0; k < binCount; k++) {
    const v = module[k];
    scratch.prefixPowerM[k + 1] = scratch.prefixPowerM[k] + v * v;
  }

  const bbStart = Math.max(1, Math.ceil(80.0 / df));
  const bbEnd = Math.min(binCount - 2, Math.floor(8000.0 / df));

  const hasActiveRef =
    refMode !== 'ignore' &&
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
      binCount,
      bbStart,
      bbEnd
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

    let loopLocation: FeedbackLoopLocation | undefined;
    if (refEnergyActive && refModule) {
      const rVal = refModule[k];
      const rBg = computeGuardExcludedBackground(
        k,
        scratch.bgRef[k],
        scratch.prefixPowerR,
        binCount,
        bbStart,
        bbEnd
      );
      const promRefDb = rVal > EPS && rBg > EPS ? 20.0 * Math.log10(rVal / rBg) : 0.0;

      if (refMode === 'playback-veto') {
        if (promRefDb >= promDb - 5.0 || promDb - promRefDb < 8.0) {
          continue;
        }
        loopLocation = 'stage-only';
      } else if (refMode === 'closed-loop-mix') {
        loopLocation = promRefDb >= 7.5 ? 'in-mix' : 'stage-only';
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
      module,
      scratch.promDbScratch,
      k,
      f0,
      df,
      promDb,
      binCount
    );

    if (profile.harmonicVetoEnabled && hasHarmonicStructure && promDb < 28.0) {
      continue;
    }

    candidates.push({
      binIndex: k,
      parabolicDelta: delta,
      frequencyHz: f0,
      prominenceDb: promDb,
      peakLevelDbFs: levelDbFs,
      bgLevelDbFs: levelDbFs - promDb,
      estimatedQ,
      powerLinear: peakAmp * peakAmp,
      hasHarmonicStructure,
      loopLocation,
    });
  }

  candidates.sort((a, b) => b.prominenceDb - a.prominenceDb);
  return { candidates, refEnergyActive };
}
