// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Unified Robert Bristow-Johnson (RBJ) Audio EQ Cookbook biquad filters,
 * 1st-order bilinear sections, analytical complex frequency response evaluation H(e^{jw}),
 * and stateful Transposed Direct Form II time-domain processors.
 */

export type BiquadFilterType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'notch'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'allpass';

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

export interface BiquadSpec {
  readonly type: BiquadFilterType;
  readonly frequency: number; // Hz
  readonly q?: number; // Quality factor (default SQRT1_2)
  readonly gainDb?: number; // dB (for peaking, lowshelf, highshelf)
  readonly enabled?: boolean;
}

export interface ComplexSample {
  readonly re: number;
  readonly im: number;
}

export interface ComplexResponse {
  readonly re: number;
  readonly im: number;
  readonly magnitude: number;
  readonly phaseRad: number;
}

/**
 * High internal DSP reference sample rate (192 kHz) prevents bilinear-transform
 * Nyquist frequency cramping near 16–20 kHz when modeling virtual DSP chains.
 */
export const DSP_REFERENCE_SAMPLE_RATE_HZ = 192000;

/**
 * Designs normalized 2nd-order digital biquad coefficients (a0 = 1) using RBJ Audio EQ Cookbook equations.
 * Defaults to `DSP_REFERENCE_SAMPLE_RATE_HZ` (192 kHz) for cramp-free analytical evaluation.
 */
export function designBiquad(
  type: BiquadFilterType,
  frequencyHz: number,
  q: number = Math.SQRT1_2,
  gainDb: number = 0,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): BiquadCoefficients {
  const f0 = Math.max(1.0, Math.min(frequencyHz, sampleRateHz * 0.499));
  const safeQ = Math.max(0.02, Math.min(60.0, q));
  const A = Math.pow(10.0, gainDb / 40.0);
  const w0 = (2.0 * Math.PI * f0) / sampleRateHz;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2.0 * safeQ);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (type) {
    case 'lowpass':
      b0 = (1.0 - cosw0) * 0.5;
      b1 = 1.0 - cosw0;
      b2 = (1.0 - cosw0) * 0.5;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosw0;
      a2 = 1.0 - alpha;
      break;

    case 'highpass':
      b0 = (1.0 + cosw0) * 0.5;
      b1 = -(1.0 + cosw0);
      b2 = (1.0 + cosw0) * 0.5;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosw0;
      a2 = 1.0 - alpha;
      break;

    case 'bandpass':
      b0 = alpha;
      b1 = 0.0;
      b2 = -alpha;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosw0;
      a2 = 1.0 - alpha;
      break;

    case 'notch':
      b0 = 1.0;
      b1 = -2.0 * cosw0;
      b2 = 1.0;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosw0;
      a2 = 1.0 - alpha;
      break;

    case 'peaking':
      b0 = 1.0 + alpha * A;
      b1 = -2.0 * cosw0;
      b2 = 1.0 - alpha * A;
      a0 = 1.0 + alpha / A;
      a1 = -2.0 * cosw0;
      a2 = 1.0 - alpha / A;
      break;

    case 'lowshelf': {
      const twoSqrtAAlpha = 2.0 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1.0 - (A - 1.0) * cosw0 + twoSqrtAAlpha);
      b1 = 2.0 * A * (A - 1.0 - (A + 1.0) * cosw0);
      b2 = A * (A + 1.0 - (A - 1.0) * cosw0 - twoSqrtAAlpha);
      a0 = A + 1.0 + (A - 1.0) * cosw0 + twoSqrtAAlpha;
      a1 = -2.0 * (A - 1.0 + (A + 1.0) * cosw0);
      a2 = A + 1.0 + (A - 1.0) * cosw0 - twoSqrtAAlpha;
      break;
    }

    case 'highshelf': {
      const twoSqrtAAlpha = 2.0 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1.0 + (A - 1.0) * cosw0 + twoSqrtAAlpha);
      b1 = -2.0 * A * (A - 1.0 + (A + 1.0) * cosw0);
      b2 = A * (A + 1.0 + (A - 1.0) * cosw0 - twoSqrtAAlpha);
      a0 = A + 1.0 - (A - 1.0) * cosw0 + twoSqrtAAlpha;
      a1 = 2.0 * (A - 1.0 - (A + 1.0) * cosw0);
      a2 = A + 1.0 - (A - 1.0) * cosw0 - twoSqrtAAlpha;
      break;
    }

    case 'allpass':
      b0 = 1.0 - alpha;
      b1 = -2.0 * cosw0;
      b2 = 1.0 + alpha;
      a0 = 1.0 + alpha;
      a1 = -2.0 * cosw0;
      a2 = 1.0 - alpha;
      break;
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
 * Computes normalized biquad coefficients from a `BiquadSpec` at an explicit `sampleRate`.
 */
export function computeBiquadCoefficients(
  spec: BiquadSpec,
  sampleRate: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): BiquadCoefficients {
  if (spec.enabled === false) {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }
  return designBiquad(
    spec.type,
    spec.frequency,
    spec.q ?? Math.SQRT1_2,
    spec.gainDb ?? 0,
    sampleRate
  );
}

/**
 * Designs a 1st-order (6 dB/oct) bilinear-prewarped low-pass or high-pass section (b2 = a2 = 0).
 */
export function designFirstOrderSection(
  passType: 'lowpass' | 'highpass',
  frequencyHz: number,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): BiquadCoefficients {
  const clampedFreq = Math.max(1.0, Math.min(sampleRateHz * 0.495, frequencyHz));
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
 * Evaluates the exact complex frequency response H(e^{jw}) of a single biquad filter.
 */
export function evaluateBiquadComplexResponse(
  coeffs: BiquadCoefficients,
  frequencyHz: number,
  sampleRate: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): ComplexResponse {
  const w = (2.0 * Math.PI * frequencyHz) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2.0 * w);
  const sin2 = Math.sin(2.0 * w);

  const numRe = coeffs.b0 + coeffs.b1 * cos1 + coeffs.b2 * cos2;
  const numIm = -(coeffs.b1 * sin1 + coeffs.b2 * sin2);

  const denRe = 1.0 + coeffs.a1 * cos1 + coeffs.a2 * cos2;
  const denIm = -(coeffs.a1 * sin1 + coeffs.a2 * sin2);

  const denMagSq = denRe * denRe + denIm * denIm + 1e-30;
  const re = (numRe * denRe + numIm * denIm) / denMagSq;
  const im = (numIm * denRe - numRe * denIm) / denMagSq;
  const magnitude = Math.hypot(re, im);
  const phaseRad = Math.atan2(im, re);

  return { re, im, magnitude, phaseRad };
}

/**
 * Evaluates the complex transfer function H(e^{jw}) of a biquad cascade as `{ re, im }`.
 */
export function evaluateBiquadCascade(
  sections: readonly BiquadCoefficients[],
  frequencyHz: number,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): ComplexSample {
  if (sections.length === 0) {
    return { re: 1, im: 0 };
  }

  const w = (2.0 * Math.PI * frequencyHz) / sampleRateHz;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2.0 * w);
  const sin2 = Math.sin(2.0 * w);

  let accRe = 1.0;
  let accIm = 0.0;

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const numRe = s.b0 + s.b1 * cos1 + s.b2 * cos2;
    const numIm = -(s.b1 * sin1 + s.b2 * sin2);
    const denRe = 1.0 + s.a1 * cos1 + s.a2 * cos2;
    const denIm = -(s.a1 * sin1 + s.a2 * sin2);

    const denMag2 = Math.max(1e-30, denRe * denRe + denIm * denIm);
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
 * Evaluates a cascade of multiple BiquadCoefficients with `{ re, im, magnitude, phaseRad }`.
 */
export function evaluateBiquadCascadeResponse(
  cascade: readonly BiquadCoefficients[],
  frequencyHz: number,
  sampleRate: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): ComplexResponse {
  const { re, im } = evaluateBiquadCascade(cascade, frequencyHz, sampleRate);
  return {
    re,
    im,
    magnitude: Math.hypot(re, im),
    phaseRad: Math.atan2(im, re),
  };
}

/**
 * Stateful time-domain Transposed Direct Form II Biquad Filter processor.
 */
export class BiquadFilter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(coeffs?: BiquadCoefficients) {
    if (coeffs) {
      this.setCoefficients(coeffs);
    }
  }

  setCoefficients(coeffs: BiquadCoefficients): void {
    this.b0 = coeffs.b0;
    this.b1 = coeffs.b1;
    this.b2 = coeffs.b2;
    this.a1 = coeffs.a1;
    this.a2 = coeffs.a2;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  processSample(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  processBuffer(input: Float32Array, output: Float32Array = input): void {
    const len = input.length;
    let z1 = this.z1;
    let z2 = this.z2;
    const b0 = this.b0;
    const b1 = this.b1;
    const b2 = this.b2;
    const a1 = this.a1;
    const a2 = this.a2;

    for (let i = 0; i < len; i++) {
      const x = input[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      output[i] = y;
    }

    this.z1 = z1;
    this.z2 = z2;
  }
}

/**
 * Stateful cascade of multiple `BiquadFilter` stages.
 */
export class BiquadCascade {
  private readonly stages: BiquadFilter[];
  private coeffsList: BiquadCoefficients[];

  constructor(coeffsList: readonly BiquadCoefficients[] = []) {
    this.coeffsList = [...coeffsList];
    this.stages = coeffsList.map((c) => new BiquadFilter(c));
  }

  setCoefficientsList(coeffsList: readonly BiquadCoefficients[]): void {
    this.coeffsList = [...coeffsList];
    while (this.stages.length < coeffsList.length) {
      this.stages.push(new BiquadFilter());
    }
    this.stages.length = coeffsList.length;
    for (let i = 0; i < coeffsList.length; i++) {
      this.stages[i].setCoefficients(coeffsList[i]);
    }
  }

  getCoefficientsList(): readonly BiquadCoefficients[] {
    return this.coeffsList;
  }

  reset(): void {
    for (const s of this.stages) {
      s.reset();
    }
  }

  processSample(x: number): number {
    let val = x;
    for (let i = 0; i < this.stages.length; i++) {
      val = this.stages[i].processSample(val);
    }
    return val;
  }

  processBuffer(input: Float32Array, output: Float32Array = input): void {
    if (this.stages.length === 0) {
      if (output !== input) {
        output.set(input);
      }
      return;
    }
    this.stages[0].processBuffer(input, output);
    for (let i = 1; i < this.stages.length; i++) {
      this.stages[i].processBuffer(output, output);
    }
  }
}
