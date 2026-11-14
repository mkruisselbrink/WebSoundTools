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

import { describe, expect, it } from 'vitest';
import { DeconvolutionAnalyzer } from '../../src/dsp/deconvolution.js';
import { SyntheticAcousticRig } from '../../src/dsp/synthetic-rig.js';

function createPrng(seed: number = 777): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2147483648.0 - 1.0;
  };
}

describe('DeconvolutionAnalyzer & Auto Delay Finder', () => {
  const sampleRate = 48000;
  const size = 4096;

  it('accurately finds positive and negative integer sample delays and polarity', () => {
    const deconv = new DeconvolutionAnalyzer(size, sampleRate, 'hann');
    const rand = createPrng(1234);

    // Create a continuous reference signal
    const totalLen = size * 3;
    const signal = new Float32Array(totalLen);
    for (let i = 0; i < totalLen; i++) {
      signal[i] = rand() * 0.8;
    }

    const testCases: Array<{ delay: number; polarity: 1 | -1 }> = [
      { delay: 0, polarity: 1 },
      { delay: 1, polarity: 1 },
      { delay: 48, polarity: 1 },   // +1.0 ms at 48 kHz
      { delay: 480, polarity: -1 }, // +10.0 ms, inverted polarity
      { delay: -120, polarity: 1 }, // -2.5 ms (Reference delayed relative to Measurement)
    ];

    const baseOffset = size;
    const blockR = signal.subarray(baseOffset, baseOffset + size);

    for (const tc of testCases) {
      deconv.reset();
      const blockM = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        blockM[i] = tc.polarity * signal[baseOffset + i - tc.delay];
      }

      const estimate = deconv.processTimeDomain(blockM, blockR, 0);
      expect(estimate.delaySamples).toBe(tc.delay);
      expect(estimate.subsampleDelaySamples).toBeCloseTo(tc.delay, 1);
      expect(estimate.delayMs).toBeCloseTo((1000 * tc.delay) / sampleRate, 2);
      expect(estimate.polarity).toBe(tc.polarity);
      expect(estimate.peakAmplitude).toBeGreaterThan(0.5);
    }
  });

  it('centers t = 0 ms at index size / 2 and computes step response', () => {
    const deconv = new DeconvolutionAnalyzer(1024, sampleRate, 'rectangular');
    const rand = createPrng(555);
    const blockR = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      blockR[i] = rand() * 0.5;
    }

    // Zero delay identical signal -> unit impulse at index 512 (t = 0 ms)
    deconv.processTimeDomain(blockR, blockR, 0);

    expect(deconv.timeMs[512]).toBe(0);
    expect(deconv.impulse[512]).toBeCloseTo(1.0, 2);
    // Step response after t = 0 ms should step from ~0 to ~1
    expect(deconv.stepResponse[200]).toBeCloseTo(0.0, 2);
    expect(deconv.stepResponse[800]).toBeCloseTo(1.0, 2);
  });

  it('simulates expected propagation delay in SyntheticAcousticRig presets', () => {
    const rig = new SyntheticAcousticRig(sampleRate, 'flat-delayed');
    const deconv = new DeconvolutionAnalyzer(4096, sampleRate, 'hann');

    const blockR = new Float32Array(4096);
    const blockM = new Float32Array(4096);

    const rand = createPrng(987654321);
    for (let f = 0; f < 3; f++) {
      for (let i = 0; i < 4096; i++) {
        blockR[i] = rand() * 0.5;
      }
      rig.processBlock(blockR, blockM);
    }

    const est = deconv.processTimeDomain(blockM, blockR, 0);
    expect(est.delaySamples).toBe(480);
    expect(est.delayMs).toBeCloseTo(10.0, 1);
  });
});

