// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { smoothMagnitudeOctave, smoothPhaseOctave } from './octave-smoothing.js';

describe('Fractional-Octave Magnitude & Phase Smoothing', () => {
  it('smooths a sharp narrowband spike while preserving a flat spectrum', () => {
    const N = 1024;
    const flat = new Float32Array(N).fill(2.5);
    const outFlat = new Float32Array(N);
    smoothMagnitudeOctave(flat, outFlat, 6);

    for (let i = 10; i < N - 10; i++) {
      expect(outFlat[i]).toBeCloseTo(2.5, 4);
    }

    const spike = new Float32Array(N).fill(1.0);
    spike[200] = 10.0;
    const outSpike = new Float32Array(N);
    smoothMagnitudeOctave(spike, outSpike, 3);

    expect(outSpike[200]).toBeGreaterThan(1.0);
    expect(outSpike[200]).toBeLessThan(10.0);
    expect(outSpike[201]).toBeGreaterThan(1.2);
  });

  it('smooths phase vectors across +/-180 deg wrap without discontinuities', () => {
    const N = 256;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const angle = i % 2 === 0 ? (178 * Math.PI) / 180 : (-178 * Math.PI) / 180;
      re[i] = Math.cos(angle);
      im[i] = Math.sin(angle);
    }
    const outRe = new Float32Array(N);
    const outIm = new Float32Array(N);
    smoothPhaseOctave(re, im, outRe, outIm, 6);

    expect(outRe[100]).toBeCloseTo(-1.0, 2);
    expect(Math.abs(outIm[100])).toBeLessThan(0.05);
  });
});
