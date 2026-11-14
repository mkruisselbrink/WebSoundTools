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
 * Frequency-Domain Regularized Deconvolution (Impulse Response, Step Response, ETC)
 * and Cross-Correlation / Deconvolution Auto Delay Finder with Sub-Sample Parabolic Interpolation.
 */

import { Radix2FFT } from './fft.js';
import { WindowFunctionType } from './window-functions.js';

export interface DelayEstimate {
  /** Signed integer delay in samples (positive = Measurement arrives after Reference) */
  readonly delaySamples: number;
  /** Sub-sample interpolated delay in samples */
  readonly subsampleDelaySamples: number;
  /** Delay in milliseconds */
  readonly delayMs: number;
  /** Peak impulse magnitude (0..1+) */
  readonly peakAmplitude: number;
  /** Detected polarity (+1 for normal, -1 for inverted polarity) */
  readonly polarity: 1 | -1;
}

export class DeconvolutionAnalyzer {
  readonly size: number;
  readonly halfSize: number;
  private sampleRate: number;
  private readonly fft: Radix2FFT;

  // Scratch complex buffers of length `size`
  private readonly aRe: Float32Array;
  private readonly aIm: Float32Array;
  private readonly bRe: Float32Array;
  private readonly bIm: Float32Array;
  private readonly hRe: Float32Array;
  private readonly hIm: Float32Array;

  // Centered output buffers of length `size` (t = 0 ms at index `halfSize`)
  readonly timeMs: Float32Array;
  readonly impulse: Float32Array;
  readonly stepResponse: Float32Array;

  // Averaging state for impulse response
  private readonly avgImpulse: Float32Array;
  private hasHistory: boolean = false;

  private lastEstimate: DelayEstimate = {
    delaySamples: 0,
    subsampleDelaySamples: 0,
    delayMs: 0,
    peakAmplitude: 0,
    polarity: 1,
  };

  constructor(size: number, sampleRate: number = 48000, windowType: WindowFunctionType = 'hann') {
    this.size = size;
    this.halfSize = size >>> 1;
    this.sampleRate = sampleRate;
    this.fft = new Radix2FFT(size, windowType);

    const halfPlusOne = this.halfSize + 1;
    this.aRe = new Float32Array(halfPlusOne);
    this.aIm = new Float32Array(halfPlusOne);
    this.bRe = new Float32Array(halfPlusOne);
    this.bIm = new Float32Array(halfPlusOne);

    this.hRe = new Float32Array(size);
    this.hIm = new Float32Array(size);

    this.timeMs = new Float32Array(size);
    this.impulse = new Float32Array(size);
    this.stepResponse = new Float32Array(size);
    this.avgImpulse = new Float32Array(size);

    this.updateTimeAxis();
  }

  setSampleRate(sampleRate: number): void {
    if (this.sampleRate !== sampleRate) {
      this.sampleRate = sampleRate;
      this.updateTimeAxis();
    }
  }

  setWindowType(windowType: WindowFunctionType): void {
    this.fft.setWindowType(windowType);
  }

  reset(): void {
    this.impulse.fill(0);
    this.stepResponse.fill(0);
    this.avgImpulse.fill(0);
    this.hasHistory = false;
  }

  private updateTimeAxis(): void {
    const dtMs = 1000.0 / this.sampleRate;
    const half = this.halfSize;
    for (let i = 0; i < this.size; i++) {
      this.timeMs[i] = (i - half) * dtMs;
    }
  }

  /**
   * Computes the deconvolved impulse response from time-domain buffers `inputM` and `inputR`
   * (or directly from pre-computed spectra `mRe`, `mIm`, `rRe`, `rIm`).
   */
  processTimeDomain(
    inputM: Float32Array,
    inputR: Float32Array,
    smoothingFactor: number = 0.0
  ): DelayEstimate {
    this.fft.transformDualReal(inputM, inputR, this.aRe, this.aIm, this.bRe, this.bIm, true);
    return this.processSpectra(this.aRe, this.aIm, this.bRe, this.bIm, smoothingFactor);
  }

  /**
   * Computes the deconvolved impulse response from half-spectrum bins (0 .. N/2) of M and R.
   */
  processSpectra(
    mRe: Float32Array,
    mIm: Float32Array,
    rRe: Float32Array,
    rIm: Float32Array,
    smoothingFactor: number = 0.0
  ): DelayEstimate {
    const N = this.size;
    const halfN = this.halfSize;
    const hRe = this.hRe;
    const hIm = this.hIm;

    // Find peak reference power to set a relative Tikhonov regularization floor
    let maxRefPower = 0;
    for (let k = 0; k <= halfN; k++) {
      const p = rRe[k] * rRe[k] + rIm[k] * rIm[k];
      if (p > maxRefPower) {
        maxRefPower = p;
      }
    }
    // Regularization floor (-100 dB relative to peak reference bin, plus absolute floor)
    const regFloor = maxRefPower * 1e-10 + 1e-20;

    // Bin 0 (DC) & Bin N/2 (Nyquist)
    const den0 = rRe[0] * rRe[0] + regFloor;
    hRe[0] = (mRe[0] * rRe[0]) / den0;
    hIm[0] = 0;

    const denNyq = rRe[halfN] * rRe[halfN] + regFloor;
    hRe[halfN] = (mRe[halfN] * rRe[halfN]) / denNyq;
    hIm[halfN] = 0;

    // Bins 1 .. N/2 - 1 and Hermitian conjugate symmetry for N - k
    for (let k = 1; k < halfN; k++) {
      const mr = mRe[k];
      const mi = mIm[k];
      const rr = rRe[k];
      const ri = rIm[k];

      const den = rr * rr + ri * ri + regFloor;
      // H(k) = (M(k) * R*(k)) / (|R(k)|^2 + regFloor)
      const re = (mr * rr + mi * ri) / den;
      const im = (mi * rr - mr * ri) / den;

      hRe[k] = re;
      hIm[k] = im;

      // Conjugate symmetry: H(N - k) = H*(k)
      const nk = N - k;
      hRe[nk] = re;
      hIm[nk] = -im;
    }

    // Inverse FFT (normalized by 1/N inside transformComplex)
    this.fft.transformComplex(hRe, hIm, true);

    // Circularly shift so lag 0 is at index `halfN` (t = 0 ms),
    // and track maximum absolute peak for Delay Estimate.
    let maxAbs = -1;
    let maxUnshiftedIdx = 0;
    let maxSignedVal = 0;

    const alpha = this.hasHistory ? Math.max(0, Math.min(0.99, smoothingFactor)) : 0;
    const oneMinusAlpha = 1.0 - alpha;

    for (let i = 0; i < N; i++) {
      const centeredIdx = (i + halfN) & (N - 1);
      const rawVal = hRe[i];
      const smoothedVal = alpha * this.avgImpulse[centeredIdx] + oneMinusAlpha * rawVal;
      this.avgImpulse[centeredIdx] = smoothedVal;
      this.impulse[centeredIdx] = smoothedVal;

      const absVal = Math.abs(smoothedVal);
      if (absVal > maxAbs) {
        maxAbs = absVal;
        maxUnshiftedIdx = i;
        maxSignedVal = smoothedVal;
      }
    }
    this.hasHistory = true;

    // Compute Step Response (cumulative integral of centered impulse,
    // subtracting pre-arrival baseline offset caused by AC-coupled / DC-zeroed FFT)
    let baselineOffset = 0;
    const preWindow = Math.max(1, N >>> 2);
    for (let i = 0; i < preWindow; i++) {
      baselineOffset += this.impulse[i];
    }
    baselineOffset /= preWindow;

    let runningSum = 0;
    for (let i = 0; i < N; i++) {
      runningSum += this.impulse[i] - baselineOffset;
      this.stepResponse[i] = runningSum;
    }

    // Signed integer sample delay in [-N/2, +N/2 - 1]
    const delaySamples = maxUnshiftedIdx >= halfN ? maxUnshiftedIdx - N : maxUnshiftedIdx;

    // 3-point parabolic interpolation on |h| around `maxUnshiftedIdx` for sub-sample precision
    const prevIdx = (maxUnshiftedIdx - 1 + N) & (N - 1);
    const nextIdx = (maxUnshiftedIdx + 1) & (N - 1);
    const y1 = Math.abs(this.impulse[(prevIdx + halfN) & (N - 1)]);
    const y2 = maxAbs;
    const y3 = Math.abs(this.impulse[(nextIdx + halfN) & (N - 1)]);

    const denom = y1 - 2.0 * y2 + y3;
    let fractionalOffset = 0;
    if (Math.abs(denom) > 1e-12) {
      fractionalOffset = (0.5 * (y1 - y3)) / denom;
      fractionalOffset = Math.max(-0.5, Math.min(0.5, fractionalOffset));
    }

    const subsampleDelaySamples = delaySamples + fractionalOffset;
    const delayMs = (1000.0 * subsampleDelaySamples) / this.sampleRate;

    this.lastEstimate = {
      delaySamples,
      subsampleDelaySamples,
      delayMs,
      peakAmplitude: maxAbs,
      polarity: maxSignedVal >= 0 ? 1 : -1,
    };

    return this.lastEstimate;
  }

  getLastDelayEstimate(): DelayEstimate {
    return this.lastEstimate;
  }
}
