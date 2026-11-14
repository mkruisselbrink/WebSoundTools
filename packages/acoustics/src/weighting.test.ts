// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { evaluateBiquadCascadeResponse } from '@foh/dsp';
import { describe, expect, it } from 'vitest';
import {
  computeAWeightingDb,
  computeCWeightingDb,
  computeFrequencyWeightingDb,
  createWeightingBiquadCoeffs,
} from './weighting.js';

describe('IEC 61672-1 Analytical & Bilinear IIR Weighting', () => {
  it('normalizes analytical IEC 61672 A- and C-weighting to 0 dB at 1 kHz', () => {
    expect(computeAWeightingDb(1000)).toBeCloseTo(0, 2);
    expect(computeCWeightingDb(1000)).toBeCloseTo(0, 2);
    expect(computeFrequencyWeightingDb(1000, 'Z')).toBe(0);

    expect(computeAWeightingDb(100)).toBeCloseTo(-19.1, 1);
    expect(computeCWeightingDb(100)).toBeCloseTo(-0.3, 1);
  });

  it('matches IEC 61672-1 Class 1 nominal A and C attenuation in bilinear IIR cascades', () => {
    const sampleRate = 48000;
    const aCoeffs = createWeightingBiquadCoeffs('A', sampleRate);
    const cCoeffs = createWeightingBiquadCoeffs('C', sampleRate);
    expect(createWeightingBiquadCoeffs('Z', sampleRate)).toEqual([]);

    const evalDb = (coeffs: typeof aCoeffs, freq: number) =>
      20 * Math.log10(evaluateBiquadCascadeResponse(coeffs, freq, sampleRate).magnitude);

    expect(evalDb(aCoeffs, 1000)).toBeCloseTo(0.0, 2);
    expect(evalDb(cCoeffs, 1000)).toBeCloseTo(0.0, 2);

    expect(evalDb(aCoeffs, 63)).toBeCloseTo(-26.2, 0);
    expect(evalDb(aCoeffs, 125)).toBeCloseTo(-16.1, 0);
    expect(evalDb(aCoeffs, 250)).toBeCloseTo(-8.6, 0);
    expect(evalDb(aCoeffs, 500)).toBeCloseTo(-3.2, 0);
    expect(evalDb(aCoeffs, 2000)).toBeCloseTo(1.2, 0);
    expect(evalDb(aCoeffs, 4000)).toBeCloseTo(1.0, 0);

    expect(evalDb(cCoeffs, 31.5)).toBeCloseTo(-3.0, 0);
    expect(evalDb(cCoeffs, 63)).toBeCloseTo(-0.8, 0);
    expect(evalDb(cCoeffs, 4000)).toBeCloseTo(-0.8, 0);
  });
});
