// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * IEC 61672-1 A, C, and Z Sound Level Weighting:
 *  1. Exact analytical relative dB response (`computeAWeightingDb`, `computeCWeightingDb`, `computeFrequencyWeightingDb`)
 *  2. Pre-warped Bilinear Transform digital IIR biquad cascades (`createWeightingBiquadCoeffs`)
 */

import { BiquadCoefficients } from '@foh/dsp';

export type WeightingCurve = 'Z' | 'A' | 'C';
export type FrequencyWeighting = WeightingCurve;

const IEC_F1 = 20.598997;
const IEC_F2 = 107.65265;
const IEC_F3 = 737.86223;
const IEC_F4 = 12194.217;

/**
 * Computes IEC 61672-1 A-weighting relative response in dB (normalized to 0.0 dB at 1000 Hz).
 */
export function computeAWeightingDb(frequencyHz: number): number {
  if (frequencyHz <= 0) return -120;
  const f2 = frequencyHz * frequencyHz;
  const c1 = IEC_F1 * IEC_F1;
  const c2 = IEC_F2 * IEC_F2;
  const c3 = IEC_F3 * IEC_F3;
  const c4 = IEC_F4 * IEC_F4;

  const num = c4 * f2 * f2;
  const den = (f2 + c1) * Math.sqrt((f2 + c2) * (f2 + c3)) * (f2 + c4);
  if (den <= 0 || num <= 0) return -120;
  return 20 * Math.log10(num / den) + 1.9997;
}

/**
 * Computes IEC 61672-1 C-weighting relative response in dB (normalized to 0.0 dB at 1000 Hz).
 */
export function computeCWeightingDb(frequencyHz: number): number {
  if (frequencyHz <= 0) return -120;
  const f2 = frequencyHz * frequencyHz;
  const c1 = IEC_F1 * IEC_F1;
  const c4 = IEC_F4 * IEC_F4;

  const num = c4 * f2;
  const den = (f2 + c1) * (f2 + c4);
  if (den <= 0 || num <= 0) return -120;
  return 20 * Math.log10(num / den) + 0.0619;
}

/**
 * Evaluates IEC 61672-1 frequency weighting (Z, A, or C) in dB.
 */
export function computeFrequencyWeightingDb(
  frequencyHz: number,
  weighting: WeightingCurve
): number {
  if (weighting === 'A') return computeAWeightingDb(frequencyHz);
  if (weighting === 'C') return computeCWeightingDb(frequencyHz);
  return 0;
}

function bilinearTwoRealPolesSection(
  f1Hz: number,
  f2Hz: number,
  highpassZeros: 0 | 2,
  sampleRate: number
): BiquadCoefficients {
  const maxFreq = sampleRate * 0.465;
  const w1 = 2.0 * sampleRate * Math.tan((Math.PI * Math.min(f1Hz, maxFreq)) / sampleRate);
  const w2 = 2.0 * sampleRate * Math.tan((Math.PI * Math.min(f2Hz, maxFreq)) / sampleRate);
  const K = 2.0 * sampleRate;

  const K2 = K * K;
  const sumW = w1 + w2;
  const prodW = w1 * w2;

  const a0 = K2 + K * sumW + prodW;
  const a1 = 2.0 * (prodW - K2);
  const a2 = K2 - K * sumW + prodW;

  if (highpassZeros === 2) {
    return {
      b0: K2 / a0,
      b1: (-2.0 * K2) / a0,
      b2: K2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
    };
  }
  return {
    b0: prodW / a0,
    b1: (2.0 * prodW) / a0,
    b2: prodW / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function cascadeMagnitudeAt(
  coeffs: readonly BiquadCoefficients[],
  freqHz: number,
  sampleRate: number
): number {
  const w = (2.0 * Math.PI * freqHz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2.0 * w);
  const s2 = Math.sin(2.0 * w);

  let mag = 1.0;
  for (const sec of coeffs) {
    const numRe = sec.b0 + sec.b1 * c1 + sec.b2 * c2;
    const numIm = -(sec.b1 * s1 + sec.b2 * s2);
    const denRe = 1.0 + sec.a1 * c1 + sec.a2 * c2;
    const denIm = -(sec.a1 * s1 + sec.a2 * s2);
    mag *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  }
  return mag;
}

/**
 * Computes IEC 61672-1 A, C, or Z weighting digital IIR biquad cascade coefficients
 * normalized to 0.00 dB (1.0x gain) at 1000 Hz for real-time metering at `sampleRate`.
 */
export function createWeightingBiquadCoeffs(
  curve: WeightingCurve,
  sampleRate: number
): BiquadCoefficients[] {
  if (curve === 'Z') {
    return [];
  }

  const sections: BiquadCoefficients[] = [];
  if (curve === 'C') {
    sections.push(bilinearTwoRealPolesSection(IEC_F1, IEC_F1, 2, sampleRate));
    sections.push(bilinearTwoRealPolesSection(IEC_F4, IEC_F4, 0, sampleRate));
  } else if (curve === 'A') {
    sections.push(bilinearTwoRealPolesSection(IEC_F1, IEC_F1, 2, sampleRate));
    sections.push(bilinearTwoRealPolesSection(IEC_F2, IEC_F3, 2, sampleRate));
    sections.push(bilinearTwoRealPolesSection(IEC_F4, IEC_F4, 0, sampleRate));
  }

  const gainAt1kHz = cascadeMagnitudeAt(sections, 1000.0, sampleRate);
  const norm = gainAt1kHz > 1e-12 ? 1.0 / gainAt1kHz : 1.0;

  sections[0] = {
    ...sections[0],
    b0: sections[0].b0 * norm,
    b1: sections[0].b1 * norm,
    b2: sections[0].b2 * norm,
  };

  return sections;
}
