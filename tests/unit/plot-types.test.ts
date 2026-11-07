import { describe, expect, it } from 'vitest';
import {
  buildTraceVertices,
  computeCoherenceAlpha,
  computeCursorReadout,
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
  });
});
