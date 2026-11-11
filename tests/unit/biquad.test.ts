/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_DSP_CONFIG,
  compileDspChain,
  designBiquad,
  designCrossoverSections,
  evaluateBiquadCascade,
  evaluateCompiledDspAtFrequency,
} from '../../src/physics/biquad.js';

function magDb(c: { re: number; im: number }): number {
  return 20 * Math.log10(Math.hypot(c.re, c.im));
}

describe('biquad & crossover DSP', () => {
  it('designs peaking EQ with exact center boost/cut and unity passband', () => {
    const eq = designBiquad('peaking', 1000, 2.0, -6.0);
    expect(magDb(evaluateBiquadCascade([eq], 1000))).toBeCloseTo(-6.0, 2);
    expect(magDb(evaluateBiquadCascade([eq], 50))).toBeCloseTo(0.0, 2);
    expect(magDb(evaluateBiquadCascade([eq], 16000))).toBeCloseTo(0.0, 1);
  });

  it('preserves flat unity magnitude across allpass filter while rotating phase by 180 deg at f0', () => {
    const ap = designBiquad('allpass', 500, 1.0);
    for (const f of [50, 250, 500, 1000, 8000]) {
      expect(magDb(evaluateBiquadCascade([ap], f))).toBeCloseTo(0, 4);
    }
    const atCenter = evaluateBiquadCascade([ap], 500);
    expect(atCenter.re).toBeCloseTo(-1, 2);
  });

  it('sums complementary Linkwitz-Riley 24 dB/oct LP + HP crossovers to flat 0 dB across spectrum', () => {
    const fc = 90;
    const lp = designCrossoverSections('lowpass', { topology: 'linkwitz-riley-24', frequencyHz: fc });
    const hp = designCrossoverSections('highpass', { topology: 'linkwitz-riley-24', frequencyHz: fc });

    // Each branch is -6.02 dB at fc and in phase with each other
    expect(magDb(evaluateBiquadCascade(lp, fc))).toBeCloseTo(-6.02, 1);
    expect(magDb(evaluateBiquadCascade(hp, fc))).toBeCloseTo(-6.02, 1);

    for (const f of [30, 60, 90, 140, 400, 2000]) {
      const hLp = evaluateBiquadCascade(lp, f);
      const hHp = evaluateBiquadCascade(hp, f);
      const sum = { re: hLp.re + hHp.re, im: hLp.im + hHp.im };
      expect(magDb(sum)).toBeCloseTo(0, 2);
    }
  });

  it('applies gain, polarity inversion, and electronic delay phase rotation in CompiledDspChain', () => {
    const chain = compileDspChain(
      {
        ...DEFAULT_SOURCE_DSP_CONFIG,
        gainDb: 6.0206,
        delayMs: 2.5, // quarter period at 100 Hz -> -90 deg; half period at 200 Hz -> -180 deg
      },
      { invertPolarity: true }
    );

    // At 200 Hz: delay rotates phase by -180 deg, polarity flip rotates by another 180 deg -> +2.0 real!
    const h200 = evaluateCompiledDspAtFrequency(chain, 200);
    expect(h200.re).toBeCloseTo(2.0, 3);
    expect(h200.im).toBeCloseTo(0.0, 3);
  });
});
