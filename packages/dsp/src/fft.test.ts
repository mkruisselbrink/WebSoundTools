// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { Radix2FFT } from './fft.js';
import { createWindowTable } from './window-functions.js';

describe('Radix2FFT', () => {
  it('computes exact inverse round-trip IFFT(FFT(x)) == x', () => {
    const N = 1024;
    const fft = new Radix2FFT(N, 'rectangular');
    const origRe = new Float32Array(N);
    const origIm = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      origRe[i] = Math.sin(0.123 * i) + 0.5 * Math.cos(0.789 * i);
      origIm[i] = Math.cos(0.456 * i) - 0.25 * Math.sin(0.321 * i);
    }

    const re = origRe.slice();
    const im = origIm.slice();

    fft.transformComplex(re, im, false);
    fft.transformComplex(re, im, true);

    for (let i = 0; i < N; i++) {
      expect(re[i]).toBeCloseTo(origRe[i], 4);
      expect(im[i]).toBeCloseTo(origIm[i], 4);
    }
  });

  it('satisfies Parseval theorem (energy conservation)', () => {
    const N = 512;
    const fft = new Radix2FFT(N, 'rectangular');
    const re = new Float32Array(N);
    const im = new Float32Array(N);

    let timeEnergy = 0;
    for (let i = 0; i < N; i++) {
      re[i] = ((i * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
      timeEnergy += re[i] * re[i];
    }

    fft.transformComplex(re, im, false);

    let freqEnergy = 0;
    for (let k = 0; k < N; k++) {
      freqEnergy += re[k] * re[k] + im[k] * im[k];
    }
    freqEnergy /= N;

    expect(freqEnergy).toBeCloseTo(timeEnergy, 3);
  });

  it('recovers exact amplitude and phase of bin-centered sinusoids in transformDualReal', () => {
    const N = 2048;
    const fft = new Radix2FFT(N, 'hann');
    const halfPlusOne = N / 2 + 1;

    const inputA = new Float32Array(N);
    const inputB = new Float32Array(N);

    const binA = 64;
    const ampA = 0.8;
    const phaseA = 0.65;

    const binB = 200;
    const ampB = 0.45;
    const phaseB = -1.15;

    for (let n = 0; n < N; n++) {
      inputA[n] = ampA * Math.cos((2 * Math.PI * binA * n) / N + phaseA);
      inputB[n] = ampB * Math.cos((2 * Math.PI * binB * n) / N + phaseB);
    }

    const outARe = new Float32Array(halfPlusOne);
    const outAIm = new Float32Array(halfPlusOne);
    const outBRe = new Float32Array(halfPlusOne);
    const outBIm = new Float32Array(halfPlusOne);

    fft.transformDualReal(inputA, inputB, outARe, outAIm, outBRe, outBIm, true);

    const magA = 2.0 * Math.hypot(outARe[binA], outAIm[binA]);
    const estPhaseA = Math.atan2(outAIm[binA], outARe[binA]);

    const magB = 2.0 * Math.hypot(outBRe[binB], outBIm[binB]);
    const estPhaseB = Math.atan2(outBIm[binB], outBRe[binB]);

    expect(magA).toBeCloseTo(ampA, 4);
    expect(estPhaseA).toBeCloseTo(phaseA, 3);
    expect(magB).toBeCloseTo(ampB, 4);
    expect(estPhaseB).toBeCloseTo(phaseB, 3);

    expect(Math.hypot(outARe[binB], outAIm[binB])).toBeLessThan(1e-6);
    expect(Math.hypot(outBRe[binA], outBIm[binA])).toBeLessThan(1e-6);

    expect(createWindowTable('hann', 4096).coherentGain).toBeCloseTo(0.5, 4);
  });
});
