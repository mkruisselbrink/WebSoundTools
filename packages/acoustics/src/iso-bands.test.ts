// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  ISO_31_BAND_FREQUENCIES_HZ,
  ISO_OCTAVE_BANDS_HZ,
  ISO_THIRD_OCTAVE_BANDS_HZ,
  aggregateFractionalOctaveBands,
  createLogFrequencyGrid,
} from './iso-bands.js';

describe('ISO Octave Grids & Fractional-Octave RTA Aggregation', () => {
  it('provides standard ISO 1/1, 1/3, and 31-band center frequencies and log grids', () => {
    expect(ISO_OCTAVE_BANDS_HZ).toHaveLength(10);
    expect(ISO_THIRD_OCTAVE_BANDS_HZ).toHaveLength(30);
    expect(ISO_31_BAND_FREQUENCIES_HZ).toHaveLength(31);

    const grid = createLogFrequencyGrid(121, 20, 20000);
    expect(grid.length).toBe(121);
    expect(grid[0]).toBeCloseTo(20, 4);
    expect(grid[60]).toBeCloseTo(Math.sqrt(20 * 20000), 1);
    expect(grid[120]).toBeCloseTo(20000, 2);
  });

  it('aggregates 1/3 octave RTA bands between 20 Hz and 20 kHz', () => {
    const N = 2049;
    const freqs = new Float32Array(N);
    const mod = new Float32Array(N).fill(0.5);
    const peakSq = new Float32Array(N).fill(1.0);
    for (let i = 0; i < N; i++) {
      freqs[i] = (i * 24000) / (N - 1);
    }

    const bands = aggregateFractionalOctaveBands(freqs, mod, peakSq, 3);
    expect(bands.centerFrequencies.length).toBeGreaterThanOrEqual(28);
    expect(bands.centerFrequencies).toContain(1000);
    expect(bands.magnitudes[15]).toBeCloseTo(0.5, 3);
    expect(bands.peaks[15]).toBeCloseTo(1.0, 3);
  });
});
