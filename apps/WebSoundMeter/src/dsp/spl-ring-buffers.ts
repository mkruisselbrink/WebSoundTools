// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dual-resolution TypedArray ring buffers (Tier A @ 4 Hz and Tier B @ 1 Hz) and O(1)
 * sliding-window linear energy accumulators for 4-hour SPL & Leq tracking.
 */

import {
  SPL_TIER_A_CAPACITY,
  SPL_TIER_B_CAPACITY,
  SplHistoryData,
  SplHistoryWindowSec,
  energyToDb,
} from './spl-compliance.js';
import type { RollingLeqSnapshot, WeightingCurve } from './weighting-meters.js';

export interface CurveSlidingSums {
  sum60s: number;
  sum300s: number;
  sum900s: number;
  sum3600s: number;
}

export function createCurveSlidingSums(): CurveSlidingSums {
  return { sum60s: 0, sum300s: 0, sum900s: 0, sum3600s: 0 };
}

export function resetCurveSlidingSums(sums: CurveSlidingSums): void {
  sums.sum60s = 0;
  sums.sum300s = 0;
  sums.sum900s = 0;
  sums.sum3600s = 0;
}

export function updateSlidingSumsForCurve(
  sums: CurveSlidingSums,
  ring: Float64Array,
  head: number,
  count: number,
  newEnergy: number
): void {
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

export function recomputeCurveSums(
  sums: CurveSlidingSums,
  ring: Float64Array,
  head: number,
  count: number
): void {
  resetCurveSlidingSums(sums);
  const maxLookback = Math.min(count, 3600);
  for (let i = 1; i <= maxLookback; i++) {
    const idx = (head - i + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
    const val = ring[idx];
    if (i <= 60) sums.sum60s += val;
    if (i <= 300) sums.sum300s += val;
    if (i <= 900) sums.sum900s += val;
    sums.sum3600s += val;
  }
}

export class TierARingBuffers {
  readonly fastDbA = new Float32Array(SPL_TIER_A_CAPACITY);
  readonly fastDbC = new Float32Array(SPL_TIER_A_CAPACITY);
  readonly slowDbA = new Float32Array(SPL_TIER_A_CAPACITY);
  readonly leq1mDbA = new Float32Array(SPL_TIER_A_CAPACITY);
  readonly peakDbZ = new Float32Array(SPL_TIER_A_CAPACITY);
  head = 0;
  count = 0;

  reset(): void {
    this.fastDbA.fill(0);
    this.fastDbC.fill(0);
    this.slowDbA.fill(0);
    this.leq1mDbA.fill(0);
    this.peakDbZ.fill(0);
    this.head = 0;
    this.count = 0;
  }

  shiftOffsetDb(delta: number): void {
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + SPL_TIER_A_CAPACITY) % SPL_TIER_A_CAPACITY;
      this.fastDbA[idx] += delta;
      this.fastDbC[idx] += delta;
      this.slowDbA[idx] += delta;
      this.leq1mDbA[idx] += delta;
      this.peakDbZ[idx] += delta;
    }
  }

  pushSample(
    fastDbA: number,
    fastDbC: number,
    slowDbA: number,
    leq1mDbA: number,
    peakDbZ: number
  ): void {
    const idx = this.head;
    this.fastDbA[idx] = fastDbA;
    this.fastDbC[idx] = fastDbC;
    this.slowDbA[idx] = slowDbA;
    this.leq1mDbA[idx] = leq1mDbA;
    this.peakDbZ[idx] = peakDbZ;
    this.head = (this.head + 1) % SPL_TIER_A_CAPACITY;
    if (this.count < SPL_TIER_A_CAPACITY) {
      this.count++;
    }
  }
}

export class TierBRingBuffers {
  readonly energyA = new Float64Array(SPL_TIER_B_CAPACITY);
  readonly energyC = new Float64Array(SPL_TIER_B_CAPACITY);
  readonly energyZ = new Float64Array(SPL_TIER_B_CAPACITY);
  readonly shortDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  readonly shortDbC = new Float32Array(SPL_TIER_B_CAPACITY);
  readonly leq1mDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  readonly leq1mDbC = new Float32Array(SPL_TIER_B_CAPACITY);
  readonly leq15mDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  readonly leq60mDbA = new Float32Array(SPL_TIER_B_CAPACITY);
  readonly peakDb = new Float32Array(SPL_TIER_B_CAPACITY);
  head = 0;
  count = 0;

  reset(): void {
    this.energyA.fill(0);
    this.energyC.fill(0);
    this.energyZ.fill(0);
    this.shortDbA.fill(0);
    this.shortDbC.fill(0);
    this.leq1mDbA.fill(0);
    this.leq1mDbC.fill(0);
    this.leq15mDbA.fill(0);
    this.leq60mDbA.fill(0);
    this.peakDb.fill(0);
    this.head = 0;
    this.count = 0;
  }

  shiftOffsetDb(delta: number): void {
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
      this.shortDbA[idx] += delta;
      this.shortDbC[idx] += delta;
      this.leq1mDbA[idx] += delta;
      this.leq1mDbC[idx] += delta;
      this.leq15mDbA[idx] += delta;
      this.leq60mDbA[idx] += delta;
      this.peakDb[idx] += delta;
    }
  }
}

export function computeRollingLeqSnapshot(params: {
  readonly tierBCount: number;
  readonly splOffsetDb: number;
  readonly sumsA: CurveSlidingSums;
  readonly sumsC: CurveSlidingSums;
  readonly sumsZ: CurveSlidingSums;
  readonly secEnergySumA: number;
  readonly secEnergySumC: number;
  readonly secEnergySumZ: number;
  readonly secSubCount: number;
  readonly recentPeakSqZ?: number;
}): RollingLeqSnapshot {
  const {
    tierBCount,
    splOffsetDb,
    sumsA,
    sumsC,
    sumsZ,
    secEnergySumA,
    secEnergySumC,
    secEnergySumZ,
    secSubCount,
    recentPeakSqZ = 0,
  } = params;

  const winDb = (sum: number, winSec: number, inFlightE: number): number => {
    if (tierBCount === 0) {
      if (secSubCount > 0) {
        return energyToDb(inFlightE / secSubCount, splOffsetDb);
      }
      return -140.0 + splOffsetDb;
    }
    const denom = Math.max(1, Math.min(winSec, tierBCount));
    return energyToDb(sum / denom, splOffsetDb);
  };

  const leq1m: Record<WeightingCurve, number> = {
    A: winDb(sumsA.sum60s, 60, secEnergySumA),
    C: winDb(sumsC.sum60s, 60, secEnergySumC),
    Z: winDb(sumsZ.sum60s, 60, secEnergySumZ),
  };
  const leq5m: Record<WeightingCurve, number> = {
    A: winDb(sumsA.sum300s, 300, secEnergySumA),
    C: winDb(sumsC.sum300s, 300, secEnergySumC),
    Z: winDb(sumsZ.sum300s, 300, secEnergySumZ),
  };
  const leq15m: Record<WeightingCurve, number> = {
    A: winDb(sumsA.sum900s, 900, secEnergySumA),
    C: winDb(sumsC.sum900s, 900, secEnergySumC),
    Z: winDb(sumsZ.sum900s, 900, secEnergySumZ),
  };
  const leq60m: Record<WeightingCurve, number> = {
    A: winDb(sumsA.sum3600s, 3600, secEnergySumA),
    C: winDb(sumsC.sum3600s, 3600, secEnergySumC),
    Z: winDb(sumsZ.sum3600s, 3600, secEnergySumZ),
  };

  return {
    leq1m,
    leq5m,
    leq15m,
    leq60m,
    cMinusALeq1mDb: leq1m.C - leq1m.A,
    recentPeakDbZ: energyToDb(recentPeakSqZ, splOffsetDb),
  };
}

export function exportRingWindowSnapshot(params: {
  readonly epochSeq: number;
  readonly windowSec: SplHistoryWindowSec;
  readonly maxPoints: number;
  readonly tierA: TierARingBuffers;
  readonly tierB: TierBRingBuffers;
  readonly rolling: RollingLeqSnapshot;
}): SplHistoryData {
  const { epochSeq, windowSec, maxPoints, tierA, tierB, rolling } = params;

  if (windowSec <= 300) {
    const requestedSamples = Math.min(tierA.count, Math.round(windowSec * 4));
    const length = requestedSamples;
    const timeSec = new Float32Array(length);
    const shortTermDbA = new Float32Array(length);
    const shortTermDbC = new Float32Array(length);
    const leq1mDbA = new Float32Array(length);
    const leq1mDbC = new Float32Array(length);
    const leq15mDbA = new Float32Array(length);
    const leq60mDbA = new Float32Array(length);
    const peakDb = new Float32Array(length);

    const startIdx = (tierA.head - requestedSamples + SPL_TIER_A_CAPACITY) % SPL_TIER_A_CAPACITY;

    for (let i = 0; i < length; i++) {
      const ringIdx = (startIdx + i) % SPL_TIER_A_CAPACITY;
      timeSec[i] = -((length - 1 - i) * 0.25) || 0;
      shortTermDbA[i] = tierA.fastDbA[ringIdx];
      shortTermDbC[i] = tierA.fastDbC[ringIdx];
      leq1mDbA[i] = tierA.leq1mDbA[ringIdx];
      const secOffsetFromNow = Math.floor((length - 1 - i) / 4);
      if (tierB.count > secOffsetFromNow) {
        const bIdx =
          (tierB.head - 1 - secOffsetFromNow + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
        leq1mDbC[i] = tierB.leq1mDbC[bIdx];
        leq15mDbA[i] = tierB.leq15mDbA[bIdx];
        leq60mDbA[i] = tierB.leq60mDbA[bIdx];
      } else {
        leq1mDbC[i] = rolling.leq1m.C;
        leq15mDbA[i] = rolling.leq15m.A;
        leq60mDbA[i] = rolling.leq60m.A;
      }
      peakDb[i] = tierA.peakDbZ[ringIdx];
    }

    return {
      epochSeq,
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

  const rawCount = Math.min(tierB.count, windowSec);
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

  const startIdx = (tierB.head - rawCount + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;

  for (let outIdx = 0; outIdx < length; outIdx++) {
    const sampleOffset = Math.min(rawCount - 1, outIdx * stride);
    const ringIdx = (startIdx + sampleOffset) % SPL_TIER_B_CAPACITY;
    timeSec[outIdx] = -(rawCount - 1 - sampleOffset) || 0;
    shortTermDbA[outIdx] = tierB.shortDbA[ringIdx];
    shortTermDbC[outIdx] = tierB.shortDbC[ringIdx];
    leq1mDbA[outIdx] = tierB.leq1mDbA[ringIdx];
    leq1mDbC[outIdx] = tierB.leq1mDbC[ringIdx];
    leq15mDbA[outIdx] = tierB.leq15mDbA[ringIdx];
    leq60mDbA[outIdx] = tierB.leq60mDbA[ringIdx];

    let maxPk = tierB.peakDb[ringIdx];
    for (let s = 1; s < stride && sampleOffset + s < rawCount; s++) {
      const subIdx = (startIdx + sampleOffset + s) % SPL_TIER_B_CAPACITY;
      if (tierB.peakDb[subIdx] > maxPk) {
        maxPk = tierB.peakDb[subIdx];
      }
    }
    peakDb[outIdx] = maxPk;
  }

  return {
    epochSeq,
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
