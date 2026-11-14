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
 * Dual-Resolution 4-Hour SPL & Sliding-Window Leq History Tracker (`src/dsp/spl-history.ts`).
 *
 * Maintains:
 *  - Tier A (4 Hz / 250 ms epochs, 1,200 samples = 5 minutes) for short-term strip charts
 *  - Tier B (1 Hz / 1,000 ms epochs, 14,400 samples = 4 hours) for long-horizon compliance logging
 *  - O(1) sliding-window linear energy accumulators for 1m, 5m, 15m, and 60m Leq (A, C, Z)
 *    with periodic Float64 drift recomputation every 1,024 seconds.
 */

import {
  BroadbandMeterBank,
  EpochEnergySnapshot,
  RollingLeqSnapshot,
  WeightingCurve,
} from './weighting-meters.js';

export const SPL_TIER_A_CAPACITY = 1200;  // 5 minutes @ 4 Hz (250 ms)
export const SPL_TIER_B_CAPACITY = 14400; // 4 hours @ 1 Hz (1000 ms)
export const SPL_CHECKPOINT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export type SplHistoryWindowSec = 60 | 300 | 900 | 3600 | 14400;

export type SplHistoryTraceMode =
  | 'dba-fast-leq1m'
  | 'dba-dbc-leq1m'
  | 'compliance-15m'
  | 'multi-slot';

export type SplAlertMetric =
  | 'LAeq15m'
  | 'LAeq60m'
  | 'LAeq5m'
  | 'LAeq1m'
  | 'LAF'
  | 'LCeq1m'
  | 'LZpeak';

export interface SplAlertThresholds {
  readonly enabled: boolean;
  readonly metric: SplAlertMetric;
  readonly warningDb: number;
  readonly limitDb: number;
}

export const DEFAULT_SPL_ALERT_THRESHOLDS: SplAlertThresholds = {
  enabled: true,
  metric: 'LAeq15m',
  warningDb: 98.0,
  limitDb: 102.0,
};

export interface SplHistoryData {
  /** Monotonically incremented on each 250 ms epoch so UI consumers can skip redundant repaints */
  readonly epochSeq: number;
  /** Number of populated points in the exported view window */
  readonly length: number;
  /** Resolution of this snapshot in seconds (0.25 for <=5m windows, 1.0 for >=15m windows) */
  readonly stepSec: number;
  /** Relative time offsets in seconds (negative up to 0 = now, e.g. -900 .. 0) */
  readonly timeSec: Float32Array;
  /** Short-term Fast/Slow A-weighted trace (dB) */
  readonly shortTermDbA: Float32Array;
  /** Short-term Fast/Slow C-weighted trace (dB) */
  readonly shortTermDbC: Float32Array;
  /** Sliding 1-minute LAeq trace (dB) */
  readonly leq1mDbA: Float32Array;
  /** Sliding 1-minute LCeq trace (dB) */
  readonly leq1mDbC: Float32Array;
  /** Sliding 15-minute LAeq trace (dB) */
  readonly leq15mDbA: Float32Array;
  /** Sliding 60-minute LAeq trace (dB) */
  readonly leq60mDbA: Float32Array;
  /** Per-epoch Peak trace (dB) */
  readonly peakDb: Float32Array;
}

export interface SplHistoryCheckpoint {
  readonly id: string;
  readonly savedAtMs: number;
  readonly sampleRate: number;
  readonly splOffsetDb: number;
  readonly tierBCount: number;
  readonly tierBHead: number;
  readonly energyA: number[];
  readonly energyC: number[];
  readonly energyZ: number[];
  readonly shortTermDbA: number[];
  readonly shortTermDbC: number[];
  readonly peakDb: number[];
}

function energyToDb(meanSq: number, splOffsetDb: number): number {
  return meanSq > 1e-20 ? 10.0 * Math.log10(meanSq) + splOffsetDb : -140.0 + splOffsetDb;
}

interface CurveSlidingSums {
  sum60s: number;
  sum300s: number;
  sum900s: number;
  sum3600s: number;
}

export class SplHistoryTracker {
  private sampleRate: number;
  private splOffsetDb: number;
  private samplesPerSubEpoch: number;
  private samplesSinceSubEpoch: number = 0;
  private subEpochCounter: number = 0;
  private epochSeq: number = 0;
  private activeWindowSec: SplHistoryWindowSec = 900;

  // Sub-epoch (250 ms -> 1000 ms) accumulators for 1 Hz Tier B commit
  private secEnergySumA: number = 0;
  private secEnergySumC: number = 0;
  private secEnergySumZ: number = 0;
  private secSubCount: number = 0;
  private secLastFastSqA: number = 0;
  private secLastFastSqC: number = 0;
  private secMaxPeakSqZ: number = 0;

  // Tier A: 4 Hz (250 ms), capacity 1,200 (5 min)
  private readonly tierAFastDbA = new Float32Array(SPL_TIER_A_CAPACITY);
  private readonly tierAFastDbC = new Float32Array(SPL_TIER_A_CAPACITY);
  private readonly tierASlowDbA = new Float32Array(SPL_TIER_A_CAPACITY);
  private readonly tierALeq1mDbA = new Float32Array(SPL_TIER_A_CAPACITY);
  private readonly tierAPeakDbZ = new Float32Array(SPL_TIER_A_CAPACITY);
  private tierAHead: number = 0;
  private tierACount: number = 0;

  // Tier B: 1 Hz (1,000 ms), capacity 14,400 (4 hours)
  private readonly tierBEnergyA = new Float64Array(SPL_TIER_B_CAPACITY);
  private readonly tierBEnergyC = new Float64Array(SPL_TIER_B_CAPACITY);
  private readonly tierBEnergyZ = new Float64Array(SPL_TIER_B_CAPACITY);
  private readonly tierBShortDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  private readonly tierBShortDbC = new Float32Array(SPL_TIER_B_CAPACITY);
  private readonly tierBLeq1mDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  private readonly tierBLeq1mDbC = new Float32Array(SPL_TIER_B_CAPACITY);
  private readonly tierBLeq15mDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  private readonly tierBLeq60mDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  private readonly tierBPeakDb = new Float32Array(SPL_TIER_B_CAPACITY);
  private tierBHead: number = 0;
  private tierBCount: number = 0;
  private secondsSinceRecalc: number = 0;

  // Sliding window linear energy sums per weighting curve
  private readonly sumsA: CurveSlidingSums = {
    sum60s: 0,
    sum300s: 0,
    sum900s: 0,
    sum3600s: 0,
  };
  private readonly sumsC: CurveSlidingSums = {
    sum60s: 0,
    sum300s: 0,
    sum900s: 0,
    sum3600s: 0,
  };
  private readonly sumsZ: CurveSlidingSums = {
    sum60s: 0,
    sum300s: 0,
    sum900s: 0,
    sum3600s: 0,
  };

  constructor(sampleRate: number = 48000, splOffsetDb: number = 100.0) {
    this.sampleRate = Math.max(1000, sampleRate);
    this.splOffsetDb = splOffsetDb;
    this.samplesPerSubEpoch = Math.max(1, Math.round(this.sampleRate * 0.25));
  }

  setSampleRate(sampleRate: number): void {
    const nextRate = Math.max(1000, sampleRate);
    if (this.sampleRate !== nextRate) {
      this.sampleRate = nextRate;
      this.samplesPerSubEpoch = Math.max(1, Math.round(this.sampleRate * 0.25));
      this.samplesSinceSubEpoch = 0;
    }
  }

  setSplOffsetDb(splOffsetDb: number): void {
    const delta = splOffsetDb - this.splOffsetDb;
    if (Math.abs(delta) < 1e-6) {
      return;
    }
    this.splOffsetDb = splOffsetDb;
    // Shift stored dB traces so historical curves remain aligned with calibrated SPL offset
    for (let i = 0; i < this.tierACount; i++) {
      const idx = (this.tierAHead - this.tierACount + i + SPL_TIER_A_CAPACITY) % SPL_TIER_A_CAPACITY;
      this.tierAFastDbA[idx] += delta;
      this.tierAFastDbC[idx] += delta;
      this.tierASlowDbA[idx] += delta;
      this.tierALeq1mDbA[idx] += delta;
      this.tierAPeakDbZ[idx] += delta;
    }
    for (let i = 0; i < this.tierBCount; i++) {
      const idx = (this.tierBHead - this.tierBCount + i + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
      this.tierBShortDbA[idx] += delta;
      this.tierBShortDbC[idx] += delta;
      this.tierBLeq1mDbA[idx] += delta;
      this.tierBLeq1mDbC[idx] += delta;
      this.tierBLeq15mDbA[idx] += delta;
      this.tierBLeq60mDbA[idx] += delta;
      this.tierBPeakDb[idx] += delta;
    }
    this.epochSeq++;
  }

  setActiveWindowSec(windowSec: SplHistoryWindowSec): void {
    if (this.activeWindowSec !== windowSec) {
      this.activeWindowSec = windowSec;
      this.epochSeq++;
    }
  }

  getActiveWindowSec(): SplHistoryWindowSec {
    return this.activeWindowSec;
  }

  getEpochSeq(): number {
    return this.epochSeq;
  }

  getTierACount(): number {
    return this.tierACount;
  }

  getTierBCount(): number {
    return this.tierBCount;
  }

  reset(): void {
    this.samplesSinceSubEpoch = 0;
    this.subEpochCounter = 0;
    this.secEnergySumA = 0;
    this.secEnergySumC = 0;
    this.secEnergySumZ = 0;
    this.secSubCount = 0;
    this.secLastFastSqA = 0;
    this.secLastFastSqC = 0;
    this.secMaxPeakSqZ = 0;

    this.tierAFastDbA.fill(0);
    this.tierAFastDbC.fill(0);
    this.tierASlowDbA.fill(0);
    this.tierALeq1mDbA.fill(0);
    this.tierAPeakDbZ.fill(0);
    this.tierAHead = 0;
    this.tierACount = 0;

    this.tierBEnergyA.fill(0);
    this.tierBEnergyC.fill(0);
    this.tierBEnergyZ.fill(0);
    this.tierBShortDbA.fill(0);
    this.tierBShortDbC.fill(0);
    this.tierBLeq1mDbA.fill(0);
    this.tierBLeq1mDbC.fill(0);
    this.tierBLeq15mDbA.fill(0);
    this.tierBLeq60mDbA.fill(0);
    this.tierBPeakDb.fill(0);
    this.tierBHead = 0;
    this.tierBCount = 0;
    this.secondsSinceRecalc = 0;

    this.sumsA.sum60s = 0;
    this.sumsA.sum300s = 0;
    this.sumsA.sum900s = 0;
    this.sumsA.sum3600s = 0;
    this.sumsC.sum60s = 0;
    this.sumsC.sum300s = 0;
    this.sumsC.sum900s = 0;
    this.sumsC.sum3600s = 0;
    this.sumsZ.sum60s = 0;
    this.sumsZ.sum300s = 0;
    this.sumsZ.sum900s = 0;
    this.sumsZ.sum3600s = 0;

    this.epochSeq++;
  }

  /**
   * Called after processing sample blocks through `BroadbandMeterBank`.
   * Commits a 250 ms Tier A epoch every `samplesPerSubEpoch` samples and a 1,000 ms Tier B epoch every 4 sub-epochs.
   */
  advanceSamples(sampleCount: number, meterBank: BroadbandMeterBank): boolean {
    this.samplesSinceSubEpoch += sampleCount;
    let committed = false;
    while (this.samplesSinceSubEpoch >= this.samplesPerSubEpoch) {
      this.samplesSinceSubEpoch -= this.samplesPerSubEpoch;
      const epochEnergy = meterBank.consumeEpochEnergy();
      this.pushSubEpochEnergy(epochEnergy);
      committed = true;
    }
    return committed;
  }

  /**
   * Commits a single 250 ms (4 Hz) sub-epoch snapshot directly.
   * Every 4th sub-epoch also commits a 1,000 ms (1 Hz) Tier B bucket.
   */
  pushSubEpochEnergy(epoch: EpochEnergySnapshot): void {
    const offset = this.splOffsetDb;

    // Accumulate toward the current 1-second Tier B bucket first so getRollingLeq()
    // can include the in-flight partial second during initial warm-up
    this.secEnergySumA += epoch.A.meanSq;
    this.secEnergySumC += epoch.C.meanSq;
    this.secEnergySumZ += epoch.Z.meanSq;
    this.secSubCount++;
    this.secLastFastSqA = epoch.A.fastSq;
    this.secLastFastSqC = epoch.C.fastSq;
    if (epoch.Z.maxPeakSq > this.secMaxPeakSqZ) {
      this.secMaxPeakSqZ = epoch.Z.maxPeakSq;
    }

    this.subEpochCounter++;
    if (this.subEpochCounter >= 4) {
      this.commitOneSecondEpoch();
      this.subEpochCounter = 0;
    }

    const rolling = this.getRollingLeq();
    const idxA = this.tierAHead;
    this.tierAFastDbA[idxA] = energyToDb(epoch.A.fastSq, offset);
    this.tierAFastDbC[idxA] = energyToDb(epoch.C.fastSq, offset);
    this.tierASlowDbA[idxA] = energyToDb(epoch.A.slowSq, offset);
    this.tierALeq1mDbA[idxA] = rolling.leq1m.A;
    this.tierAPeakDbZ[idxA] = energyToDb(epoch.Z.maxPeakSq, offset);

    this.tierAHead = (this.tierAHead + 1) % SPL_TIER_A_CAPACITY;
    if (this.tierACount < SPL_TIER_A_CAPACITY) {
      this.tierACount++;
    }

    this.epochSeq++;
  }

  private commitOneSecondEpoch(): void {
    const invSub = this.secSubCount > 0 ? 1.0 / this.secSubCount : 1.0;
    const eA = this.secEnergySumA * invSub;
    const eC = this.secEnergySumC * invSub;
    const eZ = this.secEnergySumZ * invSub;

    this.updateSlidingSumsForCurve(this.sumsA, this.tierBEnergyA, eA);
    this.updateSlidingSumsForCurve(this.sumsC, this.tierBEnergyC, eC);
    this.updateSlidingSumsForCurve(this.sumsZ, this.tierBEnergyZ, eZ);

    const head = this.tierBHead;
    this.tierBEnergyA[head] = eA;
    this.tierBEnergyC[head] = eC;
    this.tierBEnergyZ[head] = eZ;

    this.tierBHead = (this.tierBHead + 1) % SPL_TIER_B_CAPACITY;
    if (this.tierBCount < SPL_TIER_B_CAPACITY) {
      this.tierBCount++;
    }

    this.secEnergySumA = 0;
    this.secEnergySumC = 0;
    this.secEnergySumZ = 0;
    this.secSubCount = 0;

    this.secondsSinceRecalc++;
    if (this.secondsSinceRecalc >= 1024) {
      this.recomputeSlidingSums();
      this.secondsSinceRecalc = 0;
    }

    const offset = this.splOffsetDb;
    const rolling = this.getRollingLeq();
    this.tierBShortDbA[head] = energyToDb(this.secLastFastSqA, offset);
    this.tierBShortDbC[head] = energyToDb(this.secLastFastSqC, offset);
    this.tierBLeq1mDbA[head] = rolling.leq1m.A;
    this.tierBLeq1mDbC[head] = rolling.leq1m.C;
    this.tierBLeq15mDbA[head] = rolling.leq15m.A;
    this.tierBLeq60mDbA[head] = rolling.leq60m.A;
    this.tierBPeakDb[head] = energyToDb(this.secMaxPeakSqZ, offset);

    this.secMaxPeakSqZ = 0;
  }

  private updateSlidingSumsForCurve(
    sums: CurveSlidingSums,
    ring: Float64Array,
    newEnergy: number
  ): void {
    const head = this.tierBHead;
    const count = this.tierBCount;

    const old60 =
      count >= 60 ? ring[(head - 60 + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY] : 0;
    const old300 =
      count >= 300 ? ring[(head - 300 + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY] : 0;
    const old900 =
      count >= 900 ? ring[(head - 900 + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY] : 0;
    const old3600 =
      count >= 3600 ? ring[(head - 3600 + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY] : 0;

    sums.sum60s = Math.max(0, sums.sum60s + newEnergy - old60);
    sums.sum300s = Math.max(0, sums.sum300s + newEnergy - old300);
    sums.sum900s = Math.max(0, sums.sum900s + newEnergy - old900);
    sums.sum3600s = Math.max(0, sums.sum3600s + newEnergy - old3600);
  }

  /**
   * Recomputes all Float64 sliding sums directly from the Tier B energy buffers
   * every 1,024 seconds (or upon checkpoint hydration) to prevent floating-point drift.
   */
  recomputeSlidingSums(): void {
    this.recomputeCurveSums(this.sumsA, this.tierBEnergyA);
    this.recomputeCurveSums(this.sumsC, this.tierBEnergyC);
    this.recomputeCurveSums(this.sumsZ, this.tierBEnergyZ);
  }

  private recomputeCurveSums(sums: CurveSlidingSums, ring: Float64Array): void {
    sums.sum60s = 0;
    sums.sum300s = 0;
    sums.sum900s = 0;
    sums.sum3600s = 0;

    const n = this.tierBCount;
    const maxLookback = Math.min(n, 3600);
    for (let i = 1; i <= maxLookback; i++) {
      const idx = (this.tierBHead - i + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
      const val = ring[idx];
      if (i <= 60) sums.sum60s += val;
      if (i <= 300) sums.sum300s += val;
      if (i <= 900) sums.sum900s += val;
      sums.sum3600s += val;
    }
  }

  private computeWindowDb(
    sum: number,
    windowSec: number,
    inFlightEnergy: number,
    inFlightSubCount: number
  ): number {
    if (this.tierBCount === 0) {
      if (inFlightSubCount > 0) {
        return energyToDb(inFlightEnergy / inFlightSubCount, this.splOffsetDb);
      }
      return -140.0 + this.splOffsetDb;
    }
    const denom = Math.max(1, Math.min(windowSec, this.tierBCount));
    return energyToDb(sum / denom, this.splOffsetDb);
  }

  getRollingLeq(): RollingLeqSnapshot {
    const leq1m: Record<WeightingCurve, number> = {
      A: this.computeWindowDb(this.sumsA.sum60s, 60, this.secEnergySumA, this.secSubCount),
      C: this.computeWindowDb(this.sumsC.sum60s, 60, this.secEnergySumC, this.secSubCount),
      Z: this.computeWindowDb(this.sumsZ.sum60s, 60, this.secEnergySumZ, this.secSubCount),
    };
    const leq5m: Record<WeightingCurve, number> = {
      A: this.computeWindowDb(this.sumsA.sum300s, 300, this.secEnergySumA, this.secSubCount),
      C: this.computeWindowDb(this.sumsC.sum300s, 300, this.secEnergySumC, this.secSubCount),
      Z: this.computeWindowDb(this.sumsZ.sum300s, 300, this.secEnergySumZ, this.secSubCount),
    };
    const leq15m: Record<WeightingCurve, number> = {
      A: this.computeWindowDb(this.sumsA.sum900s, 900, this.secEnergySumA, this.secSubCount),
      C: this.computeWindowDb(this.sumsC.sum900s, 900, this.secEnergySumC, this.secSubCount),
      Z: this.computeWindowDb(this.sumsZ.sum900s, 900, this.secEnergySumZ, this.secSubCount),
    };
    const leq60m: Record<WeightingCurve, number> = {
      A: this.computeWindowDb(this.sumsA.sum3600s, 3600, this.secEnergySumA, this.secSubCount),
      C: this.computeWindowDb(this.sumsC.sum3600s, 3600, this.secEnergySumC, this.secSubCount),
      Z: this.computeWindowDb(this.sumsZ.sum3600s, 3600, this.secEnergySumZ, this.secSubCount),
    };

    return {
      leq1m,
      leq5m,
      leq15m,
      leq60m,
      cMinusALeq1mDb: leq1m.C - leq1m.A,
    };
  }

  /**
   * Exports a chart-ready `SplHistoryData` snapshot for the requested `windowSec`.
   * Windows <= 300 s read from Tier A (4 Hz, 0.25 s step); windows >= 900 s read from Tier B (1 Hz, 1.0 s step)
   * with decimation when total samples exceed `maxPoints` (default 1,800).
   */
  exportWindow(
    windowSec: SplHistoryWindowSec = this.activeWindowSec,
    maxPoints: number = 1800
  ): SplHistoryData {
    if (windowSec <= 300) {
      const requestedSamples = Math.min(this.tierACount, Math.round(windowSec * 4));
      const length = requestedSamples;
      const timeSec = new Float32Array(length);
      const shortTermDbA = new Float32Array(length);
      const shortTermDbC = new Float32Array(length);
      const leq1mDbA = new Float32Array(length);
      const leq1mDbC = new Float32Array(length);
      const leq15mDbA = new Float32Array(length);
      const leq60mDbA = new Float32Array(length);
      const peakDb = new Float32Array(length);

      const startIdx =
        (this.tierAHead - requestedSamples + SPL_TIER_A_CAPACITY) % SPL_TIER_A_CAPACITY;
      const rolling = this.getRollingLeq();

      for (let i = 0; i < length; i++) {
        const ringIdx = (startIdx + i) % SPL_TIER_A_CAPACITY;
        timeSec[i] = -((length - 1 - i) * 0.25) || 0;
        shortTermDbA[i] = this.tierAFastDbA[ringIdx];
        shortTermDbC[i] = this.tierAFastDbC[ringIdx];
        leq1mDbA[i] = this.tierALeq1mDbA[ringIdx];
        // Map corresponding 1s Tier B values or current rolling values for C/15m/60m
        const secOffsetFromNow = Math.floor((length - 1 - i) / 4);
        if (this.tierBCount > secOffsetFromNow) {
          const bIdx =
            (this.tierBHead - 1 - secOffsetFromNow + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
          leq1mDbC[i] = this.tierBLeq1mDbC[bIdx];
          leq15mDbA[i] = this.tierBLeq15mDbA[bIdx];
          leq60mDbA[i] = this.tierBLeq60mDbA[bIdx];
        } else {
          leq1mDbC[i] = rolling.leq1m.C;
          leq15mDbA[i] = rolling.leq15m.A;
          leq60mDbA[i] = rolling.leq60m.A;
        }
        peakDb[i] = this.tierAPeakDbZ[ringIdx];
      }

      return {
        epochSeq: this.epochSeq,
        length,
        stepSec: 0.25,
        timeSec,
        shortTermDbA,
        shortTermDbC,
        leq1mDbA,
        leq1mDbC,
        leq15mDbA,
        leq60mDbA,
        peakDb,
      };
    }

    // Long-horizon Tier B (1 Hz)
    const rawCount = Math.min(this.tierBCount, windowSec);
    const stride = rawCount > maxPoints ? Math.ceil(rawCount / maxPoints) : 1;
    const length = rawCount > 0 ? Math.ceil(rawCount / stride) : 0;

    const timeSec = new Float32Array(length);
    const shortTermDbA = new Float32Array(length);
    const shortTermDbC = new Float32Array(length);
    const leq1mDbA = new Float32Array(length);
    const leq1mDbC = new Float32Array(length);
    const leq15mDbA = new Float32Array(length);
    const leq60mDbA = new Float32Array(length);
    const peakDb = new Float32Array(length);

    const startIdx = (this.tierBHead - rawCount + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;

    for (let outIdx = 0; outIdx < length; outIdx++) {
      const sampleOffset = Math.min(rawCount - 1, outIdx * stride);
      const ringIdx = (startIdx + sampleOffset) % SPL_TIER_B_CAPACITY;
      timeSec[outIdx] = -(rawCount - 1 - sampleOffset) || 0;
      shortTermDbA[outIdx] = this.tierBShortDbA[ringIdx];
      shortTermDbC[outIdx] = this.tierBShortDbC[ringIdx];
      leq1mDbA[outIdx] = this.tierBLeq1mDbA[ringIdx];
      leq1mDbC[outIdx] = this.tierBLeq1mDbC[ringIdx];
      leq15mDbA[outIdx] = this.tierBLeq15mDbA[ringIdx];
      leq60mDbA[outIdx] = this.tierBLeq60mDbA[ringIdx];

      // Preserve max peak within decimated stride bucket
      let maxPk = this.tierBPeakDb[ringIdx];
      for (let s = 1; s < stride && sampleOffset + s < rawCount; s++) {
        const subIdx = (startIdx + sampleOffset + s) % SPL_TIER_B_CAPACITY;
        if (this.tierBPeakDb[subIdx] > maxPk) {
          maxPk = this.tierBPeakDb[subIdx];
        }
      }
      peakDb[outIdx] = maxPk;
    }

    return {
      epochSeq: this.epochSeq,
      length,
      stepSec: stride,
      timeSec,
      shortTermDbA,
      shortTermDbC,
      leq1mDbA,
      leq1mDbC,
      leq15mDbA,
      leq60mDbA,
      peakDb,
    };
  }

  /**
   * Serializes the active 1 Hz Tier B history into a compact checkpoint for IndexedDB persistence.
   */
  serializeCheckpoint(slotId: string, nowMs: number = Date.now()): SplHistoryCheckpoint {
    const n = this.tierBCount;
    const startIdx = (this.tierBHead - n + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
    const energyA = new Array<number>(n);
    const energyC = new Array<number>(n);
    const energyZ = new Array<number>(n);
    const shortTermDbA = new Array<number>(n);
    const shortTermDbC = new Array<number>(n);
    const peakDb = new Array<number>(n);

    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % SPL_TIER_B_CAPACITY;
      energyA[i] = this.tierBEnergyA[idx];
      energyC[i] = this.tierBEnergyC[idx];
      energyZ[i] = this.tierBEnergyZ[idx];
      shortTermDbA[i] = this.tierBShortDbA[idx];
      shortTermDbC[i] = this.tierBShortDbC[idx];
      peakDb[i] = this.tierBPeakDb[idx];
    }

    return {
      id: slotId,
      savedAtMs: nowMs,
      sampleRate: this.sampleRate,
      splOffsetDb: this.splOffsetDb,
      tierBCount: n,
      tierBHead: n % SPL_TIER_B_CAPACITY,
      energyA,
      energyC,
      energyZ,
      shortTermDbA,
      shortTermDbC,
      peakDb,
    };
  }

  /**
   * Hydrates a saved 1 Hz Tier B checkpoint if it is less than 30 minutes old.
   * Reconstructs all rolling Leq traces (1m, 15m, 60m) and sliding sums.
   */
  hydrateCheckpoint(checkpoint: SplHistoryCheckpoint, nowMs: number = Date.now()): boolean {
    if (
      !checkpoint ||
      nowMs - checkpoint.savedAtMs > SPL_CHECKPOINT_MAX_AGE_MS ||
      checkpoint.tierBCount <= 0
    ) {
      return false;
    }

    this.reset();
    this.splOffsetDb = checkpoint.splOffsetDb;
    const n = Math.min(SPL_TIER_B_CAPACITY, checkpoint.tierBCount);

    for (let i = 0; i < n; i++) {
      const eA = checkpoint.energyA[i] ?? 0;
      const eC = checkpoint.energyC[i] ?? 0;
      const eZ = checkpoint.energyZ[i] ?? 0;

      this.updateSlidingSumsForCurve(this.sumsA, this.tierBEnergyA, eA);
      this.updateSlidingSumsForCurve(this.sumsC, this.tierBEnergyC, eC);
      this.updateSlidingSumsForCurve(this.sumsZ, this.tierBEnergyZ, eZ);

      const head = this.tierBHead;
      this.tierBEnergyA[head] = eA;
      this.tierBEnergyC[head] = eC;
      this.tierBEnergyZ[head] = eZ;

      this.tierBHead = (this.tierBHead + 1) % SPL_TIER_B_CAPACITY;
      if (this.tierBCount < SPL_TIER_B_CAPACITY) {
        this.tierBCount++;
      }

      const rolling = this.getRollingLeq();
      this.tierBShortDbA[head] = checkpoint.shortTermDbA[i] ?? rolling.leq1m.A;
      this.tierBShortDbC[head] = checkpoint.shortTermDbC[i] ?? rolling.leq1m.C;
      this.tierBLeq1mDbA[head] = rolling.leq1m.A;
      this.tierBLeq1mDbC[head] = rolling.leq1m.C;
      this.tierBLeq15mDbA[head] = rolling.leq15m.A;
      this.tierBLeq60mDbA[head] = rolling.leq60m.A;
      this.tierBPeakDb[head] = checkpoint.peakDb[i] ?? rolling.leq1m.Z;
    }

    this.recomputeSlidingSums();
    this.epochSeq++;
    return true;
  }

  /**
   * Returns 1-second historical rows for CSV export in chronological order.
   */
  getChronologicalRows(nowMs: number = Date.now()): Array<{
    timestampIso: string;
    elapsedSec: number;
    lafDb: number;
    lcfDb: number;
    laeq1mDb: number;
    lceq1mDb: number;
    laeq5mDb: number;
    laeq15mDb: number;
    laeq60mDb: number;
    lpeakDb: number;
  }> {
    const n = this.tierBCount;
    const startIdx = (this.tierBHead - n + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
    const rows = [];
    let runningSum300A = 0;

    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % SPL_TIER_B_CAPACITY;
      runningSum300A += this.tierBEnergyA[idx];
      if (i >= 300) {
        const oldIdx = (startIdx + i - 300) % SPL_TIER_B_CAPACITY;
        runningSum300A = Math.max(0, runningSum300A - this.tierBEnergyA[oldIdx]);
      }
      const denom5m = Math.max(1, Math.min(300, i + 1));
      const laeq5mDb = energyToDb(runningSum300A / denom5m, this.splOffsetDb);
      const rowTimeMs = nowMs - (n - 1 - i) * 1000;

      rows.push({
        timestampIso: new Date(rowTimeMs).toISOString(),
        elapsedSec: i + 1,
        lafDb: this.tierBShortDbA[idx],
        lcfDb: this.tierBShortDbC[idx],
        laeq1mDb: this.tierBLeq1mDbA[idx],
        lceq1mDb: this.tierBLeq1mDbC[idx],
        laeq5mDb,
        laeq15mDb: this.tierBLeq15mDbA[idx],
        laeq60mDb: this.tierBLeq60mDbA[idx],
        lpeakDb: this.tierBPeakDb[idx],
      });
    }
    return rows;
  }
}

/**
 * Formats 1-second SPL history from one or more slots into a standard UTF-8 CSV string.
 */
export function formatSplHistoryCsv(
  slots: ReadonlyArray<{
    slotId: string;
    slotName: string;
    tracker: SplHistoryTracker;
  }>,
  nowMs: number = Date.now()
): string {
  const header =
    'timestamp_iso,elapsed_sec,slot_id,slot_name,laf_db,lcf_db,laeq_1m_db,lceq_1m_db,laeq_5m_db,laeq_15m_db,laeq_60m_db,lpeak_db';
  const lines: string[] = [header];

  for (const { slotId, slotName, tracker } of slots) {
    const safeName = slotName.includes(',') ? `"${slotName.replace(/"/g, '""')}"` : slotName;
    const rows = tracker.getChronologicalRows(nowMs);
    for (const r of rows) {
      lines.push(
        [
          r.timestampIso,
          r.elapsedSec,
          slotId,
          safeName,
          r.lafDb.toFixed(1),
          r.lcfDb.toFixed(1),
          r.laeq1mDb.toFixed(1),
          r.lceq1mDb.toFixed(1),
          r.laeq5mDb.toFixed(1),
          r.laeq15mDb.toFixed(1),
          r.laeq60mDb.toFixed(1),
          r.lpeakDb.toFixed(1),
        ].join(',')
      );
    }
  }

  return lines.join('\n') + '\n';
}
