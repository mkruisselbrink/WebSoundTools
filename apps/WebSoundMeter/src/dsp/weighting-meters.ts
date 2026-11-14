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
 * IEC 61672-1 Sound Level Weighting Filters (A, C, Z) and Broadband SPL / Leq Meters
 * supporting Fast (125 ms), Slow (1000 ms), Impulse (35 ms), Peak, and true Leq integration.
 */

import { BiquadCascade, BiquadCoefficients } from './biquad.js';

export type WeightingCurve = 'Z' | 'A' | 'C';
export type MeterIntegrationTime = 'Fast' | 'Slow' | 'Impulse' | 'Leq';

export interface RollingLeqSnapshot {
  readonly leq1m: Record<WeightingCurve, number>;
  readonly leq5m: Record<WeightingCurve, number>;
  readonly leq15m: Record<WeightingCurve, number>;
  readonly leq60m: Record<WeightingCurve, number>;
  readonly cMinusALeq1mDb: number;
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
  readonly referenceRmsDb: number;
  readonly referencePeakDb: number;
  /** Offset added to dBFS to display calibrated dB SPL (default 100 dB or user-calibrated) */
  readonly splOffsetDb: number;
  /** Sliding-window equivalent continuous sound levels (1m, 5m, 15m, 60m) and LCeq-LAeq balance */
  readonly rollingLeq?: RollingLeqSnapshot;
}

/**
 * Designs a second-order digital biquad section via the Bilinear Transform
 * from two real analog left-half-plane poles (-w1, -w2) and either:
 *   - 2 zeros at s = 0 (high-pass type, `highpassZeros = 2`), or
 *   - 0 zeros at s = 0 (low-pass type, `highpassZeros = 0`).
 *
 * Uses exact frequency pre-warping at 1000 Hz or pole frequency so the high-frequency
 * warping near Nyquist is compensated accurately.
 */
function bilinearTwoRealPolesSection(
  f1Hz: number,
  f2Hz: number,
  highpassZeros: 0 | 2,
  sampleRate: number
): BiquadCoefficients {
  // Pre-warp analog pole frequencies: Omega = 2*Fs * tan(pi * f / Fs)
  // Clamp f slightly below Nyquist so high-frequency poles (20.6 kHz) remain well-behaved at 44.1/48 kHz
  const maxFreq = sampleRate * 0.465;
  const w1 = 2.0 * sampleRate * Math.tan((Math.PI * Math.min(f1Hz, maxFreq)) / sampleRate);
  const w2 = 2.0 * sampleRate * Math.tan((Math.PI * Math.min(f2Hz, maxFreq)) / sampleRate);
  const K = 2.0 * sampleRate;

  // Analog denominator: (s + w1)(s + w2) = s^2 + (w1 + w2)s + w1*w2
  // Substitute s = K * (1 - z^-1) / (1 + z^-1)
  const K2 = K * K;
  const sumW = w1 + w2;
  const prodW = w1 * w2;

  const a0 = K2 + K * sumW + prodW;
  const a1 = 2.0 * (prodW - K2);
  const a2 = K2 - K * sumW + prodW;

  if (highpassZeros === 2) {
    // Analog numerator: s^2 -> K^2 * (1 - 2*z^-1 + z^-2)
    return {
      b0: K2 / a0,
      b1: (-2.0 * K2) / a0,
      b2: K2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
    };
  } else {
    // Analog numerator: w1*w2 -> prodW * (1 + 2*z^-1 + z^-2)
    return {
      b0: prodW / a0,
      b1: (2.0 * prodW) / a0,
      b2: prodW / a0,
      a1: a1 / a0,
      a2: a2 / a0,
    };
  }
}

/**
 * Evaluates magnitude |H(e^{jw})| of a biquad cascade at `freqHz`.
 */
function cascadeMagnitudeAt(coeffs: readonly BiquadCoefficients[], freqHz: number, sampleRate: number): number {
  const w = (2.0 * Math.PI * freqHz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2.0 * w);
  const s2 = Math.sin(2.0 * w);

  let mag = 1.0;
  for (const sec of coeffs) {
    const numRe = sec.b0 + sec.b1 * c1 + sec.b2 * c2;
    const numIm = -(sec.b1 * s1 + sec.b2 * s2);
    const denRe = 1.0 + sec.a1 * c1 + sec.a2 * c2;
    const denIm = -(sec.a1 * s1 + sec.a2 * s2);
    mag *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  }
  return mag;
}

/**
 * Computes IEC 61672-1 A, C, or Z weighting filter biquad cascade coefficients
 * normalized to exactly 0.00 dB (1.0x gain) at 1000 Hz.
 *
 * IEC 61672-1 standard analog pole frequencies:
 *   f1 = 20.598997 Hz
 *   f2 = 107.65265 Hz
 *   f3 = 737.86223 Hz
 *   f4 = 12194.217 Hz
 */
export function createWeightingBiquadCoeffs(
  curve: WeightingCurve,
  sampleRate: number
): BiquadCoefficients[] {
  if (curve === 'Z') {
    return [];
  }

  const f1 = 20.598997;
  const f2 = 107.65265;
  const f3 = 737.86223;
  const f4 = 12194.217;

  const sections: BiquadCoefficients[] = [];

  if (curve === 'C') {
    // C-weighting: 2 HP zeros at 0 Hz with double pole at f1, and double pole at f4
    sections.push(bilinearTwoRealPolesSection(f1, f1, 2, sampleRate));
    sections.push(bilinearTwoRealPolesSection(f4, f4, 0, sampleRate));
  } else if (curve === 'A') {
    // A-weighting: 4 HP zeros at 0 Hz with poles at (f1, f1), (f2, f3), and (f4, f4)
    sections.push(bilinearTwoRealPolesSection(f1, f1, 2, sampleRate));
    sections.push(bilinearTwoRealPolesSection(f2, f3, 2, sampleRate));
    sections.push(bilinearTwoRealPolesSection(f4, f4, 0, sampleRate));
  }

  // Normalize cascade gain so |H(1000 Hz)| == 1.0 (0.0 dB)
  const gainAt1kHz = cascadeMagnitudeAt(sections, 1000.0, sampleRate);
  const norm = gainAt1kHz > 1e-12 ? 1.0 / gainAt1kHz : 1.0;

  sections[0] = {
    ...sections[0],
    b0: sections[0].b0 * norm,
    b1: sections[0].b1 * norm,
    b2: sections[0].b2 * norm,
  };

  return sections;
}

class SingleCurveMeter {
  private readonly filter: BiquadCascade;
  private fastRmsSq: number = 0;
  private slowRmsSq: number = 0;
  private impulseRmsSq: number = 0;
  private leqSumSq: number = 0;
  private leqSampleCount: number = 0;
  private peakSq: number = 0;

  private epochSumSq: number = 0;
  private epochSampleCount: number = 0;
  private epochMaxPeakSq: number = 0;

  private alphaFast: number = 0;
  private alphaSlow: number = 0;
  private alphaImpulseRise: number = 0;
  private alphaImpulseFall: number = 0;

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
    // IEC 61672 time constants: Fast = 125 ms, Slow = 1000 ms, Impulse = 35 ms rise / 1500 ms fall
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
  private readonly meterRef: SingleCurveMeter;

  constructor(sampleRate: number = 48000, splOffsetDb: number = 0.0) {
    this.sampleRate = sampleRate;
    this.splOffsetDb = splOffsetDb;
    this.meterZ = new SingleCurveMeter('Z', sampleRate);
    this.meterA = new SingleCurveMeter('A', sampleRate);
    this.meterC = new SingleCurveMeter('C', sampleRate);
    this.meterRef = new SingleCurveMeter('Z', sampleRate);
  }

  setSampleRate(sampleRate: number): void {
    if (this.sampleRate !== sampleRate) {
      this.sampleRate = sampleRate;
      this.meterZ.setSampleRate('Z', sampleRate);
      this.meterA.setSampleRate('A', sampleRate);
      this.meterC.setSampleRate('C', sampleRate);
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
    this.meterRef.reset();
  }

  processSample(sampleM: number, sampleR: number): void {
    this.meterZ.processSample(sampleM);
    this.meterA.processSample(sampleM);
    this.meterC.processSample(sampleM);
    this.meterRef.processSample(sampleR);
  }

  processBlock(samplesM: Float32Array, samplesR: Float32Array, length: number = samplesM.length): void {
    for (let i = 0; i < length; i++) {
      this.processSample(samplesM[i], samplesR[i]);
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
      referenceRmsDb: refLevels.Fast,
      referencePeakDb: this.meterRef.getPeakDb(0),
      splOffsetDb: offset,
      ...(rollingLeq ? { rollingLeq } : {}),
    };
  }
}

