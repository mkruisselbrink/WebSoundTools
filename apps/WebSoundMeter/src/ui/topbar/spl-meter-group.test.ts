// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_SPL_ALERT_THRESHOLDS } from '../../dsp/spl-history.js';
import type { BroadbandLevelsSnapshot } from '../../dsp/weighting-meters.js';
import { evaluateMonitoredMetricDb, renderSplMeterGroup } from './spl-meter-group.js';

function makeSnapshot(params: {
  fastA: number;
  leq15mA: number;
  allTimePeakZ: number;
  recentPeakZ: number;
}): BroadbandLevelsSnapshot {
  const curveLevels = {
    Fast: params.fastA,
    Slow: params.fastA,
    Impulse: params.fastA,
    Leq: params.leq15mA,
  };
  return {
    levelsDb: { A: curveLevels, C: curveLevels, Z: curveLevels },
    peaksDb: { A: params.allTimePeakZ, C: params.allTimePeakZ, Z: params.allTimePeakZ },
    referenceRmsDb: -12,
    referencePeakDb: -3,
    splOffsetDb: 100,
    rollingLeq: {
      leq1m: { A: params.fastA, C: params.fastA, Z: params.fastA },
      leq5m: { A: params.leq15mA, C: params.leq15mA, Z: params.leq15mA },
      leq15m: { A: params.leq15mA, C: params.leq15mA, Z: params.leq15mA },
      leq60m: { A: params.leq15mA, C: params.leq15mA, Z: params.leq15mA },
      cMinusALeq1mDb: 0,
      recentPeakDbZ: params.recentPeakZ,
    },
  };
}

describe('spl-meter-group alert evaluation & recovery', () => {
  it('clears alert outline in Tuning mode immediately when live SPL drops below warning threshold, even if 15m Leq was elevated', () => {
    const loudSnap = makeSnapshot({
      fastA: 103.5,
      leq15mA: 103.5,
      allTimePeakZ: 109.0,
      recentPeakZ: 108.0,
    });
    expect(
      evaluateMonitoredMetricDb(loudSnap, DEFAULT_SPL_ALERT_THRESHOLDS, 'tuning', 'A', 'Fast')
    ).toBe(103.5);

    const loudTpl = renderSplMeterGroup({
      workspaceMode: 'tuning',
      splWeighting: 'A',
      splTime: 'Fast',
      levels: loudSnap,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
      onSplWeightingChange: () => {},
      onSplTimeChange: () => {},
    });
    expect(loudTpl.values.join(' ')).toContain('alert-limit');

    // Signal returns to 74.5 dBA while historical 15-minute LAeq remains 101.2 dBA
    const recoveredSnap = makeSnapshot({
      fastA: 74.5,
      leq15mA: 101.2,
      allTimePeakZ: 109.0,
      recentPeakZ: 82.0,
    });
    expect(
      evaluateMonitoredMetricDb(
        recoveredSnap,
        DEFAULT_SPL_ALERT_THRESHOLDS,
        'tuning',
        'A',
        'Fast'
      )
    ).toBe(74.5);

    const recoveredTpl = renderSplMeterGroup({
      workspaceMode: 'tuning',
      splWeighting: 'A',
      splTime: 'Fast',
      levels: recoveredSnap,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
      onSplWeightingChange: () => {},
      onSplTimeChange: () => {},
    });
    expect(recoveredTpl.values.join(' ')).not.toContain('alert-limit');
    expect(recoveredTpl.values.join(' ')).not.toContain('alert-warn');
  });

  it('uses short-term recentPeakDbZ for Show mode LZpeak alerts so transients recover instead of latching all-time peak', () => {
    const snapAfterTransient = makeSnapshot({
      fastA: 78.0,
      leq15mA: 82.0,
      allTimePeakZ: 112.0,
      recentPeakZ: 88.0,
    });
    const peakThresholds = {
      ...DEFAULT_SPL_ALERT_THRESHOLDS,
      metric: 'LZpeak' as const,
      warningDb: 98,
      limitDb: 102,
    };
    expect(evaluateMonitoredMetricDb(snapAfterTransient, peakThresholds, 'show')).toBe(88.0);
  });

  it('never mounts or unmounts status badge in Tuning mode on peaks while keeping a fixed badge slot in Show mode', () => {
    const quietSnap = makeSnapshot({
      fastA: 72.0,
      leq15mA: 72.0,
      allTimePeakZ: 80.0,
      recentPeakZ: 76.0,
    });
    const loudSnap = makeSnapshot({
      fastA: 103.5,
      leq15mA: 103.5,
      allTimePeakZ: 109.0,
      recentPeakZ: 108.0,
    });

    const tuningLoud = renderSplMeterGroup({
      workspaceMode: 'tuning',
      splWeighting: 'A',
      splTime: 'Fast',
      levels: loudSnap,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
      onSplWeightingChange: () => {},
      onSplTimeChange: () => {},
    });
    const tuningQuiet = renderSplMeterGroup({
      workspaceMode: 'tuning',
      splWeighting: 'A',
      splTime: 'Fast',
      levels: quietSnap,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
      onSplWeightingChange: () => {},
      onSplTimeChange: () => {},
    });
    // Identical structural child count in Tuning mode across quiet and loud frames
    expect(tuningLoud.values.length).toBe(tuningQuiet.values.length);

    const showQuiet = renderSplMeterGroup({
      workspaceMode: 'show',
      splWeighting: 'A',
      splTime: 'Fast',
      levels: quietSnap,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
      onSplWeightingChange: () => {},
      onSplTimeChange: () => {},
    });
    const showLoud = renderSplMeterGroup({
      workspaceMode: 'show',
      splWeighting: 'A',
      splTime: 'Fast',
      levels: loudSnap,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
      onSplWeightingChange: () => {},
      onSplTimeChange: () => {},
    });
    expect(showQuiet.values.length).toBe(showLoud.values.length);
  });
});
