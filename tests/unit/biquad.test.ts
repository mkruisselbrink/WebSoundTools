import { describe, expect, it } from 'vitest';
import {
  BiquadFilter,
  BiquadSpec,
  computeBiquadCoefficients,
  evaluateBiquadComplexResponse,
} from '../../src/dsp/biquad.js';

describe('RBJ Biquad Filters & Analytical Transfer Function Evaluation', () => {
  const sampleRate = 48000;

  it('evaluates peaking EQ analytical response accurately at center and band edges', () => {
    const spec: BiquadSpec = {
      type: 'peaking',
      frequency: 1000,
      q: 2.0,
      gainDb: 6.0,
    };
    const coeffs = computeBiquadCoefficients(spec, sampleRate);

    // At f0 = 1000 Hz, magnitude should be +6.0 dB (10^(6/20) = 1.99526) and phase 0 rad
    const atCenter = evaluateBiquadComplexResponse(coeffs, 1000, sampleRate);
    expect(20 * Math.log10(atCenter.magnitude)).toBeCloseTo(6.0, 3);
    expect(atCenter.phaseRad).toBeCloseTo(0.0, 4);

    // Far below and above f0, gain should approach 0 dB
    const at20Hz = evaluateBiquadComplexResponse(coeffs, 20, sampleRate);
    expect(20 * Math.log10(at20Hz.magnitude)).toBeCloseTo(0.0, 2);
  });

  it('matches time-domain BiquadFilter steady-state response to analytical H(e^{jw})', () => {
    const specs: BiquadSpec[] = [
      { type: 'peaking', frequency: 1200, q: 1.5, gainDb: -8.0 },
      { type: 'lowpass', frequency: 2500, q: Math.SQRT1_2 },
      { type: 'highpass', frequency: 400, q: Math.SQRT1_2 },
      { type: 'lowshelf', frequency: 300, q: 0.707, gainDb: 5.0 },
      { type: 'highshelf', frequency: 4000, q: 0.707, gainDb: -4.0 },
      { type: 'allpass', frequency: 1000, q: 1.2 },
    ];

    const testFreq = 1000;
    const totalSamples = 4800; // 100 ms
    const settleSamples = 2400; // 50 ms settling

    for (const spec of specs) {
      const coeffs = computeBiquadCoefficients(spec, sampleRate);
      const filter = new BiquadFilter(coeffs);
      const analytical = evaluateBiquadComplexResponse(coeffs, testFreq, sampleRate);

      let maxAmp = 0;
      // Correlate steady-state output against cos(w*n) and -sin(w*n) to measure complex gain
      let corrCos = 0;
      let corrSin = 0;
      const steadyCount = totalSamples - settleSamples;

      for (let n = 0; n < totalSamples; n++) {
        const w = (2 * Math.PI * testFreq * n) / sampleRate;
        const x = Math.cos(w);
        const y = filter.processSample(x);
        if (n >= settleSamples) {
          if (Math.abs(y) > maxAmp) maxAmp = Math.abs(y);
          corrCos += y * Math.cos(w);
          corrSin += y * -Math.sin(w);
        }
      }

      const measuredRe = (2.0 * corrCos) / steadyCount;
      const measuredIm = (2.0 * corrSin) / steadyCount;
      const measuredMag = Math.hypot(measuredRe, measuredIm);
      const measuredPhase = Math.atan2(measuredIm, measuredRe);

      expect(measuredMag).toBeCloseTo(analytical.magnitude, 2);
      expect(Math.cos(measuredPhase)).toBeCloseTo(Math.cos(analytical.phaseRad), 2);
      expect(Math.sin(measuredPhase)).toBeCloseTo(Math.sin(analytical.phaseRad), 2);
    }
  });
});
