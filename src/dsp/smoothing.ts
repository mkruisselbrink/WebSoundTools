/**
 * O(1)-per-bin Prefix-Sum (Integral Array) Fractional-Octave Smoothing
 * and Fractional-Octave RTA Band Aggregation.
 */

export type OctaveSmoothingType =
  | 'off'
  | '1/48'
  | '1/24'
  | '1/12'
  | '1/6'
  | '1/3'
  | '1/2'
  | '1/1';

export const OCTAVE_SMOOTHING_FRACTIONS: Record<OctaveSmoothingType, number> = {
  off: 0,
  '1/48': 48,
  '1/24': 24,
  '1/12': 12,
  '1/6': 6,
  '1/3': 3,
  '1/2': 2,
  '1/1': 1,
};

/**
 * Smooths a non-negative amplitude or magnitude array in-place (or into `output`)
 * using RMS power averaging over a fractional-octave bandwidth `1 / fraction`
 * in O(N) total time via a prefix-sum array.
 */
export function smoothMagnitudeOctave(
  input: Float32Array,
  output: Float32Array,
  fraction: number,
  scratchPrefixSum?: Float64Array
): void {
  const N = input.length;
  if (fraction <= 0 || N <= 2) {
    if (output !== input) {
      output.set(input);
    }
    return;
  }

  const prefix =
    scratchPrefixSum && scratchPrefixSum.length >= N + 1
      ? scratchPrefixSum
      : new Float64Array(N + 1);

  prefix[0] = 0;
  for (let i = 0; i < N; i++) {
    const v = input[i];
    prefix[i + 1] = prefix[i] + v * v;
  }

  const halfBandFactor = Math.pow(2.0, 0.5 / fraction);
  const invHalfBandFactor = 1.0 / halfBandFactor;

  output[0] = input[0];
  for (let i = 1; i < N; i++) {
    const lowIdx = Math.max(1, Math.floor(i * invHalfBandFactor));
    const highIdx = Math.min(N - 1, Math.ceil(i * halfBandFactor));
    const count = highIdx - lowIdx + 1;
    const sumSq = prefix[highIdx + 1] - prefix[lowIdx];
    output[i] = Math.sqrt(Math.max(0, sumSq / count));
  }
}

/**
 * Smooths complex unit phase vectors (`phaseRe`, `phaseIm`) over a fractional-octave
 * bandwidth `1 / fraction` in O(N) time via prefix sums, preserving wrap-around continuity.
 */
export function smoothPhaseOctave(
  phaseRe: Float32Array,
  phaseIm: Float32Array,
  outRe: Float32Array,
  outIm: Float32Array,
  fraction: number
): void {
  const N = phaseRe.length;
  if (fraction <= 0 || N <= 2) {
    if (outRe !== phaseRe) outRe.set(phaseRe);
    if (outIm !== phaseIm) outIm.set(phaseIm);
    return;
  }

  const prefixRe = new Float64Array(N + 1);
  const prefixIm = new Float64Array(N + 1);
  prefixRe[0] = 0;
  prefixIm[0] = 0;
  for (let i = 0; i < N; i++) {
    prefixRe[i + 1] = prefixRe[i] + phaseRe[i];
    prefixIm[i + 1] = prefixIm[i] + phaseIm[i];
  }

  const halfBandFactor = Math.pow(2.0, 0.5 / fraction);
  const invHalfBandFactor = 1.0 / halfBandFactor;

  outRe[0] = phaseRe[0];
  outIm[0] = phaseIm[0];

  for (let i = 1; i < N; i++) {
    const lowIdx = Math.max(1, Math.floor(i * invHalfBandFactor));
    const highIdx = Math.min(N - 1, Math.ceil(i * halfBandFactor));
    const sumR = prefixRe[highIdx + 1] - prefixRe[lowIdx];
    const sumI = prefixIm[highIdx + 1] - prefixIm[lowIdx];
    const len = Math.hypot(sumR, sumI);
    if (len > 1e-12) {
      outRe[i] = sumR / len;
      outIm[i] = sumI / len;
    } else {
      outRe[i] = 1.0;
      outIm[i] = 0.0;
    }
  }
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

  // Generate centers around 1000 Hz within [20 Hz, 20000 Hz]
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

