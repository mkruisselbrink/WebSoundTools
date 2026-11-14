// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { evaluateBiquadCascade } from './biquad.js';
import { CrossoverTopology, designCrossoverSections } from './crossovers.js';

function magDb(c: { re: number; im: number }): number {
  return 20 * Math.log10(Math.hypot(c.re, c.im));
}

describe('Butterworth & Linkwitz-Riley Crossovers', () => {
  it('sums complementary Linkwitz-Riley 12, 24, and 48 dB/oct LP + HP crossovers to flat 0 dB', () => {
    const fc = 90;
    const lrTopologies: CrossoverTopology[] = [
      'linkwitz-riley-12',
      'linkwitz-riley-24',
      'linkwitz-riley-48',
    ];

    for (const topology of lrTopologies) {
      const lp = designCrossoverSections('lowpass', { topology, frequencyHz: fc });
      const hp = designCrossoverSections('highpass', { topology, frequencyHz: fc });

      expect(magDb(evaluateBiquadCascade(lp, fc))).toBeCloseTo(-6.02, 1);
      expect(magDb(evaluateBiquadCascade(hp, fc))).toBeCloseTo(-6.02, 1);

      if (topology === 'linkwitz-riley-24' || topology === 'linkwitz-riley-48') {
        for (const f of [30, 60, 90, 140, 400, 2000]) {
          const hLp = evaluateBiquadCascade(lp, f);
          const hHp = evaluateBiquadCascade(hp, f);
          const sum = { re: hLp.re + hHp.re, im: hLp.im + hHp.im };
          expect(magDb(sum)).toBeCloseTo(0, 2);
        }
      }
    }
  });

  it('evaluates Butterworth 12, 18, 24, and 48 dB/oct crossovers to -3.01 dB at cutoff', () => {
    const fc = 120;
    const bwTopologies: CrossoverTopology[] = [
      'butterworth-12',
      'butterworth-18',
      'butterworth-24',
      'butterworth-48',
    ];

    for (const topology of bwTopologies) {
      const lp = designCrossoverSections('lowpass', { topology, frequencyHz: fc });
      const hp = designCrossoverSections('highpass', { topology, frequencyHz: fc });
      expect(magDb(evaluateBiquadCascade(lp, fc))).toBeCloseTo(-3.01, 1);
      expect(magDb(evaluateBiquadCascade(hp, fc))).toBeCloseTo(-3.01, 1);
    }

    expect(designCrossoverSections('lowpass', { topology: 'off', frequencyHz: fc })).toEqual([]);
  });
});
