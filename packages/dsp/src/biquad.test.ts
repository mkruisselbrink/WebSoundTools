// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  BiquadCascade,
  BiquadFilter,
  BiquadSpec,
  computeBiquadCoefficients,
  designBiquad,
  evaluateBiquadCascade,
  evaluateBiquadComplexResponse,
} from './biquad.js';

function magDb(c: { re: number; im: number }): number {
  return 20 * Math.log10(Math.hypot(c.re, c.im));
}

describe('RBJ Biquad Filters & Analytical Transfer Function Evaluation', () => {
  const sampleRate = 48000;

  it('designs peaking EQ at 192 kHz reference rate without Nyquist cramping near 16 kHz', () => {
    const eq = designBiquad('peaking', 1000, 2.0, -6.0);
    expect(magDb(evaluateBiquadCascade([eq], 1000))).toBeCloseTo(-6.0, 2);
    expect(magDb(evaluateBiquadCascade([eq], 50))).toBeCloseTo(0.0, 2);
    expect(magDb(evaluateBiquadCascade([eq], 16000))).toBeCloseTo(0.0, 1);

    const hfEq = designBiquad('peaking', 16000, 2.0, 6.0);
    expect(magDb(evaluateBiquadCascade([hfEq], 16000))).toBeCloseTo(6.0, 2);
  });

  it('preserves flat unity magnitude across allpass filter while rotating phase by 180 deg at f0', () => {
    const ap = designBiquad('allpass', 500, 1.0);
    for (const f of [50, 250, 500, 1000, 8000]) {
      expect(magDb(evaluateBiquadCascade([ap], f))).toBeCloseTo(0, 4);
    }
    const atCenter = evaluateBiquadCascade([ap], 500);
    expect(atCenter.re).toBeCloseTo(-1, 2);
  });

  it('evaluates peaking EQ analytical response accurately at center and band edges at 48 kHz', () => {
    const spec: BiquadSpec = {
      type: 'peaking',
      frequency: 1000,
      q: 2.0,
      gainDb: 6.0,
    };
    const coeffs = computeBiquadCoefficients(spec, sampleRate);

    const atCenter = evaluateBiquadComplexResponse(coeffs, 1000, sampleRate);
    expect(20 * Math.log10(atCenter.magnitude)).toBeCloseTo(6.0, 3);
    expect(atCenter.phaseRad).toBeCloseTo(0.0, 4);

    const at20Hz = evaluateBiquadComplexResponse(coeffs, 20, sampleRate);
    expect(20 * Math.log10(at20Hz.magnitude)).toBeCloseTo(0.0, 2);

    const disabled = computeBiquadCoefficients({ ...spec, enabled: false }, sampleRate);
    expect(disabled).toEqual({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
  });

  it('matches time-domain BiquadFilter and BiquadCascade steady-state response to analytical H(e^{jw})', () => {
    const specs: BiquadSpec[] = [
      { type: 'peaking', frequency: 1200, q: 1.5, gainDb: -8.0 },
      { type: 'lowpass', frequency: 2500, q: Math.SQRT1_2 },
      { type: 'highpass', frequency: 400, q: Math.SQRT1_2 },
      { type: 'bandpass', frequency: 1000, q: 2.0 },
      { type: 'notch', frequency: 1500, q: 4.0 },
      { type: 'lowshelf', frequency: 300, q: 0.707, gainDb: 5.0 },
      { type: 'highshelf', frequency: 4000, q: 0.707, gainDb: -4.0 },
      { type: 'allpass', frequency: 1000, q: 1.2 },
    ];

    const testFreq = 1000;
    const totalSamples = 4800;
    const settleSamples = 2400;

    for (const spec of specs) {
      const coeffs = computeBiquadCoefficients(spec, sampleRate);
      const filter = new BiquadFilter(coeffs);
      const analytical = evaluateBiquadComplexResponse(coeffs, testFreq, sampleRate);

      let corrCos = 0;
      let corrSin = 0;
      const steadyCount = totalSamples - settleSamples;

      for (let n = 0; n < totalSamples; n++) {
        const w = (2 * Math.PI * testFreq * n) / sampleRate;
        const x = Math.cos(w);
        const y = filter.processSample(x);
        if (n >= settleSamples) {
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

    const cascade = new BiquadCascade([computeBiquadCoefficients(specs[0], sampleRate)]);
    const buf = new Float32Array([1, 0, 0, 0]);
    const out = new Float32Array(4);
    cascade.processBuffer(buf, out);
    expect(out[0]).not.toBe(0);
  });
});
