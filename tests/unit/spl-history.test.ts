import { describe, expect, it } from 'vitest';
import {
  formatSplHistoryCsv,
  SPL_CHECKPOINT_MAX_AGE_MS,
  SPL_TIER_A_CAPACITY,
  SPL_TIER_B_CAPACITY,
  SplHistoryTracker,
} from '../../src/dsp/spl-history.js';
import { BroadbandMeterBank, EpochEnergySnapshot } from '../../src/dsp/weighting-meters.js';

function makeSyntheticEpoch(
  meanSqA: number,
  meanSqC: number = meanSqA,
  meanSqZ: number = meanSqA,
  maxPeakSq: number = meanSqZ * 2.0
): EpochEnergySnapshot {
  return {
    A: {
      meanSq: meanSqA,
      fastSq: meanSqA,
      slowSq: meanSqA,
      maxPeakSq,
      sampleCount: 12000,
    },
    C: {
      meanSq: meanSqC,
      fastSq: meanSqC,
      slowSq: meanSqC,
      maxPeakSq,
      sampleCount: 12000,
    },
    Z: {
      meanSq: meanSqZ,
      fastSq: meanSqZ,
      slowSq: meanSqZ,
      maxPeakSq,
      sampleCount: 12000,
    },
  };
}

describe('SplHistoryTracker (Dual-Resolution 4-Hour Ring Buffer & Sliding Leq)', () => {
  it('computes accurate 1m, 5m, 15m, and 60m sliding Leq and C-minus-A balance', () => {
    const tracker = new SplHistoryTracker(48000, 100.0);

    // Push 60 seconds (240 sub-epochs) where A = 0.01 (-20 dBFS -> 80 dB SPL)
    // and C = 0.1 (-10 dBFS -> 90 dB SPL)
    for (let s = 0; s < 60 * 4; s++) {
      tracker.pushSubEpochEnergy(makeSyntheticEpoch(0.01, 0.1, 0.1));
    }

    expect(tracker.getTierACount()).toBe(240);
    expect(tracker.getTierBCount()).toBe(60);

    const rolling1 = tracker.getRollingLeq();
    expect(rolling1.leq1m.A).toBeCloseTo(80.0, 2);
    expect(rolling1.leq1m.C).toBeCloseTo(90.0, 2);
    expect(rolling1.cMinusALeq1mDb).toBeCloseTo(10.0, 2);
    // Warm-up denominator clamps to 60s for 5m/15m/60m windows when only 60s have elapsed
    expect(rolling1.leq15m.A).toBeCloseTo(80.0, 2);
    expect(rolling1.leq60m.A).toBeCloseTo(80.0, 2);

    // Now push another 60 seconds at 1.0 (0 dBFS -> 100 dB SPL)
    for (let s = 0; s < 60 * 4; s++) {
      tracker.pushSubEpochEnergy(makeSyntheticEpoch(1.0, 1.0, 1.0));
    }

    const rolling2 = tracker.getRollingLeq();
    // 1-minute window now contains only the second minute (1.0 -> 100 dB SPL)
    expect(rolling2.leq1m.A).toBeCloseTo(100.0, 2);
    // 5-minute / 15-minute windows contain 60s of 0.01 and 60s of 1.0 -> average = 0.505 -> 97.03 dB SPL
    const expectedAvgDb = 10 * Math.log10(0.505) + 100.0;
    expect(rolling2.leq5m.A).toBeCloseTo(expectedAvgDb, 2);
    expect(rolling2.leq15m.A).toBeCloseTo(expectedAvgDb, 2);
  });

  it('integrates with BroadbandMeterBank via advanceSamples at 4 Hz and 1 Hz', () => {
    const sampleRate = 48000;
    const meterBank = new BroadbandMeterBank(sampleRate, 100.0);
    const tracker = new SplHistoryTracker(sampleRate, 100.0);

    // Generate 2 seconds of 1 kHz sine wave (where A, C, and Z weightings are all 0.0 dB)
    const blockSize = 1200;
    const blockM = new Float32Array(blockSize);
    const blockR = new Float32Array(blockSize);
    let phase = 0;
    const phaseInc = (2 * Math.PI * 1000) / sampleRate;

    for (let b = 0; b < (sampleRate * 2) / blockSize; b++) {
      for (let i = 0; i < blockSize; i++) {
        blockM[i] = Math.sin(phase);
        phase += phaseInc;
      }
      meterBank.processBlock(blockM, blockR, blockSize);
      tracker.advanceSamples(blockSize, meterBank);
    }

    // 2 seconds = 8 sub-epochs (Tier A) and 2 full seconds (Tier B)
    expect(tracker.getTierACount()).toBe(8);
    expect(tracker.getTierBCount()).toBe(2);

    // Amplitude 1.0 sine wave has RMS^2 = 0.5 (-3.01 dBFS -> 96.99 dB SPL)
    const rolling = tracker.getRollingLeq();
    expect(rolling.leq1m.A).toBeGreaterThan(96.0);
    expect(rolling.leq1m.A).toBeLessThan(97.5);
  });

  it('wraps Tier A (1,200) and Tier B (14,400) ring buffers and recomputes sums without drift', () => {
    const tracker = new SplHistoryTracker(48000, 100.0);

    // Push 1,300 seconds (5,200 sub-epochs) to wrap Tier A > 4x and trigger the 1,024-second drift recomputation
    for (let sec = 0; sec < 1300; sec++) {
      for (let sub = 0; sub < 4; sub++) {
        tracker.pushSubEpochEnergy(makeSyntheticEpoch(0.1, 0.2, 0.2, 1.0));
      }
    }

    expect(tracker.getTierACount()).toBe(SPL_TIER_A_CAPACITY);
    expect(tracker.getTierBCount()).toBe(1300);

    const win5m = tracker.exportWindow(300);
    expect(win5m.stepSec).toBe(0.25);
    expect(win5m.length).toBe(1200);
    expect(win5m.timeSec[0]).toBeCloseTo(-299.75, 2);
    expect(win5m.timeSec[win5m.length - 1]).toBe(0);

    const win15m = tracker.exportWindow(900);
    expect(win15m.stepSec).toBe(1.0);
    expect(win15m.length).toBe(900);
    expect(win15m.timeSec[0]).toBe(-899);
    expect(win15m.timeSec[win15m.length - 1]).toBe(0);
    expect(win15m.leq15mDbA[win15m.length - 1]).toBeCloseTo(90.0, 2);
  });

  it('decimates 4-hour (14,400s) Tier B exports to <= 1,800 display points while preserving max peak', () => {
    const tracker = new SplHistoryTracker(48000, 100.0);

    for (let sec = 0; sec < SPL_TIER_B_CAPACITY + 50; sec++) {
      const peakSq = sec === SPL_TIER_B_CAPACITY - 5 ? 10.0 : 0.5;
      for (let sub = 0; sub < 4; sub++) {
        tracker.pushSubEpochEnergy(makeSyntheticEpoch(0.1, 0.1, 0.1, peakSq));
      }
    }

    expect(tracker.getTierBCount()).toBe(SPL_TIER_B_CAPACITY);
    const win4h = tracker.exportWindow(14400, 1800);
    expect(win4h.length).toBeLessThanOrEqual(1800);
    expect(win4h.stepSec).toBe(8); // 14400 / 1800 = 8s stride

    // Ensure the single-second 110 dB peak spike was preserved across the 8-second decimation bucket
    const maxExportedPeak = Math.max(...Array.from(win4h.peakDb));
    expect(maxExportedPeak).toBeCloseTo(110.0, 1);
  });

  it('serializes and hydrates checkpoints within 30 minutes and formats CSV rows', () => {
    const tracker = new SplHistoryTracker(48000, 100.0);
    const nowMs = 1_700_000_000_000;

    for (let sec = 0; sec < 10; sec++) {
      for (let sub = 0; sub < 4; sub++) {
        tracker.pushSubEpochEnergy(makeSyntheticEpoch(0.01, 0.1, 0.1, 1.0));
      }
    }

    const cp = tracker.serializeCheckpoint('live-measurement', nowMs);
    expect(cp.tierBCount).toBe(10);

    const restored = new SplHistoryTracker(48000, 100.0);
    expect(restored.hydrateCheckpoint(cp, nowMs + 5_000)).toBe(true);
    expect(restored.getTierBCount()).toBe(10);
    expect(restored.getRollingLeq().leq1m.A).toBeCloseTo(80.0, 2);

    // Reject stale checkpoints older than 30 minutes
    const stale = new SplHistoryTracker(48000, 100.0);
    expect(stale.hydrateCheckpoint(cp, nowMs + SPL_CHECKPOINT_MAX_AGE_MS + 1000)).toBe(false);

    // CSV formatting check
    const csv = formatSplHistoryCsv(
      [{ slotId: 'live-measurement', slotName: 'FOH Mic', tracker: restored }],
      nowMs
    );
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'timestamp_iso,elapsed_sec,slot_id,slot_name,laf_db,lcf_db,laeq_1m_db,lceq_1m_db,laeq_5m_db,laeq_15m_db,laeq_60m_db,lpeak_db'
    );
    expect(lines.length).toBe(11); // 1 header + 10 rows
    expect(lines[1]).toContain('live-measurement,FOH Mic,80.0,90.0,80.0,90.0,80.0,80.0,80.0,100.0');
  });
});
