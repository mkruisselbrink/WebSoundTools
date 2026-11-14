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
  applyPatchToEqConfig,
  computeEqualizerSourceData,
  normalizeEqSourceConfig,
} from '../../src/sources/eq-source.js';
import {
  SourceData,
  cloneSourceDataAsStored,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
  deserializeSourceData,
  exportSourceDataToFrd,
  getEffectiveBinResponse,
  importFrdAsStoredSource,
  serializeSourceData,
} from '../../src/sources/source-data.js';
import { computeUnionSourceData } from '../../src/sources/union-source.js';

function createTestSource(
  id: string,
  name: string,
  magLinear: number,
  phaseDeg: number
): SourceData {
  const B = 513;
  const sr = 48000;
  const freqData = createEmptyFrequencyDomainData(B, sr);
  const rad = (phaseDeg * Math.PI) / 180.0;
  freqData.module.fill(magLinear);
  freqData.magnitude.fill(magLinear);
  freqData.phaseReal.fill(Math.cos(rad));
  freqData.phaseImag.fill(Math.sin(rad));
  freqData.coherence.fill(1.0);

  return {
    id,
    name,
    kind: 'stored',
    color: '#38bdf8',
    visible: true,
    active: true,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: false,
    notes: 'Test source',
    createdAt: '2026-11-07T00:00:00Z',
    sampleRate: sr,
    freqData,
    timeData: createEmptyTimeDomainData(1024, sr),
  };
}

describe('SourceData, UnionSource & EqualizerSource', () => {
  it('clones and round-trip serializes/deserializes SourceData', () => {
    const src = createTestSource('s1', 'Main PA', 2.0, 45);
    const stored = cloneSourceDataAsStored(src, 'Captured PA');
    expect(stored.kind).toBe('stored');
    expect(stored.name).toBe('Captured PA');

    const json = serializeSourceData(stored);
    const restored = deserializeSourceData(json);
    expect(restored.name).toBe('Captured PA');
    expect(restored.freqData.magnitude[100]).toBeCloseTo(2.0, 5);
    expect(restored.freqData.phaseReal[100]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });

  it('applies gainOffsetDb, delayOffsetMs, and invertPolarity in getEffectiveBinResponse', () => {
    const src = createTestSource('s1', 'Delayed Source', 1.0, 0);
    src.gainOffsetDb = 6.0; // ~1.995x
    src.invertPolarity = true; // 180 deg flip

    const binIdx = 32; // At B=513, fftSize=1024, sr=48000 -> bin 32 is 32 * 46.875 = 1500 Hz
    const eff = getEffectiveBinResponse(src, binIdx);
    expect(20 * Math.log10(eff.magnitude)).toBeCloseTo(6.0, 3);
    expect(eff.phaseRe).toBeCloseTo(-1.0, 4);
    expect(eff.phaseIm).toBeCloseTo(0.0, 4);
  });

  it('computes destructive cancellation and constructive summation in UnionSource', () => {
    const srcA = createTestSource('a', 'Speaker A', 1.0, 0);
    const srcB = createTestSource('b', 'Speaker B (180 deg out)', 1.0, 180);

    // Vector average of two equal-amplitude 180-deg out-of-phase sources -> 0.0 (cancellation!)
    const cancelled = computeUnionSourceData(
      {
        id: 'u1',
        name: 'Vector Avg',
        color: '#fff',
        visible: true,
        operation: 'vector-avg',
        sourceIds: ['a', 'b'],
      },
      [srcA, srcB]
    );
    expect(cancelled.freqData.magnitude[50]).toBeLessThan(1e-5);

    // Power average ignores phase and yields RMS = 1.0
    const powerAvg = computeUnionSourceData(
      {
        id: 'u2',
        name: 'Power Avg',
        color: '#fff',
        visible: true,
        operation: 'power-avg',
        sourceIds: ['a', 'b'],
      },
      [srcA, srcB]
    );
    expect(powerAvg.freqData.magnitude[50]).toBeCloseTo(1.0, 4);

    // Vector sum of two in-phase sources -> 2.0 (+6 dB)
    const srcC = createTestSource('c', 'Speaker C (in phase)', 1.0, 0);
    srcA.timeData.impulse[10] = 0.5;
    srcC.timeData.impulse[10] = 0.5;
    const summed = computeUnionSourceData(
      {
        id: 'u3',
        name: 'Vector Sum',
        color: '#fff',
        visible: true,
        operation: 'sum',
        sourceIds: ['a', 'c'],
      },
      [srcA, srcC]
    );
    expect(summed.freqData.magnitude[50]).toBeCloseTo(2.0, 4);
    expect(summed.timeData.impulse[10]).toBeCloseTo(1.0, 4);

    // Non-linear operations ('apply', 'diff-db', 'min', 'max') leave timeData.impulse zeroed
    const applied = computeUnionSourceData(
      {
        id: 'u4',
        name: 'Apply',
        color: '#fff',
        visible: true,
        operation: 'apply',
        sourceIds: ['a', 'c'],
      },
      [srcA, srcC]
    );
    expect(applied.timeData.impulse[10]).toBe(0);
  });

  it('flattens a speaker resonance when applying an inverse band in EqualizerSource', () => {
    // 1. Create a simulated speaker response that has a +6.5 dB peak at 160 Hz (Q = 2.2)
    const speakerBump = computeEqualizerSourceData({
      id: 'speaker',
      name: 'Boomy Speaker',
      color: '#f43f5e',
      visible: true,
      bands: [{ type: 'peaking', frequency: 160, q: 2.2, gainDb: 6.5, enabled: true }],
    });

    // 2. Apply a corrective Virtual EQ with -6.5 dB at 160 Hz (Q = 2.2) targeting `speakerBump`
    const corrected = computeEqualizerSourceData(
      {
        id: 'eq',
        name: 'Corrective EQ',
        color: '#10b981',
        visible: true,
        bands: [{ type: 'peaking', frequency: 160, q: 2.2, gainDb: -6.5, enabled: true }],
        targetSourceId: 'speaker',
      },
      speakerBump
    );

    // Verify that across all frequency bins > 0, the corrected response is flat (0.00 dB, 0.0 deg phase)
    for (let k = 1; k < corrected.freqData.length; k++) {
      expect(20 * Math.log10(corrected.freqData.magnitude[k])).toBeCloseTo(0.0, 3);
      expect(corrected.freqData.phaseReal[k]).toBeCloseTo(1.0, 3);
      expect(corrected.freqData.phaseImag[k]).toBeCloseTo(0.0, 3);
    }
  });

  it('models full SourceDspConfig (Gain, Delay, Polarity, Linkwitz-Riley 24 dB/oct Crossover) in Virtual EQ', () => {
    const baseEq = normalizeEqSourceConfig({
      id: 'eq-lr24',
      name: 'LR24 Sub/Top',
      color: '#10b981',
      visible: true,
      bands: [],
    });

    const hpEq = applyPatchToEqConfig(baseEq, {
      highPass: { topology: 'linkwitz-riley-24', frequencyHz: 93.75 },
    });
    const lpEq = applyPatchToEqConfig(baseEq, {
      lowPass: { topology: 'linkwitz-riley-24', frequencyHz: 93.75 },
    });

    const hpData = computeEqualizerSourceData(hpEq, null, 2049, 48000);
    const lpData = computeEqualizerSourceData(lpEq, null, 2049, 48000);

    // Bin 4 @ 48 kHz / 4096 FFT is exactly 4 * 11.71875 = 46.875 Hz; Bin 8 is exactly 93.75 Hz!
    expect(20 * Math.log10(hpData.freqData.magnitude[8])).toBeCloseTo(-6.02, 1);
    expect(20 * Math.log10(lpData.freqData.magnitude[8])).toBeCloseTo(-6.02, 1);

    // Vector sum of LR24 HPF + LPF equals flat 0 dB across the spectrum
    const lrSum = computeUnionSourceData(
      {
        id: 'u-lr',
        name: 'LR24 Sum',
        color: '#fff',
        visible: true,
        operation: 'sum',
        sourceIds: ['eq-lr24', 'eq-lr24-lp'],
      },
      [hpData, { ...lpData, id: 'eq-lr24-lp' }]
    );
    expect(20 * Math.log10(lrSum.freqData.magnitude[8])).toBeCloseTo(0.0, 2);
    expect(20 * Math.log10(lrSum.freqData.magnitude[64])).toBeCloseTo(0.0, 2);
  });

  it('exports and imports .FRD traces and normalizes absolute SPL curves for TF overlay', () => {
    const src = createTestSource('s-frd', 'FOH Measured', 1.0, -30);
    src.gainOffsetDb = -3.0;
    const frdText = exportSourceDataToFrd(src);
    expect(frdText).toContain('* WebSoundMeter Trace — FOH Measured');

    const reimported = importFrdAsStoredSource(frdText, {
      name: 'Reimported Trace',
      binCount: 513,
      sampleRate: 48000,
    });
    expect(20 * Math.log10(reimported.freqData.magnitude[50])).toBeCloseTo(-3.0, 2);

    // Simulate a WebSpeakerSim absolute SPL .frd around 96 dB SPL
    const wssFrd = ['50\t93.0\t20.0', '500\t96.0\t0.0', '2000\t96.0\t-15.0', '10000\t92.0\t-60.0'].join(
      '\n'
    );
    const predictedOverlay = importFrdAsStoredSource(wssFrd, {
      name: 'FOH Predicted',
      binCount: 513,
      sampleRate: 48000,
    });
    expect(predictedOverlay.notes).toContain('normalized from 96.0 dB SPL');
    // At 500..2000 Hz, normalized TF magnitude sits right around 0 dB!
    const idx1k = Math.round(1000 / (48000 / 1024));
    expect(20 * Math.log10(predictedOverlay.freqData.magnitude[idx1k])).toBeCloseTo(0.0, 1);
  });
});

