// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * ISO 266 nominal 1/1-octave, 1/3-octave, and 31-band graphic EQ center frequencies,
 * logarithmic frequency grids, and fractional-octave RTA band aggregation.
 */

/**
 * Standard 10 nominal 1/1-octave band center frequencies (31.5 Hz to 16 kHz, ISO 266).
 */
export const ISO_OCTAVE_BANDS_HZ: readonly number[] = [
  31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/**
 * Standard 30 nominal 1/3-octave band center frequencies (25 Hz to 20 kHz, ISO 266).
 */
export const ISO_THIRD_OCTAVE_BANDS_HZ: readonly number[] = [
  25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200,
  250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/**
 * Standard 31-band graphic EQ ISO 1/3-octave center frequencies (20 Hz to 20 kHz).
 */
export const ISO_31_BAND_FREQUENCIES_HZ: readonly number[] = [
  20, ...ISO_THIRD_OCTAVE_BANDS_HZ,
];

/**
 * Generates logarithmically spaced frequency bins from `minHz` to `maxHz` (inclusive).
 */
export function createLogFrequencyGrid(
  binCount: number,
  minHz: number = 20,
  maxHz: number = 20000
): Float32Array {
  const count = Math.max(2, Math.floor(binCount));
  const out = new Float32Array(count);
  const logRatio = Math.log(maxHz / minHz);
  for (let i = 0; i < count; i++) {
    out[i] = minHz * Math.exp((i / (count - 1)) * logRatio);
  }
  return out;
}

export interface OctaveBandData {
  readonly centerFrequencies: Float32Array;
  readonly magnitudes: Float32Array;
  readonly peaks: Float32Array;
}

/**
 * Generates standard fractional-octave band center frequencies (20 Hz .. 20 kHz, anchored at 1000 Hz)
 * and aggregates narrowband FFT bins into fractional-octave RTA bars.
 */
export function aggregateFractionalOctaveBands(
  frequencies: Float32Array,
  module: Float32Array,
  peakSquared: Float32Array,
  bandsPerOctave: 1 | 3 | 6 | 12 | 24 = 3
): OctaveBandData {
  const stepRatio = Math.pow(2.0, 1.0 / bandsPerOctave);
  const halfStep = Math.pow(2.0, 0.5 / bandsPerOctave);

  const centers: number[] = [];
  const minIndex = Math.ceil(bandsPerOctave * Math.log2(20.0 / 1000.0));
  const maxIndex = Math.floor(bandsPerOctave * Math.log2(20000.0 / 1000.0));
  for (let idx = minIndex; idx <= maxIndex; idx++) {
    centers.push(1000.0 * Math.pow(stepRatio, idx));
  }

  const numBands = centers.length;
  const centerFrequencies = new Float32Array(centers);
  const magnitudes = new Float32Array(numBands);
  const peaks = new Float32Array(numBands);

  const N = frequencies.length;
  const df = N > 1 ? frequencies[1] - frequencies[0] : 1;

  for (let b = 0; b < numBands; b++) {
    const fc = centerFrequencies[b];
    const fLow = fc / halfStep;
    const fHigh = fc * halfStep;

    const kStart = Math.max(1, Math.floor(fLow / df));
    const kEnd = Math.min(N - 1, Math.ceil(fHigh / df));

    let sumPower = 0;
    let maxPeakSq = 0;
    let count = 0;
    for (let k = kStart; k <= kEnd; k++) {
      const m = module[k];
      sumPower += m * m;
      if (peakSquared[k] > maxPeakSq) {
        maxPeakSq = peakSquared[k];
      }
      count++;
    }

    magnitudes[b] = count > 0 ? Math.sqrt(sumPower / count) : 0;
    peaks[b] = Math.sqrt(maxPeakSq);
  }

  return { centerFrequencies, magnitudes, peaks };
}
