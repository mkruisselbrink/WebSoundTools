import { describe, expect, it } from 'vitest';
import {
  WINDOW_FUNCTION_LABELS,
  WindowFunctionType,
  createWindowTable,
  evaluateWindowSample,
} from '../../src/dsp/window-functions.js';

describe('Spectral Window Functions', () => {
  const N = 1024;
  const allTypes = Object.keys(WINDOW_FUNCTION_LABELS) as WindowFunctionType[];

  it('computes accurate coherent gain and DFT-even symmetry across all 6 window types', () => {
    const expectedCoherentGains: Record<WindowFunctionType, number> = {
      rectangular: 1.0,
      hann: 0.5,
      hamming: 0.54,
      blackman: 0.42,
      'blackman-harris': 0.35875,
      flattop: 0.21557895,
    };

    for (const type of allTypes) {
      const table = createWindowTable(type, N);
      expect(table.type).toBe(type);
      expect(table.size).toBe(N);
      expect(table.weights.length).toBe(N);

      // Coherent gain matches analytical constant term a0
      expect(table.coherentGain).toBeCloseTo(expectedCoherentGains[type], 4);
      expect(table.energyGain).toBeGreaterThan(0);

      // Peak at center (N / 2) is 1.0 (or ~1.0 for Blackman-Harris / Flat Top)
      expect(table.weights[N / 2]).toBeCloseTo(1.0, 3);

      // Verify DFT-even symmetry: w[n] == w[N - n] for n = 1 .. N/2 - 1
      for (let n = 1; n < N / 2; n++) {
        expect(table.weights[n]).toBeCloseTo(table.weights[N - n], 5);
      }
    }
  });

  it('tapers endpoints appropriately for Hann and Hamming windows', () => {
    expect(evaluateWindowSample('rectangular', 0, N)).toBe(1.0);
    expect(evaluateWindowSample('hann', 0, N)).toBeCloseTo(0.0, 6);
    expect(evaluateWindowSample('hamming', 0, N)).toBeCloseTo(0.08, 6);
    expect(evaluateWindowSample('blackman', 0, N)).toBeCloseTo(0.0, 6);
  });
});

