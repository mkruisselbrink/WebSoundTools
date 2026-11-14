// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * SPL & Leq history data contracts, compliance alert thresholds, and energy-to-dB conversion.
 */

export const SPL_TIER_A_CAPACITY = 1200; // 5 minutes @ 4 Hz (250 ms)
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
  readonly epochSeq: number;
  readonly length: number;
  readonly stepSec: number;
  readonly timeSec: Float32Array;
  readonly shortTermDbA: Float32Array;
  readonly shortTermDbC: Float32Array;
  readonly leq1mDbA: Float32Array;
  readonly leq1mDbC: Float32Array;
  readonly leq15mDbA: Float32Array;
  readonly leq60mDbA: Float32Array;
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

export function energyToDb(meanSq: number, splOffsetDb: number): number {
  return meanSq > 1e-20 ? 10.0 * Math.log10(meanSq) + splOffsetDb : -140.0 + splOffsetDb;
}
