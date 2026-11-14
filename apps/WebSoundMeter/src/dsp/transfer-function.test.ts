// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  BiquadFilter,
  BiquadSpec,
  Radix2FFT,
  computeBiquadCoefficients,
  evaluateBiquadComplexResponse,
} from '@foh/dsp';
import { describe, expect, it } from 'vitest';
import { TransferFunctionAnalyzer } from './transfer-function.js';

function createPrng(seed: number = 123456789): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2147483648.0 - 1.0;
  };
}

describe('TransferFunctionAnalyzer & Coherence', () => {
  const sampleRate = 48000;
  const fftSize = 4096;

  it('recovers known biquad filter Magnitude (within 0.05 dB) and Phase (within 0.5 deg)', () => {
    const spec: BiquadSpec = {
      type: 'peaking',
      frequency: 1000,
      q: 2.0,
      gainDb: 6.0,
    };
    const coeffs = computeBiquadCoefficients(spec, sampleRate);
    const filter = new BiquadFilter(coeffs);

    // Use rectangular window with periodic noise block or multi-frame Hann averaging
    const fft = new Radix2FFT(fftSize, 'hann');
    const tf = new TransferFunctionAnalyzer({
      fftSize,
      sampleRate,
      averagingType: 'fifo',
      fifoDepth: 32,
      coherenceDepth: 16,
      estimator: 'h1',
    });

    const rand = createPrng(42);
    const totalSamples = fftSize * 40;
    const streamR = new Float32Array(totalSamples);
    const streamM = new Float32Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      const r = rand() * 0.5;
      streamR[i] = r;
      streamM[i] = filter.processSample(r);
    }

    const binCount = fftSize / 2 + 1;
    const mRe = new Float32Array(binCount);
    const mIm = new Float32Array(binCount);
    const rRe = new Float32Array(binCount);
    const rIm = new Float32Array(binCount);

    // Skip first frame so filter transient has settled
    for (let frame = 1; frame < 33; frame++) {
      const offset = frame * fftSize;
      const blockM = streamM.subarray(offset, offset + fftSize);
      const blockR = streamR.subarray(offset, offset + fftSize);
      fft.transformDualReal(blockM, blockR, mRe, mIm, rRe, rIm, true);
      tf.processFrame(mRe, mIm, rRe, rIm);
    }

    // Check across bins from 100 Hz to 16 kHz
    for (let k = 10; k < binCount - 100; k += 15) {
      const freq = tf.frequency[k];
      const expected = evaluateBiquadComplexResponse(coeffs, freq, sampleRate);

      const measuredDb = 20 * Math.log10(tf.magnitude[k]);
      const expectedDb = 20 * Math.log10(expected.magnitude);
      expect(Math.abs(measuredDb - expectedDb)).toBeLessThan(0.08);

      const measuredPhaseDeg = (Math.atan2(tf.phaseImag[k], tf.phaseReal[k]) * 180) / Math.PI;
      const expectedPhaseDeg = (expected.phaseRad * 180) / Math.PI;
      expect(Math.abs(measuredPhaseDeg - expectedPhaseDeg)).toBeLessThan(0.8);

      // Coherence should be ~1.0 for a noiseless LTI filter
      expect(tf.coherence[k]).toBeGreaterThan(0.995);
    }
  });

  it('averages complex phase across +/-180 deg wrap-around without averaging to 0 deg', () => {
    const tf = new TransferFunctionAnalyzer({
      fftSize: 64,
      sampleRate: 48000,
      averagingType: 'fifo',
      fifoDepth: 2,
      estimator: 'ratio',
    });

    const B = tf.binCount;
    const mRe = new Float32Array(B);
    const mIm = new Float32Array(B);
    const rRe = new Float32Array(B).fill(1.0);
    const rIm = new Float32Array(B).fill(0.0);

    // Frame 1: +179 degrees
    const rad1 = (179 * Math.PI) / 180;
    mRe.fill(Math.cos(rad1));
    mIm.fill(Math.sin(rad1));
    tf.processFrame(mRe, mIm, rRe, rIm);

    // Frame 2: -179 degrees
    const rad2 = (-179 * Math.PI) / 180;
    mRe.fill(Math.cos(rad2));
    mIm.fill(Math.sin(rad2));
    tf.processFrame(mRe, mIm, rRe, rIm);

    // Average of +179 deg and -179 deg must be +/-180 deg (phaseReal ~ -1, phaseImag ~ 0)
    expect(tf.phaseReal[5]).toBeCloseTo(-1.0, 3);
    expect(Math.abs(tf.phaseImag[5])).toBeLessThan(1e-3);
  });

  it('computes theoretical coherence gamma^2 = 1 / (1 + 1/SNR) when uncorrelated noise is present', () => {
    const fft = new Radix2FFT(fftSize, 'hann');
    const tf = new TransferFunctionAnalyzer({
      fftSize,
      sampleRate,
      averagingType: 'fifo',
      fifoDepth: 64,
      coherenceDepth: 64,
      estimator: 'h1',
    });

    const randSig = createPrng(101);
    const randNoise = createPrng(99999);
    const binCount = fftSize / 2 + 1;
    const mRe = new Float32Array(binCount);
    const mIm = new Float32Array(binCount);
    const rRe = new Float32Array(binCount);
    const rIm = new Float32Array(binCount);

    // 0 dB SNR: equal signal power and uncorrelated noise power -> theoretical gamma^2 = 0.50
    const blockR = new Float32Array(fftSize);
    const blockM = new Float32Array(fftSize);

    for (let f = 0; f < 64; f++) {
      for (let i = 0; i < fftSize; i++) {
        const s = randSig() * 0.5;
        const n = randNoise() * 0.5;
        blockR[i] = s;
        blockM[i] = s + n;
      }
      fft.transformDualReal(blockM, blockR, mRe, mIm, rRe, rIm, true);
      tf.processFrame(mRe, mIm, rRe, rIm);
    }

    // Average coherence across midband bins should be very close to 0.50
    let sumCoh = 0;
    let sumH1Mag = 0;
    let count = 0;
    for (let k = 50; k < 1500; k++) {
      sumCoh += tf.coherence[k];
      sumH1Mag += tf.magnitude[k];
      count++;
    }
    const meanCoh = sumCoh / count;
    const meanH1Mag = sumH1Mag / count;

    expect(meanCoh).toBeGreaterThan(0.45);
    expect(meanCoh).toBeLessThan(0.55);

    // H1 magnitude should reject uncorrelated noise and converge close to 1.0 (0 dB), not sqrt(2) (+3 dB)!
    expect(meanH1Mag).toBeGreaterThan(0.95);
    expect(meanH1Mag).toBeLessThan(1.05);
  });

  it('handles dynamic fifoDepth and coherenceDepth changes cleanly and prevents running-sum drift', () => {
    const tf = new TransferFunctionAnalyzer({
      fftSize: 64,
      sampleRate: 48000,
      averagingType: 'fifo',
      fifoDepth: 16,
      coherenceDepth: 16,
      estimator: 'h1',
    });

    const B = tf.binCount;
    const mRe = new Float32Array(B).fill(2.0);
    const mIm = new Float32Array(B).fill(0.0);
    const rRe = new Float32Array(B).fill(1.0);
    const rIm = new Float32Array(B).fill(0.0);

    // Fill 15 frames with gain = 2.0
    for (let i = 0; i < 15; i++) {
      tf.processFrame(mRe, mIm, rRe, rIm);
    }
    expect(tf.magnitude[4]).toBeCloseTo(2.0, 4);

    // Shrink fifoDepth to 4 and coherenceDepth to 8, then feed gain = 0.5
    tf.updateConfig({ fifoDepth: 4, coherenceDepth: 8 });
    mRe.fill(0.5);

    // Run > 1024 frames to exercise periodic running-sum recomputation
    for (let i = 0; i < 1030; i++) {
      tf.processFrame(mRe, mIm, rRe, rIm);
    }

    expect(tf.magnitude[4]).toBeCloseTo(0.5, 5);
    expect(tf.coherence[4]).toBeCloseTo(1.0, 5);
  });
});

