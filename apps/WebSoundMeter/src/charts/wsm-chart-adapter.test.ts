// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_SPL_ALERT_THRESHOLDS } from '../dsp/spl-history.js';
import {
  type SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../sources/source-data.js';
import {
  buildSplSeriesVertices,
  buildTraceVertices,
  computeCoherenceAlpha,
  computeCursorReadout,
  formatRelativeTimeLabel,
  normXToValue,
  valueToNormX,
} from './plot-types.js';
import { buildWsmChartScene, buildWsmCursorReadoutModel } from './wsm-chart-adapter.js';

describe('WSM plot-types & wsm-chart-adapter', () => {
  it('inverts valueToNormX and normXToValue and inserts phase-wrap break vertices', () => {
    for (const freq of [20, 100, 632.45, 1000, 8000, 20000]) {
      const nx = valueToNormX(freq, 20, 20000, true);
      expect(normXToValue(nx, 20, 20000, true)).toBeCloseTo(freq, 2);
    }

    const bCount = 65;
    const sr = 48000;
    const fd = createEmptyFrequencyDomainData(bCount, sr);
    fd.coherence.fill(1.0);
    for (let i = 1; i < bCount; i++) {
      const deg = i <= 10 ? 179 : -179;
      const rad = (deg * Math.PI) / 180;
      fd.phaseReal[i] = Math.cos(rad);
      fd.phaseImag[i] = Math.sin(rad);
    }

    const src: SourceData = {
      id: 'p1',
      name: 'Wrap Test',
      kind: 'stored',
      color: '#38bdf8',
      visible: true,
      active: true,
      gainOffsetDb: 0,
      delayOffsetMs: 0,
      invertPolarity: false,
      notes: '',
      createdAt: '',
      sampleRate: sr,
      freqData: fd,
      timeData: createEmptyTimeDomainData(128, sr),
    };

    const buf = buildTraceVertices(src, 'phase', 20, 24000, -180, 180, true, 0.35);
    let zeroAlphaCount = 0;
    for (let v = 0; v < buf.vertexCount; v++) {
      if (buf.vertices[v * 3 + 2] === 0.0) zeroAlphaCount++;
    }
    expect(zeroAlphaCount).toBe(2);
  });

  it('computes acoustic cursor readout and builds ChartScene for RTA, Magnitude EQ, and SPL History', () => {
    expect(computeCoherenceAlpha(1.0, 0.4, true)).toBe(1.0);
    expect(formatRelativeTimeLabel(-900)).toBe('-15m');

    const bCount = 513;
    const sr = 48000;
    const fd = createEmptyFrequencyDomainData(bCount, sr);
    fd.magnitude.fill(2.0);
    fd.module.fill(0.5);
    fd.peakSquared.fill(0.8);
    fd.coherence.fill(0.95);

    const timeSec = new Float32Array([-3, -2, -1, 0]);
    const seriesDb = new Float32Array([85, 88, 92, 95]);
    expect(buildSplSeriesVertices(timeSec, seriesDb, 4, -5, 0, 50, 120).vertexCount).toBe(4);

    const src: SourceData = {
      id: 's1',
      name: 'Main PA',
      kind: 'measurement',
      color: '#38bdf8',
      visible: true,
      active: true,
      gainOffsetDb: 0,
      delayOffsetMs: 2.5,
      invertPolarity: false,
      notes: '',
      createdAt: '',
      sampleRate: sr,
      freqData: fd,
      timeData: createEmptyTimeDomainData(1024, sr),
      splHistory: {
        epochSeq: 4,
        length: 4,
        stepSec: 1.0,
        timeSec,
        shortTermDbA: seriesDb,
        shortTermDbC: new Float32Array([90, 92, 96, 99]),
        peakDb: new Float32Array([100, 102, 106, 109]),
        leq1mDbA: new Float32Array([84, 86, 89, 91]),
        leq1mDbC: new Float32Array([89, 91, 94, 96]),
        leq15mDbA: new Float32Array([83, 85, 87, 90]),
        leq60mDbA: new Float32Array([82, 84, 86, 88]),
      },
      feedbackTracks: [
        {
          id: 's1:2500',
          slotId: 's1',
          slotName: 'Main PA',
          slotColor: '#38bdf8',
          state: 'feedback',
          frequencyHz: 2480,
          isoBandHz: 2500,
          isoBandLabel: '2.5 kHz',
          musicalNote: 'D#7 (-23c)',
          prominenceDb: 15.2,
          peakLevelDb: -4.0,
          estimatedQ: 42,
          durationMs: 480,
          firstDetectedAt: '',
          latchRemainingRatio: 1.0,
        },
      ],
    };
    src.timeData.impulse[512] = 0.825;

    const readout = computeCursorReadout('magnitude', 1000, [src]);
    expect(readout.isFrequencyDomain).toBe(true);
    expect(readout.wavelengthMeters).toBeCloseTo(0.343, 3);
    expect(readout.sourceValues[0].formattedValue).toBe('+6.0 dB');

    const hudModel = buildWsmCursorReadoutModel('magnitude', 1000, [src]);
    expect(hudModel.headerText).toContain('1.00 kHz');
    expect(hudModel.rows[0].text).toContain('Main PA: +6.0 dB');

    const impReadout = computeCursorReadout('impulse', 2.5, [src]);
    expect(impReadout.sourceValues[0].formattedValue).toBe('0.825');

    const magScene = buildWsmChartScene({
      plotType: 'magnitude',
      bounds: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24 },
      sources: [src],
      eqBands: [{ type: 'peaking', frequency: 1000, q: 2, gainDb: -3, enabled: true }],
      rtaMode: 'bars-3',
      showPeakHold: true,
      coherenceAlpha: true,
      coherenceThreshold: 0.35,
      showFeedbackWatch: true,
      splTraceMode: 'compliance-15m',
      showSplThresholds: true,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
    });
    expect(magScene.traces?.length).toBe(1);
    expect(magScene.eqOverlay?.referenceZeroDbY).toBe(0);
    expect(magScene.calloutFlags?.[0].line1).toContain('2.48 kHz');

    const rtaScene = buildWsmChartScene({
      plotType: 'rta',
      bounds: { xMin: 20, xMax: 20000, yMin: -90, yMax: 0 },
      sources: [src],
      eqBands: null,
      rtaMode: 'bars-3',
      showPeakHold: true,
      coherenceAlpha: true,
      coherenceThreshold: 0.35,
      showFeedbackWatch: true,
      splTraceMode: 'compliance-15m',
      showSplThresholds: true,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
    });
    expect(rtaScene.rtaBars?.length).toBe(1);

    const splScene = buildWsmChartScene({
      plotType: 'spl-history',
      bounds: { xMin: -60, xMax: 0, yMin: 50, yMax: 115 },
      sources: [src],
      eqBands: null,
      rtaMode: 'bars-3',
      showPeakHold: true,
      coherenceAlpha: true,
      coherenceThreshold: 0.35,
      showFeedbackWatch: false,
      splTraceMode: 'compliance-15m',
      showSplThresholds: true,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
    });
    expect(splScene.thresholdGuide).toBeDefined();
    expect(splScene.traces?.length).toBeGreaterThanOrEqual(3);

    // Hard coherence cutoff mode blanks bins strictly below coherenceThreshold (alpha = 0)
    // and keeps bins >= coherenceThreshold at full solid opacity (alpha = 1)
    fd.coherence.fill(0.5);
    for (let i = 100; i < 200; i++) {
      fd.coherence[i] = 0.85;
    }
    const cutoffScene = buildWsmChartScene({
      plotType: 'magnitude',
      bounds: { xMin: 20, xMax: 24000, yMin: -24, yMax: 24 },
      sources: [src],
      eqBands: null,
      rtaMode: 'bars-3',
      showPeakHold: false,
      coherenceMode: 'cutoff',
      coherenceThreshold: 0.7,
      showFeedbackWatch: false,
      splTraceMode: 'compliance-15m',
      showSplThresholds: false,
      splAlertThresholds: DEFAULT_SPL_ALERT_THRESHOLDS,
    });
    const cutoffTrace = cutoffScene.traces?.[0];
    expect(cutoffTrace?.ndcVertices).toBeDefined();
    let solidCount = 0;
    let blankedCount = 0;
    for (let v = 0; v < (cutoffTrace?.ndcVertexCount ?? 0); v++) {
      const a = cutoffTrace!.ndcVertices![v * 3 + 2];
      if (a === 1.0) solidCount++;
      else if (a === 0.0) blankedCount++;
    }
    expect(solidCount).toBe(100);
    expect(blankedCount).toBeGreaterThan(300);
  });
});
