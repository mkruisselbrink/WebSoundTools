/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Standard spectral analysis window functions and their coherent gain / noise bandwidth factors.
 */

export type WindowFunctionType =
  | 'rectangular'
  | 'hann'
  | 'hamming'
  | 'blackman'
  | 'blackman-harris'
  | 'flattop';

export const WINDOW_FUNCTION_LABELS: Record<WindowFunctionType, string> = {
  rectangular: 'Rectangular',
  hann: 'Hann',
  hamming: 'Hamming',
  blackman: 'Blackman',
  'blackman-harris': 'Blackman-Harris',
  flattop: 'Flat Top',
};

export interface WindowTable {
  readonly type: WindowFunctionType;
  readonly size: number;
  readonly weights: Float32Array;
  /** Mean weight (1/N * sum w[n]), used to normalize narrowband sine amplitude */
  readonly coherentGain: number;
  /** RMS weight sqrt(1/N * sum w[n]^2), used to normalize broadband noise power */
  readonly energyGain: number;
}

/**
 * Evaluates a single normalized window sample at index `n` of `N` (periodic / DFT-even form).
 */
export function evaluateWindowSample(type: WindowFunctionType, n: number, N: number): number {
  const phase = (2.0 * Math.PI * n) / N;
  switch (type) {
    case 'rectangular':
      return 1.0;
    case 'hann':
      return 0.5 - 0.5 * Math.cos(phase);
    case 'hamming':
      return 0.54 - 0.46 * Math.cos(phase);
    case 'blackman':
      return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2.0 * phase);
    case 'blackman-harris':
      return (
        0.35875 -
        0.48829 * Math.cos(phase) +
        0.14128 * Math.cos(2.0 * phase) -
        0.01168 * Math.cos(3.0 * phase)
      );
    case 'flattop':
      return (
        0.21557895 -
        0.41663158 * Math.cos(phase) +
        0.277263158 * Math.cos(2.0 * phase) -
        0.083578947 * Math.cos(3.0 * phase) +
        0.006947368 * Math.cos(4.0 * phase)
      );
  }
}

/**
 * Precomputes a window table of length `size` along with coherent and energy gain factors.
 */
export function createWindowTable(type: WindowFunctionType, size: number): WindowTable {
  const weights = new Float32Array(size);
  let sum = 0;
  let sumSq = 0;

  for (let n = 0; n < size; n++) {
    const w = evaluateWindowSample(type, n, size);
    weights[n] = w;
    sum += w;
    sumSq += w * w;
  }

  return {
    type,
    size,
    weights,
    coherentGain: sum / size,
    energyGain: Math.sqrt(sumSq / size),
  };
}

