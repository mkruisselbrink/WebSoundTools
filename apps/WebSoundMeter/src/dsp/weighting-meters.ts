// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Broadband SPL / Leq Meters supporting IEC 61672-1 A, C, and Z weighting curves
 * with Fast (125 ms), Slow (1000 ms), Impulse (35 ms), Peak, and true Leq integration.
 */

import { WeightingCurve, createWeightingBiquadCoeffs } from '@foh/acoustics';
import { BiquadCascade } from '@foh/dsp';

export { type WeightingCurve, createWeightingBiquadCoeffs };
export type MeterIntegrationTime = 'Fast' | 'Slow' | 'Impulse' | 'Leq';

export interface RollingLeqSnapshot {
  readonly leq1m: Record<WeightingCurve, number>;
  readonly leq5m: Record<WeightingCurve, number>;
  readonly leq15m: Record<WeightingCurve, number>;
  readonly leq60m: Record<WeightingCurve, number>;
  readonly cMinusALeq1mDb: number;
  /** Short-term Z-weighted peak (dB SPL) over the active/most-recent 1-second epoch for live LZpeak alerts */
  readonly recentPeakDbZ?: number;
}

export interface EpochCurveEnergy {
  readonly meanSq: number;
  readonly fastSq: number;
  readonly slowSq: number;
  readonly maxPeakSq: number;
  readonly sampleCount: number;
}

export type EpochEnergySnapshot = Record<WeightingCurve, EpochCurveEnergy>;

export interface BroadbandLevelsSnapshot {
  readonly levelsDb: Record<WeightingCurve, Record<MeterIntegrationTime, number>>;
  readonly peaksDb: Record<WeightingCurve, number>;
  /** Raw pre-gain ADC input RMS & Peak levels in dBFS for preamp gain-staging */
  readonly inputRmsDbFs?: number;
  readonly inputPeakDbFs?: number;
  readonly referenceRmsDb: number;
  readonly referencePeakDb: number;
  /** Offset added to dBFS to display calibrated dB SPL (default 100 dB or user-calibrated) */
  readonly splOffsetDb: number;
  /** Sliding-window equivalent continuous sound levels (1m, 5m, 15m, 60m) and LCeq-LAeq balance */
  readonly rollingLeq?: RollingLeqSnapshot;
}

/**
 * Computes the `splOffsetDb` (`dB SPL @ 0 dBFS`) required so the current `Fast` meter reading
 * on `curve` matches a known `referenceSplDb` (e.g. `94.0` or `114.0 dB` from an acoustic
 * pistonphone calibrator or side-by-side reference SPL meter).
 *
 * Returns `null` when no usable signal is present (`< -110 dBFS`).
 */
export function computeCalibratedSplOffsetDb(
  levels: BroadbandLevelsSnapshot | undefined,
  referenceSplDb: number,
  curve: WeightingCurve = 'Z'
): number | null {
  if (!levels || !Number.isFinite(referenceSplDb)) {
    return null;
  }
  const uncalibratedDb = levels.levelsDb[curve].Fast - levels.splOffsetDb;
  if (!Number.isFinite(uncalibratedDb) || uncalibratedDb < -110) {
    return null;
  }
  return Math.round((referenceSplDb - uncalibratedDb) * 10) / 10;
}

class SingleCurveMeter {
  private readonly filter: BiquadCascade;
  private fastRmsSq = 0;
  private slowRmsSq = 0;
  private impulseRmsSq = 0;
  private leqSumSq = 0;
  private leqSampleCount = 0;
  private peakSq = 0;

  private epochSumSq = 0;
  private epochSampleCount = 0;
  private epochMaxPeakSq = 0;

  private alphaFast = 0;
  private alphaSlow = 0;
  private alphaImpulseRise = 0;
  private alphaImpulseFall = 0;

  constructor(curve: WeightingCurve, sampleRate: number) {
    this.filter = new BiquadCascade(createWeightingBiquadCoeffs(curve, sampleRate));
    this.updateTimeConstants(sampleRate);
  }

  setSampleRate(curve: WeightingCurve, sampleRate: number): void {
    this.filter.setCoefficientsList(createWeightingBiquadCoeffs(curve, sampleRate));
    this.updateTimeConstants(sampleRate);
    this.reset();
  }

  private updateTimeConstants(sampleRate: number): void {
    this.alphaFast = 1.0 - Math.exp(-1.0 / (0.125 * sampleRate));
    this.alphaSlow = 1.0 - Math.exp(-1.0 / (1.0 * sampleRate));
    this.alphaImpulseRise = 1.0 - Math.exp(-1.0 / (0.035 * sampleRate));
    this.alphaImpulseFall = 1.0 - Math.exp(-1.0 / (1.5 * sampleRate));
  }

  reset(): void {
    this.filter.reset();
    this.fastRmsSq = 0;
    this.slowRmsSq = 0;
    this.impulseRmsSq = 0;
    this.leqSumSq = 0;
    this.leqSampleCount = 0;
    this.peakSq = 0;
    this.epochSumSq = 0;
    this.epochSampleCount = 0;
    this.epochMaxPeakSq = 0;
  }

  processSample(x: number): void {
    const y = this.filter.processSample(x);
    const ySq = y * y;

    this.fastRmsSq += this.alphaFast * (ySq - this.fastRmsSq);
    this.slowRmsSq += this.alphaSlow * (ySq - this.slowRmsSq);

    const impAlpha = ySq > this.impulseRmsSq ? this.alphaImpulseRise : this.alphaImpulseFall;
    this.impulseRmsSq += impAlpha * (ySq - this.impulseRmsSq);

    this.leqSumSq += ySq;
    this.leqSampleCount++;

    if (ySq > this.peakSq) {
      this.peakSq = ySq;
    }

    this.epochSumSq += ySq;
    this.epochSampleCount++;
    if (ySq > this.epochMaxPeakSq) {
      this.epochMaxPeakSq = ySq;
    }
  }

  consumeEpochEnergy(): EpochCurveEnergy {
    const meanSq = this.epochSampleCount > 0 ? this.epochSumSq / this.epochSampleCount : 0;
    const result: EpochCurveEnergy = {
      meanSq,
      fastSq: this.fastRmsSq,
      slowSq: this.slowRmsSq,
      maxPeakSq: this.epochMaxPeakSq,
      sampleCount: this.epochSampleCount,
    };
    this.epochSumSq = 0;
    this.epochSampleCount = 0;
    this.epochMaxPeakSq = 0;
    return result;
  }

  getLevelsDb(splOffsetDb: number): Record<MeterIntegrationTime, number> {
    const toDb = (sq: number) =>
      sq > 1e-20 ? 10.0 * Math.log10(sq) + splOffsetDb : -140.0 + splOffsetDb;
    const leqSq = this.leqSampleCount > 0 ? this.leqSumSq / this.leqSampleCount : 0;
    return {
      Fast: toDb(this.fastRmsSq),
      Slow: toDb(this.slowRmsSq),
      Impulse: toDb(this.impulseRmsSq),
      Leq: toDb(leqSq),
    };
  }

  getPeakDb(splOffsetDb: number): number {
    return this.peakSq > 1e-20
      ? 10.0 * Math.log10(this.peakSq) + splOffsetDb
      : -140.0 + splOffsetDb;
  }
}

export class BroadbandMeterBank {
  private sampleRate: number;
  private splOffsetDb: number;
  private readonly meterZ: SingleCurveMeter;
  private readonly meterA: SingleCurveMeter;
  private readonly meterC: SingleCurveMeter;
  private readonly meterInputRaw: SingleCurveMeter;
  private readonly meterRef: SingleCurveMeter;

  constructor(sampleRate: number = 48000, splOffsetDb: number = 0.0) {
    this.sampleRate = sampleRate;
    this.splOffsetDb = splOffsetDb;
    this.meterZ = new SingleCurveMeter('Z', sampleRate);
    this.meterA = new SingleCurveMeter('A', sampleRate);
    this.meterC = new SingleCurveMeter('C', sampleRate);
    this.meterInputRaw = new SingleCurveMeter('Z', sampleRate);
    this.meterRef = new SingleCurveMeter('Z', sampleRate);
  }

  setSampleRate(sampleRate: number): void {
    if (this.sampleRate !== sampleRate) {
      this.sampleRate = sampleRate;
      this.meterZ.setSampleRate('Z', sampleRate);
      this.meterA.setSampleRate('A', sampleRate);
      this.meterC.setSampleRate('C', sampleRate);
      this.meterInputRaw.setSampleRate('Z', sampleRate);
      this.meterRef.setSampleRate('Z', sampleRate);
    }
  }

  setSplOffsetDb(offsetDb: number): void {
    this.splOffsetDb = offsetDb;
  }

  getSplOffsetDb(): number {
    return this.splOffsetDb;
  }

  reset(): void {
    this.meterZ.reset();
    this.meterA.reset();
    this.meterC.reset();
    this.meterInputRaw.reset();
    this.meterRef.reset();
  }

  processSample(sampleM: number, sampleR: number, rawInputM: number = sampleM): void {
    this.meterZ.processSample(sampleM);
    this.meterA.processSample(sampleM);
    this.meterC.processSample(sampleM);
    this.meterInputRaw.processSample(rawInputM);
    this.meterRef.processSample(sampleR);
  }

  processBlock(
    samplesM: Float32Array,
    samplesR: Float32Array,
    length: number = samplesM.length
  ): void {
    for (let i = 0; i < length; i++) {
      this.processSample(samplesM[i], samplesR[i], samplesM[i]);
    }
  }

  consumeEpochEnergy(): EpochEnergySnapshot {
    return {
      Z: this.meterZ.consumeEpochEnergy(),
      A: this.meterA.consumeEpochEnergy(),
      C: this.meterC.consumeEpochEnergy(),
    };
  }

  getSnapshot(rollingLeq?: RollingLeqSnapshot): BroadbandLevelsSnapshot {
    const offset = this.splOffsetDb;
    const rawInLevels = this.meterInputRaw.getLevelsDb(0);
    const refLevels = this.meterRef.getLevelsDb(0);
    return {
      levelsDb: {
        Z: this.meterZ.getLevelsDb(offset),
        A: this.meterA.getLevelsDb(offset),
        C: this.meterC.getLevelsDb(offset),
      },
      peaksDb: {
        Z: this.meterZ.getPeakDb(offset),
        A: this.meterA.getPeakDb(offset),
        C: this.meterC.getPeakDb(offset),
      },
      inputRmsDbFs: rawInLevels.Fast,
      inputPeakDbFs: this.meterInputRaw.getPeakDb(0),
      referenceRmsDb: refLevels.Fast,
      referencePeakDb: this.meterRef.getPeakDb(0),
      splOffsetDb: offset,
      ...(rollingLeq ? { rollingLeq } : {}),
    };
  }
}
