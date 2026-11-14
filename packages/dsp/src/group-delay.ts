// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Unwrap-free Group Delay computation τ(f) = -dφ/dω in milliseconds
 * using unit-phasor / complex conjugate products H[k] * conj(H[k-1]).
 */

/**
 * Computes the pairwise group delay in milliseconds between adjacent frequency bins
 * separated by `dfHz` using the conjugate product `(re + j*im) * (prevRe - j*prevIm)`.
 */
export function computeBinGroupDelayMs(
  dfHz: number,
  re: number,
  im: number,
  prevRe: number,
  prevIm: number
): number {
  const safeDf = Math.max(1e-6, dfHz);
  const crossRe = re * prevRe + im * prevIm;
  const crossIm = im * prevRe - re * prevIm;
  const dPhi = Math.atan2(crossIm, crossRe);
  return (-1000.0 * dPhi) / (2.0 * Math.PI * safeDf);
}

/**
 * Computes group delay in milliseconds across an entire array of complex phasors `(re, im)`
 * over `frequenciesHz` (linear or logarithmic grid).
 */
export function computeGroupDelayFromPhasorsMs(
  frequenciesHz: ArrayLike<number>,
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  outMs?: Float32Array
): Float32Array {
  const n = frequenciesHz.length;
  const out = outMs && outMs.length >= n ? outMs : new Float32Array(n);
  if (n === 0) return out;

  for (let k = 1; k < n; k++) {
    const df = frequenciesHz[k] - frequenciesHz[k - 1];
    out[k] = computeBinGroupDelayMs(df, re[k], im[k], re[k - 1], im[k - 1]);
  }
  out[0] = n > 1 ? out[1] : 0;
  return out;
}
