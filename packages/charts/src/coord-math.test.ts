// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  buildTraceNdcVertices,
  computeAdaptiveGroupDelayBounds,
  computeAdaptiveMagnitudeBounds,
  computeCoherenceAlpha,
  computeZoomedYRange,
  formatFrequencyLabel,
  formatRelativeTimeLabel,
  getChartPlotBox,
  normXToValue,
  normYToValue,
  valueToNormX,
  valueToNormY,
} from './coord-math.js';

describe('coord-math', () => {
  it('round-trips logarithmic and linear X/Y coordinate mappings', () => {
    for (const freq of [20, 100, 632.45, 1000, 8000, 20000]) {
      const nx = valueToNormX(freq, 20, 20000, true);
      expect(normXToValue(nx, 20, 20000, true)).toBeCloseTo(freq, 2);
    }

    for (const ms of [-10, 0, 12.5, 30]) {
      const nx = valueToNormX(ms, -10, 30, false);
      expect(normXToValue(nx, -10, 30, false)).toBeCloseTo(ms, 4);
    }

    const ny = valueToNormY(6, -24, 24);
    expect(normYToValue(ny, -24, 24)).toBeCloseTo(6, 5);

    const box = getChartPlotBox(600, 300);
    expect(box.left).toBe(52);
    expect(box.width).toBe(600 - 52 - 18);
    expect(box.height).toBe(300 - 12 - 24);
  });

  it('formats frequency and relative-time labels cleanly', () => {
    expect(formatFrequencyLabel(250)).toBe('250');
    expect(formatFrequencyLabel(1000)).toBe('1k');
    expect(formatFrequencyLabel(3150)).toBe('3.2k');

    expect(formatRelativeTimeLabel(0)).toBe('0s');
    expect(formatRelativeTimeLabel(-45)).toBe('-45s');
    expect(formatRelativeTimeLabel(-900)).toBe('-15m');
    expect(formatRelativeTimeLabel(-930)).toBe('-15m30s');
    expect(formatRelativeTimeLabel(-7200)).toBe('-2h');
  });

  it('computes coherence alpha fade, hard cutoff, and zoomed Y ranges', () => {
    expect(computeCoherenceAlpha(1.0, 0.4, 'alpha')).toBe(1.0);
    expect(computeCoherenceAlpha(0.2, 0.4, 'alpha')).toBeCloseTo(0.05, 3);
    expect(computeCoherenceAlpha(0.2, 0.4, 'off')).toBe(1.0);
    expect(computeCoherenceAlpha(0.2, 0.4, false)).toBe(1.0);
    expect(computeCoherenceAlpha(0.39, 0.4, 'cutoff')).toBe(0.0);
    expect(computeCoherenceAlpha(0.4, 0.4, 'cutoff')).toBe(1.0);
    expect(computeCoherenceAlpha(0.85, 0.4, 'cutoff')).toBe(1.0);

    expect(computeZoomedYRange(-24, 24, 0.5)).toEqual({ yMin: -12, yMax: 12 });
    expect(computeZoomedYRange(-12, 12, 2.0)).toEqual({ yMin: -24, yMax: 24 });
  });

  it('inserts zero-alpha break vertices across phase wrap discontinuities', () => {
    const x = new Float32Array([100, 200, 300, 400]);
    const y = new Float32Array([175, 179, -179, -170]);
    const scratch = new Float32Array(64);
    const buf = buildTraceNdcVertices({
      x,
      y,
      bounds: { xMin: 20, xMax: 20000, yMin: -180, yMax: 180 },
      isLogX: true,
      unwrapPhaseBreaks: true,
      outScratch: scratch,
    });

    expect(buf.vertexCount).toBe(6);
    let zeroAlphaCount = 0;
    for (let i = 0; i < buf.vertexCount; i++) {
      if (buf.vertices[i * 3 + 2] === 0) zeroAlphaCount++;
    }
    expect(zeroAlphaCount).toBe(2);
  });

  it('computes adaptive Magnitude and magnitude-gated Group Delay bounds', () => {
    const mag = new Float32Array([88, 96, 111.4, 92]);
    const magBounds = computeAdaptiveMagnitudeBounds([mag], 'auto-60');
    expect(magBounds.yMax).toBeGreaterThanOrEqual(116);
    expect(magBounds.yMax - magBounds.yMin).toBe(60);

    const gd = new Float32Array([2.5, 4.0, 850.0, 3.0]);
    const magWithNull = new Float32Array([95, 96, 12, 94]); // 12 dB is >50 dB below peak, gated out
    const gdBounds = computeAdaptiveGroupDelayBounds([
      { magnitudeDb: magWithNull, groupDelayMs: gd },
    ]);
    expect(gdBounds.yMax).toBeLessThan(60);
  });
});
