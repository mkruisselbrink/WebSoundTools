// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * O(1)-per-bin Prefix-Sum (Integral Array) Fractional-Octave Magnitude & Phase Smoothing.
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
  fraction: number,
  scratchPrefixRe?: Float64Array,
  scratchPrefixIm?: Float64Array
): void {
  const N = phaseRe.length;
  if (fraction <= 0 || N <= 2) {
    if (outRe !== phaseRe) outRe.set(phaseRe);
    if (outIm !== phaseIm) outIm.set(phaseIm);
    return;
  }

  const prefixRe =
    scratchPrefixRe && scratchPrefixRe.length >= N + 1
      ? scratchPrefixRe
      : new Float64Array(N + 1);
  const prefixIm =
    scratchPrefixIm && scratchPrefixIm.length >= N + 1
      ? scratchPrefixIm
      : new Float64Array(N + 1);
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
    const len = Math.sqrt(sumR * sumR + sumI * sumI);
    if (len > 1e-12) {
      outRe[i] = sumR / len;
      outIm[i] = sumI / len;
    } else {
      outRe[i] = 1.0;
      outIm[i] = 0.0;
    }
  }
}
