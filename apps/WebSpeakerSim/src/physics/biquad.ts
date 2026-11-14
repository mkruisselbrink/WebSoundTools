/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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
 * RBJ Audio EQ Cookbook biquad filters, Linkwitz-Riley & Butterworth crossovers,
 * and complete per-group/cabinet complex DSP transfer function evaluation (`src/physics/biquad.ts`).
 */

export type BiquadFilterType =
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'lowpass'
  | 'highpass'
  | 'notch'
  | 'allpass';

export type CrossoverTopology =
  | 'off'
  | 'butterworth-12'
  | 'butterworth-18'
  | 'butterworth-24'
  | 'butterworth-48'
  | 'linkwitz-riley-12'
  | 'linkwitz-riley-24'
  | 'linkwitz-riley-48';

export interface ParametricEqBand {
  readonly id: string;
  readonly enabled: boolean;
  readonly type: BiquadFilterType;
  readonly frequencyHz: number;
  readonly gainDb: number;
  readonly q: number;
}

export interface CrossoverFilterConfig {
  readonly topology: CrossoverTopology;
  readonly frequencyHz: number;
}

export interface SourceDspConfig {
  readonly gainDb: number;
  readonly delayMs: number;
  readonly invertPolarity: boolean;
  readonly muted: boolean;
  readonly highPass: CrossoverFilterConfig;
  readonly lowPass: CrossoverFilterConfig;
  readonly eqBands: readonly ParametricEqBand[];
}

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

export interface ComplexSample {
  readonly re: number;
  readonly im: number;
}

/** High internal DSP sample rate (192 kHz) prevents bilinear-transform Nyquist cramping below 20 kHz. */
export const DSP_REFERENCE_SAMPLE_RATE_HZ = 192000;

export const DEFAULT_SOURCE_DSP_CONFIG: SourceDspConfig = {
  gainDb: 0,
  delayMs: 0,
  invertPolarity: false,
  muted: false,
  highPass: { topology: 'off', frequencyHz: 80 },
  lowPass: { topology: 'off', frequencyHz: 120 },
  eqBands: [],
};

const SQRT1_2 = Math.SQRT1_2; // 0.7071067811865476
const BW4_Q1 = 0.541196100146197; // 1 / (2 * cos(3*pi/8))
const BW4_Q2 = 1.3065629648763766; // 1 / (2 * cos(pi/8))

/**
 * Designs a normalized 2nd-order digital biquad (a0 = 1) using Robert Bristow-Johnson's equations.
 */
export function designBiquad(
  type: BiquadFilterType,
  frequencyHz: number,
  q: number,
  gainDb: number = 0,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): BiquadCoefficients {
  const clampedFreq = Math.max(5, Math.min(sampleRateHz * 0.49, frequencyHz));
  const safeQ = Math.max(0.05, Math.min(40, q));
  const w0 = (2 * Math.PI * clampedFreq) / sampleRateHz;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * safeQ);
  const A = Math.pow(10, gainDb / 40);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (type) {
    case 'peaking': {
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
      break;
    }
    case 'lowshelf': {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
      b2 = A * (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha);
      a0 = A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha;
      a1 = -2 * (A - 1 + (A + 1) * cosW0);
      a2 = A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha;
      break;
    }
    case 'highshelf': {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
      b2 = A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha);
      a0 = A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha;
      a1 = 2 * (A - 1 - (A + 1) * cosW0);
      a2 = A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha;
      break;
    }
    case 'lowpass': {
      b0 = (1 - cosW0) * 0.5;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
    case 'highpass': {
      b0 = (1 + cosW0) * 0.5;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
    case 'notch': {
      b0 = 1;
      b1 = -2 * cosW0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
    case 'allpass': {
      b0 = 1 - alpha;
      b1 = -2 * cosW0;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * Designs a 1st-order (6 dB/oct) bilinear-prewarped low-pass or high-pass section (b2 = a2 = 0).
 */
export function designFirstOrderSection(
  passType: 'lowpass' | 'highpass',
  frequencyHz: number,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): BiquadCoefficients {
  const clampedFreq = Math.max(5, Math.min(sampleRateHz * 0.49, frequencyHz));
  const k = Math.tan((Math.PI * clampedFreq) / sampleRateHz);
  const invDen = 1 / (1 + k);

  if (passType === 'lowpass') {
    return {
      b0: k * invDen,
      b1: k * invDen,
      b2: 0,
      a1: (k - 1) * invDen,
      a2: 0,
    };
  }
  return {
    b0: invDen,
    b1: -invDen,
    b2: 0,
    a1: (k - 1) * invDen,
    a2: 0,
  };
}

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

/**
 * Evaluates the complex transfer function H(e^{j*omega}) of a biquad cascade at `frequencyHz`.
 */
export function evaluateBiquadCascade(
  sections: readonly BiquadCoefficients[],
  frequencyHz: number,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): ComplexSample {
  if (sections.length === 0) {
    return { re: 1, im: 0 };
  }

  const w = (2 * Math.PI * frequencyHz) / sampleRateHz;
  const z1Re = Math.cos(-w);
  const z1Im = Math.sin(-w);
  const z2Re = Math.cos(-2 * w);
  const z2Im = Math.sin(-2 * w);

  let accRe = 1;
  let accIm = 0;

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const numRe = s.b0 + s.b1 * z1Re + s.b2 * z2Re;
    const numIm = s.b1 * z1Im + s.b2 * z2Im;
    const denRe = 1 + s.a1 * z1Re + s.a2 * z2Re;
    const denIm = s.a1 * z1Im + s.a2 * z2Im;

    const denMag2 = Math.max(1e-24, denRe * denRe + denIm * denIm);
    const hRe = (numRe * denRe + numIm * denIm) / denMag2;
    const hIm = (numIm * denRe - numRe * denIm) / denMag2;

    const nextRe = accRe * hRe - accIm * hIm;
    const nextIm = accRe * hIm + accIm * hRe;
    accRe = nextRe;
    accIm = nextIm;
  }

  return { re: accRe, im: accIm };
}

/**
 * Compiles a `SourceDspConfig` into its biquad cascade once, then evaluates complex H_DSP(f)
 * across an entire frequency array into interleaved or planar Float32Arrays.
 */
export interface CompiledDspChain {
  readonly muted: boolean;
  readonly linearGainSigned: number;
  readonly delaySeconds: number;
  readonly sections: readonly BiquadCoefficients[];
}

export function compileDspChain(
  groupDsp: SourceDspConfig,
  trim?: { gainDb?: number; delayMs?: number; invertPolarity?: boolean; muted?: boolean },
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): CompiledDspChain {
  const muted = groupDsp.muted || Boolean(trim?.muted);
  const totalGainDb = groupDsp.gainDb + (trim?.gainDb ?? 0);
  const invert = groupDsp.invertPolarity !== Boolean(trim?.invertPolarity);
  const linearGainSigned = (invert ? -1 : 1) * Math.pow(10, totalGainDb / 20);
  const delaySeconds = (groupDsp.delayMs + (trim?.delayMs ?? 0)) * 1e-3;

  const sections: BiquadCoefficients[] = [
    ...designCrossoverSections('highpass', groupDsp.highPass, sampleRateHz),
    ...designCrossoverSections('lowpass', groupDsp.lowPass, sampleRateHz),
  ];

  for (const band of groupDsp.eqBands) {
    if (!band.enabled) continue;
    sections.push(designBiquad(band.type, band.frequencyHz, band.q, band.gainDb, sampleRateHz));
  }

  return {
    muted,
    linearGainSigned,
    delaySeconds,
    sections,
  };
}

/**
 * Evaluates a compiled DSP chain at `frequencyHz`, including gain, polarity, electronic delay,
 * crossovers, and parametric EQ.
 */
export function evaluateCompiledDspAtFrequency(
  chain: CompiledDspChain,
  frequencyHz: number,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): ComplexSample {
  if (chain.muted) {
    return { re: 0, im: 0 };
  }

  const filterH = evaluateBiquadCascade(chain.sections, frequencyHz, sampleRateHz);
  const delayPhase = -2 * Math.PI * frequencyHz * chain.delaySeconds;
  const rotRe = Math.cos(delayPhase) * chain.linearGainSigned;
  const rotIm = Math.sin(delayPhase) * chain.linearGainSigned;

  return {
    re: filterH.re * rotRe - filterH.im * rotIm,
    im: filterH.re * rotIm + filterH.im * rotRe,
  };
}

