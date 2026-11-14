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

import { describe, expect, it } from 'vitest';
import {
  buildSplSeriesVertices,
  buildTraceVertices,
  computeCoherenceAlpha,
  computeCursorReadout,
  formatRelativeTimeLabel,
  normXToValue,
  valueToNormX,
} from '../../src/charts/plot-types.js';
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../../src/sources/source-data.js';

describe('Plot Coordinate Mappers, Phase Wrap Break & Cursor Readout', () => {
  it('inverts valueToNormX and normXToValue for both logarithmic and linear axes', () => {
    for (const freq of [20, 100, 632.45, 1000, 8000, 20000]) {
      const nx = valueToNormX(freq, 20, 20000, true);
      const back = normXToValue(nx, 20, 20000, true);
      expect(back).toBeCloseTo(freq, 2);
    }

    for (const ms of [-10, 0, 12.5, 30]) {
      const nx = valueToNormX(ms, -10, 30, false);
      const back = normXToValue(nx, -10, 30, false);
      expect(back).toBeCloseTo(ms, 4);
    }
  });

  it('inserts zero-alpha break vertices when phase wraps across +/-180 degrees', () => {
    const B = 65;
    const sr = 48000;
    const fd = createEmptyFrequencyDomainData(B, sr);
    fd.coherence.fill(1.0);

    // Bin 10 is +179 deg, Bin 11 wraps to -179 deg
    for (let i = 1; i < B; i++) {
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
    // Find zero-alpha break vertices inserted at the wrap boundary
    let zeroAlphaCount = 0;
    for (let v = 0; v < buf.vertexCount; v++) {
      if (buf.vertices[v * 3 + 2] === 0.0) {
        zeroAlphaCount++;
      }
    }
    expect(zeroAlphaCount).toBe(2);
  });

  it('computes coherence alpha curve and acoustic cursor readout', () => {
    expect(computeCoherenceAlpha(1.0, 0.4, true)).toBe(1.0);
    expect(computeCoherenceAlpha(0.2, 0.4, true)).toBeCloseTo(0.05, 3);
    expect(computeCoherenceAlpha(0.2, 0.4, false)).toBe(1.0);

    const B = 513;
    const sr = 48000;
    const fd = createEmptyFrequencyDomainData(B, sr);
    fd.magnitude.fill(2.0); // +6.02 dB
    fd.coherence.fill(0.95);

    const src: SourceData = {
      id: 's1',
      name: 'Main PA',
      kind: 'measurement',
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
      timeData: createEmptyTimeDomainData(1024, sr),
    };

    const readout = computeCursorReadout('magnitude', 1000, [src]);
    expect(readout.isFrequencyDomain).toBe(true);
    expect(readout.periodMs).toBeCloseTo(1.0, 3);
    expect(readout.wavelengthMeters).toBeCloseTo(0.343, 3);
    expect(readout.sourceValues[0].formattedValue).toBe('+6.0 dB');
    expect(readout.sourceValues[0].coherencePct).toBe(95);

    // Time-domain cursor readout (binary search over timeMs with delayOffsetMs)
    const centerIdx = 512; // 0.0 ms for 1024-sample centered window
    src.timeData.impulse[centerIdx] = 0.825;
    src.timeData.stepResponse[centerIdx] = 0.45;
    src.delayOffsetMs = 2.5;
    const impReadout = computeCursorReadout('impulse', 2.5, [src]);
    expect(impReadout.isFrequencyDomain).toBe(false);
    expect(impReadout.xValue).toBe(2.5);
    expect(impReadout.sourceValues[0].formattedValue).toBe('0.825');

    const stepReadout = computeCursorReadout('step', 2.5, [src]);
    expect(stepReadout.sourceValues[0].formattedValue).toBe('0.450');
  });

  it('builds SPL history vertices, formats relative time labels, and computes spl-history cursor readout', () => {
    expect(formatRelativeTimeLabel(0)).toBe('0s');
    expect(formatRelativeTimeLabel(-45)).toBe('-45s');
    expect(formatRelativeTimeLabel(-900)).toBe('-15m');
    expect(formatRelativeTimeLabel(-930)).toBe('-15m30s');
    expect(formatRelativeTimeLabel(-7200)).toBe('-2h');

    const timeSec = new Float32Array([-3, -2, -1, 0]);
    const seriesDb = new Float32Array([85, 88, 92, 95]);
    const vBuf = buildSplSeriesVertices(timeSec, seriesDb, 4, -5, 0, 50, 120);
    expect(vBuf.vertexCount).toBe(4);

    const src: SourceData = {
      id: 'live-measurement',
      name: 'FOH Mic',
      kind: 'measurement',
      color: '#38bdf8',
      visible: true,
      active: true,
      gainOffsetDb: 0,
      delayOffsetMs: 0,
      invertPolarity: false,
      notes: '',
      createdAt: '',
      sampleRate: 48000,
      freqData: createEmptyFrequencyDomainData(65, 48000),
      timeData: createEmptyTimeDomainData(128, 48000),
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
    };

    const traceVerts = buildTraceVertices(
      src,
      'spl-history',
      -60,
      0,
      40,
      125,
      false,
      0.35
    );
    expect(traceVerts.vertexCount).toBe(4);

    const splReadout = computeCursorReadout('spl-history', -1.0, [src]);
    expect(splReadout.isFrequencyDomain).toBe(false);
    expect(splReadout.sourceValues[0].formattedValue).toContain('LAeq15: 87.0');
    expect(splReadout.sourceValues[0].formattedValue).toContain('LAeq1: 89.0');
    expect(splReadout.sourceValues[0].formattedValue).toContain('LAF: 92.0');
  });
});

