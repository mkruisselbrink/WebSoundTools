// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Butterworth and Linkwitz-Riley (12, 18, 24, 48 dB/oct) crossover filter synthesis.
 */

import {
  BiquadCoefficients,
  DSP_REFERENCE_SAMPLE_RATE_HZ,
  designBiquad,
  designFirstOrderSection,
} from './biquad.js';

export type CrossoverTopology =
  | 'off'
  | 'butterworth-12'
  | 'butterworth-18'
  | 'butterworth-24'
  | 'butterworth-48'
  | 'linkwitz-riley-12'
  | 'linkwitz-riley-24'
  | 'linkwitz-riley-48';

export interface CrossoverFilterConfig {
  readonly topology: CrossoverTopology;
  readonly frequencyHz: number;
}

const SQRT1_2 = Math.SQRT1_2; // 0.7071067811865476
const BW4_Q1 = 0.541196100146197; // 1 / (2 * cos(3*pi/8))
const BW4_Q2 = 1.3065629648763766; // 1 / (2 * cos(pi/8))

/**
 * Expands a high-pass or low-pass crossover topology into cascaded biquad sections.
 */
export function designCrossoverSections(
  passType: 'lowpass' | 'highpass',
  config: CrossoverFilterConfig,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): BiquadCoefficients[] {
  const f = config.frequencyHz;
  switch (config.topology) {
    case 'off':
      return [];
    case 'butterworth-12':
      return [designBiquad(passType, f, SQRT1_2, 0, sampleRateHz)];
    case 'butterworth-18':
      return [
        designFirstOrderSection(passType, f, sampleRateHz),
        designBiquad(passType, f, 1.0, 0, sampleRateHz),
      ];
    case 'butterworth-24':
      return [
        designBiquad(passType, f, BW4_Q1, 0, sampleRateHz),
        designBiquad(passType, f, BW4_Q2, 0, sampleRateHz),
      ];
    case 'butterworth-48': {
      // 8th-order Butterworth poles: Q_k = 1 / (2 * cos((2k + 1) * pi / 16)) for k = 0..3
      const qs = [0.5097955791041592, 0.6013448869350453, 0.8999762231364156, 2.5629154477415055];
      return qs.map((q) => designBiquad(passType, f, q, 0, sampleRateHz));
    }
    case 'linkwitz-riley-12': {
      const s1 = designFirstOrderSection(passType, f, sampleRateHz);
      return [s1, s1];
    }
    case 'linkwitz-riley-24': {
      const bw2 = designBiquad(passType, f, SQRT1_2, 0, sampleRateHz);
      return [bw2, bw2];
    }
    case 'linkwitz-riley-48': {
      const s1 = designBiquad(passType, f, BW4_Q1, 0, sampleRateHz);
      const s2 = designBiquad(passType, f, BW4_Q2, 0, sampleRateHz);
      return [s1, s1, s2, s2];
    }
  }
}
