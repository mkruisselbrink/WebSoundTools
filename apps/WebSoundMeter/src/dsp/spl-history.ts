// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dual-Resolution 4-Hour SPL & Sliding-Window Leq History Tracker coordinator.
 */

import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  SPL_CHECKPOINT_MAX_AGE_MS,
  SPL_TIER_A_CAPACITY,
  SPL_TIER_B_CAPACITY,
  SplAlertMetric,
  SplAlertThresholds,
  SplHistoryCheckpoint,
  SplHistoryData,
  SplHistoryTraceMode,
  SplHistoryWindowSec,
  energyToDb,
} from './spl-compliance.js';
import {
  SplChronologicalRow,
  extractChronologicalRows,
  formatSplHistoryCsv,
} from './spl-csv-export.js';
import {
  TierARingBuffers,
  TierBRingBuffers,
  computeRollingLeqSnapshot,
  createCurveSlidingSums,
  exportRingWindowSnapshot,
  recomputeCurveSums,
  resetCurveSlidingSums,
  updateSlidingSumsForCurve,
} from './spl-ring-buffers.js';
import {
  BroadbandMeterBank,
  EpochEnergySnapshot,
  RollingLeqSnapshot,
} from './weighting-meters.js';

export {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  SPL_CHECKPOINT_MAX_AGE_MS,
  SPL_TIER_A_CAPACITY,
  SPL_TIER_B_CAPACITY,
  formatSplHistoryCsv,
};
export type {
  SplAlertMetric,
  SplAlertThresholds,
  SplChronologicalRow,
  SplHistoryCheckpoint,
  SplHistoryData,
  SplHistoryTraceMode,
  SplHistoryWindowSec,
};

export class SplHistoryTracker {
  private sampleRate: number;
  private splOffsetDb: number;
  private samplesPerSubEpoch: number;
  private samplesSinceSubEpoch = 0;
  private subEpochCounter = 0;
  private epochSeq = 0;
  private activeWindowSec: SplHistoryWindowSec = 900;

  private secEnergySumA = 0;
  private secEnergySumC = 0;
  private secEnergySumZ = 0;
  private secSubCount = 0;
  private secLastFastSqA = 0;
  private secLastFastSqC = 0;
  private secMaxPeakSqZ = 0;

  private readonly tierA = new TierARingBuffers();
  private readonly tierB = new TierBRingBuffers();
  private secondsSinceRecalc = 0;

  private readonly sumsA = createCurveSlidingSums();
  private readonly sumsC = createCurveSlidingSums();
  private readonly sumsZ = createCurveSlidingSums();

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
    this.tierA.shiftOffsetDb(delta);
    this.tierB.shiftOffsetDb(delta);
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
    return this.tierA.count;
  }

  getTierBCount(): number {
    return this.tierB.count;
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
    this.secondsSinceRecalc = 0;

    this.tierA.reset();
    this.tierB.reset();
    resetCurveSlidingSums(this.sumsA);
    resetCurveSlidingSums(this.sumsC);
    resetCurveSlidingSums(this.sumsZ);

    this.epochSeq++;
  }

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

  pushSubEpochEnergy(epoch: EpochEnergySnapshot): void {
    const offset = this.splOffsetDb;

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
    this.tierA.pushSample(
      energyToDb(epoch.A.fastSq, offset),
      energyToDb(epoch.C.fastSq, offset),
      energyToDb(epoch.A.slowSq, offset),
      rolling.leq1m.A,
      energyToDb(epoch.Z.maxPeakSq, offset)
    );

    this.epochSeq++;
  }

  private commitOneSecondEpoch(): void {
    const invSub = this.secSubCount > 0 ? 1.0 / this.secSubCount : 1.0;
    const eA = this.secEnergySumA * invSub;
    const eC = this.secEnergySumC * invSub;
    const eZ = this.secEnergySumZ * invSub;

    const head = this.tierB.head;
    const count = this.tierB.count;

    updateSlidingSumsForCurve(this.sumsA, this.tierB.energyA, head, count, eA);
    updateSlidingSumsForCurve(this.sumsC, this.tierB.energyC, head, count, eC);
    updateSlidingSumsForCurve(this.sumsZ, this.tierB.energyZ, head, count, eZ);

    this.tierB.energyA[head] = eA;
    this.tierB.energyC[head] = eC;
    this.tierB.energyZ[head] = eZ;

    this.tierB.head = (head + 1) % SPL_TIER_B_CAPACITY;
    if (this.tierB.count < SPL_TIER_B_CAPACITY) {
      this.tierB.count++;
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
    this.tierB.shortDbA[head] = energyToDb(this.secLastFastSqA, offset);
    this.tierB.shortDbC[head] = energyToDb(this.secLastFastSqC, offset);
    this.tierB.leq1mDbA[head] = rolling.leq1m.A;
    this.tierB.leq1mDbC[head] = rolling.leq1m.C;
    this.tierB.leq15mDbA[head] = rolling.leq15m.A;
    this.tierB.leq60mDbA[head] = rolling.leq60m.A;
    this.tierB.peakDb[head] = energyToDb(this.secMaxPeakSqZ, offset);

    this.secMaxPeakSqZ = 0;
  }

  recomputeSlidingSums(): void {
    recomputeCurveSums(this.sumsA, this.tierB.energyA, this.tierB.head, this.tierB.count);
    recomputeCurveSums(this.sumsC, this.tierB.energyC, this.tierB.head, this.tierB.count);
    recomputeCurveSums(this.sumsZ, this.tierB.energyZ, this.tierB.head, this.tierB.count);
  }

  getRollingLeq(): RollingLeqSnapshot {
    return computeRollingLeqSnapshot({
      tierBCount: this.tierB.count,
      splOffsetDb: this.splOffsetDb,
      sumsA: this.sumsA,
      sumsC: this.sumsC,
      sumsZ: this.sumsZ,
      secEnergySumA: this.secEnergySumA,
      secEnergySumC: this.secEnergySumC,
      secEnergySumZ: this.secEnergySumZ,
      secSubCount: this.secSubCount,
    });
  }

  exportWindow(
    windowSec: SplHistoryWindowSec = this.activeWindowSec,
    maxPoints: number = 1800
  ): SplHistoryData {
    return exportRingWindowSnapshot({
      epochSeq: this.epochSeq,
      windowSec,
      maxPoints,
      tierA: this.tierA,
      tierB: this.tierB,
      rolling: this.getRollingLeq(),
    });
  }

  serializeCheckpoint(slotId: string, nowMs: number = Date.now()): SplHistoryCheckpoint {
    const n = this.tierB.count;
    const startIdx = (this.tierB.head - n + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
    const energyA = new Array<number>(n);
    const energyC = new Array<number>(n);
    const energyZ = new Array<number>(n);
    const shortTermDbA = new Array<number>(n);
    const shortTermDbC = new Array<number>(n);
    const peakDb = new Array<number>(n);

    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % SPL_TIER_B_CAPACITY;
      energyA[i] = this.tierB.energyA[idx];
      energyC[i] = this.tierB.energyC[idx];
      energyZ[i] = this.tierB.energyZ[idx];
      shortTermDbA[i] = this.tierB.shortDbA[idx];
      shortTermDbC[i] = this.tierB.shortDbC[idx];
      peakDb[i] = this.tierB.peakDb[idx];
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

      const head = this.tierB.head;
      const count = this.tierB.count;
      updateSlidingSumsForCurve(this.sumsA, this.tierB.energyA, head, count, eA);
      updateSlidingSumsForCurve(this.sumsC, this.tierB.energyC, head, count, eC);
      updateSlidingSumsForCurve(this.sumsZ, this.tierB.energyZ, head, count, eZ);

      this.tierB.energyA[head] = eA;
      this.tierB.energyC[head] = eC;
      this.tierB.energyZ[head] = eZ;

      this.tierB.head = (head + 1) % SPL_TIER_B_CAPACITY;
      if (this.tierB.count < SPL_TIER_B_CAPACITY) {
        this.tierB.count++;
      }

      const rolling = this.getRollingLeq();
      this.tierB.shortDbA[head] = checkpoint.shortTermDbA[i] ?? rolling.leq1m.A;
      this.tierB.shortDbC[head] = checkpoint.shortTermDbC[i] ?? rolling.leq1m.C;
      this.tierB.leq1mDbA[head] = rolling.leq1m.A;
      this.tierB.leq1mDbC[head] = rolling.leq1m.C;
      this.tierB.leq15mDbA[head] = rolling.leq15m.A;
      this.tierB.leq60mDbA[head] = rolling.leq60m.A;
      this.tierB.peakDb[head] = checkpoint.peakDb[i] ?? rolling.leq1m.Z;

      if (i >= n - 300) {
        const fastA = this.tierB.shortDbA[head];
        const fastC = this.tierB.shortDbC[head];
        const pkZ = this.tierB.peakDb[head];
        const leq1A = rolling.leq1m.A;
        for (let sub = 0; sub < 4; sub++) {
          this.tierA.pushSample(fastA, fastC, fastA, leq1A, pkZ);
        }
      }
    }

    this.recomputeSlidingSums();
    this.epochSeq++;
    return true;
  }

  getChronologicalRows(nowMs: number = Date.now()): SplChronologicalRow[] {
    return extractChronologicalRows(this.tierB, this.splOffsetDb, nowMs);
  }
}
