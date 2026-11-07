/**
 * Robert Bristow-Johnson (RBJ) Audio EQ Cookbook Biquad Filter implementation
 * plus exact analytical complex frequency response evaluation H(e^{jw}).
 *
 * Used for:
 *  1. Input pre-filtering & IEC 61672 A/C weighting cascades
 *  2. Virtual Parametric EQ (`EqualizerSource`) and Crossover (`FilterSource`) modeling
 *  3. Deterministic Synthetic Acoustic Rig (`synthetic-rig.ts`) for unit testing
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
  readonly q?: number;        // Quality factor (default 0.70710678)
  readonly gainDb?: number;   // dB (for peaking, lowshelf, highshelf)
  readonly enabled?: boolean;
}

/**
 * Computes normalized Direct Form I / II biquad coefficients (a0 = 1)
 * using Robert Bristow-Johnson's Audio EQ Cookbook formulas.
 */
export function computeBiquadCoefficients(
  spec: BiquadSpec,
  sampleRate: number
): BiquadCoefficients {
  if (spec.enabled === false) {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }

  const f0 = Math.max(1.0, Math.min(spec.frequency, sampleRate * 0.499));
  const Q = Math.max(0.02, spec.q ?? Math.SQRT1_2);
  const dBgain = spec.gainDb ?? 0;

  const A = Math.pow(10.0, dBgain / 40.0);
  const w0 = (2.0 * Math.PI * f0) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2.0 * Q);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (spec.type) {
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
 * Evaluates the exact complex frequency response H(e^{jw}) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
 * of a single biquad filter at `frequencyHz` for `sampleRate`.
 */
export function evaluateBiquadComplexResponse(
  coeffs: BiquadCoefficients,
  frequencyHz: number,
  sampleRate: number
): { re: number; im: number; magnitude: number; phaseRad: number } {
  const w = (2.0 * Math.PI * frequencyHz) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2.0 * w);
  const sin2 = Math.sin(2.0 * w);

  // Numerator B(e^{-jw}) = b0 + b1*(cos(w) - i*sin(w)) + b2*(cos(2w) - i*sin(2w))
  const numRe = coeffs.b0 + coeffs.b1 * cos1 + coeffs.b2 * cos2;
  const numIm = -(coeffs.b1 * sin1 + coeffs.b2 * sin2);

  // Denominator A(e^{-jw}) = 1 + a1*(cos(w) - i*sin(w)) + a2*(cos(2w) - i*sin(2w))
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
 * Evaluates a cascade of multiple BiquadCoefficients at `frequencyHz`.
 */
export function evaluateBiquadCascadeResponse(
  cascade: readonly BiquadCoefficients[],
  frequencyHz: number,
  sampleRate: number
): { re: number; im: number; magnitude: number; phaseRad: number } {
  let totalRe = 1.0;
  let totalIm = 0.0;

  for (let i = 0; i < cascade.length; i++) {
    const { re, im } = evaluateBiquadComplexResponse(cascade[i], frequencyHz, sampleRate);
    const nextRe = totalRe * re - totalIm * im;
    const nextIm = totalRe * im + totalIm * re;
    totalRe = nextRe;
    totalIm = nextIm;
  }

  return {
    re: totalRe,
    im: totalIm,
    magnitude: Math.hypot(totalRe, totalIm),
    phaseRad: Math.atan2(totalIm, totalRe),
  };
}

/**
 * Stateful time-domain Transposed Direct Form II Biquad Filter processor.
 */
export class BiquadFilter {
  private b0: number = 1;
  private b1: number = 0;
  private b2: number = 0;
  private a1: number = 0;
  private a2: number = 0;
  private z1: number = 0;
  private z2: number = 0;

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
 * Stateful cascade of multiple BiquadFilter stages (e.g., 4th-order Linkwitz-Riley, A-weighting, or multi-band EQ).
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
