/**
 * High-performance Radix-2 Cooley-Tukey FFT & IFFT in pure TypeScript.
 *
 * Includes a Dual-Real-Channel Packed FFT (`transformDualReal`) that packs
 * Measurement M[n] into the real part and Reference R[n] into the imaginary part
 * of a single complex buffer Z[n] = M[n] + i*R[n], runs one forward FFT, and
 * unpacks the conjugate-symmetric halves into M(k) and R(k) — cutting FFT CPU time in half!
 */

import { WindowFunctionType, WindowTable, createWindowTable } from './window-functions.js';

export class Radix2FFT {
  readonly size: number;
  readonly halfSize: number;
  private readonly bitRev: Uint32Array;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private windowTable: WindowTable;

  // Scratch buffers for in-place complex transform
  private readonly workRe: Float32Array;
  private readonly workIm: Float32Array;

  constructor(size: number, windowType: WindowFunctionType = 'hann') {
    if ((size & (size - 1)) !== 0 || size < 2) {
      throw new Error(`FFT size must be a power of 2 >= 2, got ${size}`);
    }
    this.size = size;
    this.halfSize = size >>> 1;
    this.bitRev = new Uint32Array(size);
    this.cosTable = new Float32Array(this.halfSize);
    this.sinTable = new Float32Array(this.halfSize);
    this.workRe = new Float32Array(size);
    this.workIm = new Float32Array(size);
    this.windowTable = createWindowTable(windowType, size);

    this.precomputeTables();
  }

  private precomputeTables(): void {
    const N = this.size;
    const levels = Math.round(Math.log2(N));
    for (let i = 0; i < N; i++) {
      let rev = 0;
      let val = i;
      for (let j = 0; j < levels; j++) {
        rev = (rev << 1) | (val & 1);
        val >>>= 1;
      }
      this.bitRev[i] = rev;
    }

    for (let k = 0; k < this.halfSize; k++) {
      const angle = (-2.0 * Math.PI * k) / N;
      this.cosTable[k] = Math.cos(angle);
      this.sinTable[k] = Math.sin(angle);
    }
  }

  setWindowType(windowType: WindowFunctionType): void {
    if (this.windowTable.type !== windowType) {
      this.windowTable = createWindowTable(windowType, this.size);
    }
  }

  getWindowTable(): WindowTable {
    return this.windowTable;
  }

  /**
   * In-place Radix-2 FFT on `re` and `im` arrays of length `this.size`.
   * If `inverse` is true, computes the normalized Inverse FFT (1/N scaling).
   */
  transformComplex(re: Float32Array, im: Float32Array, inverse: boolean = false): void {
    const N = this.size;
    const bitRev = this.bitRev;

    // Bit-reversal permutation
    for (let i = 0; i < N; i++) {
      const j = bitRev[i];
      if (i < j) {
        const tmpRe = re[i];
        re[i] = re[j];
        re[j] = tmpRe;

        const tmpIm = im[i];
        im[i] = im[j];
        im[j] = tmpIm;
      }
    }

    const cosTable = this.cosTable;
    const sinTable = this.sinTable;
    const sign = inverse ? -1.0 : 1.0;

    // Butterfly stages
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >>> 1;
      const step = N / len;

      for (let i = 0; i < N; i += len) {
        let k = 0;
        for (let j = i; j < i + halfLen; j++) {
          const l = j + halfLen;
          const cos = cosTable[k];
          const sin = sinTable[k] * sign;
          k += step;

          const tRe = re[l] * cos - im[l] * sin;
          const tIm = re[l] * sin + im[l] * cos;

          re[l] = re[j] - tRe;
          im[l] = im[j] - tIm;
          re[j] += tRe;
          im[j] += tIm;
        }
      }
    }

    if (inverse) {
      const invN = 1.0 / N;
      for (let i = 0; i < N; i++) {
        re[i] *= invN;
        im[i] *= invN;
      }
    }
  }

  /**
   * Simultaneous Windowed FFT of two real signals (`inputA` and `inputB`, e.g., Measurement & Reference)
   * using a single complex FFT via conjugate symmetry unpacking.
   *
   * Output arrays `outARe`, `outAIm`, `outBRe`, `outBIm` must have length >= `this.halfSize + 1` (bins 0 .. N/2).
   * Values are normalized by `1 / (N * coherentGain)` so a full-scale sine wave on a bin has amplitude 1.0.
   */
  transformDualReal(
    inputA: Float32Array,
    inputB: Float32Array,
    outARe: Float32Array,
    outAIm: Float32Array,
    outBRe: Float32Array,
    outBIm: Float32Array,
    removeDc: boolean = true
  ): void {
    const N = this.size;
    const halfN = this.halfSize;
    const w = this.windowTable.weights;
    const re = this.workRe;
    const im = this.workIm;

    let meanA = 0;
    let meanB = 0;
    if (removeDc) {
      for (let i = 0; i < N; i++) {
        meanA += inputA[i];
        meanB += inputB[i];
      }
      meanA /= N;
      meanB /= N;
    }

    for (let i = 0; i < N; i++) {
      const wi = w[i];
      re[i] = (inputA[i] - meanA) * wi;
      im[i] = (inputB[i] - meanB) * wi;
    }

    this.transformComplex(re, im, false);

    // Scale by 1 / (N * coherentGain)
    const scale = 1.0 / (N * this.windowTable.coherentGain);

    // Bin 0 (DC)
    outARe[0] = re[0] * scale;
    outAIm[0] = 0;
    outBRe[0] = im[0] * scale;
    outBIm[0] = 0;

    // Bin N/2 (Nyquist)
    outARe[halfN] = re[halfN] * scale;
    outAIm[halfN] = 0;
    outBRe[halfN] = im[halfN] * scale;
    outBIm[halfN] = 0;

    // Unpack bins k = 1 .. N/2 - 1 using Z(k) and Z*(N - k)
    const halfScale = 0.5 * scale;
    for (let k = 1; k < halfN; k++) {
      const nk = N - k;
      const zRe = re[k];
      const zIm = im[k];
      const znRe = re[nk];
      const znIm = im[nk];

      // A(k) = 0.5 * (Z(k) + Z*(N-k))
      outARe[k] = (zRe + znRe) * halfScale;
      outAIm[k] = (zIm - znIm) * halfScale;

      // B(k) = -0.5i * (Z(k) - Z*(N-k))
      outBRe[k] = (zIm + znIm) * halfScale;
      outBIm[k] = (znRe - zRe) * halfScale;
    }
  }
}
