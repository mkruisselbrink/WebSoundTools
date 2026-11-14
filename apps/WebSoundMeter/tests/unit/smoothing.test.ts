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
import {
  interpolateCalibrationCurve,
  parseCalibrationFile,
} from '../../src/dsp/calibration.js';
import {
  aggregateFractionalOctaveBands,
  smoothMagnitudeOctave,
  smoothPhaseOctave,
} from '../../src/dsp/smoothing.js';
import { DeconvolutionAnalyzer } from '../../src/dsp/deconvolution.js';
import { SyntheticAcousticRig } from '../../src/dsp/synthetic-rig.js';

describe('Fractional-Octave Smoothing, Calibration & SyntheticAcousticRig', () => {
  it('smooths a sharp narrowband spike while preserving a flat spectrum', () => {
    const N = 1024;
    const flat = new Float32Array(N).fill(2.5);
    const outFlat = new Float32Array(N);
    smoothMagnitudeOctave(flat, outFlat, 6); // 1/6 octave

    for (let i = 10; i < N - 10; i++) {
      expect(outFlat[i]).toBeCloseTo(2.5, 4);
    }

    // Spike at bin 200
    const spike = new Float32Array(N).fill(1.0);
    spike[200] = 10.0;
    const outSpike = new Float32Array(N);
    smoothMagnitudeOctave(spike, outSpike, 3); // 1/3 octave

    expect(outSpike[200]).toBeGreaterThan(1.0);
    expect(outSpike[200]).toBeLessThan(10.0);
    // Neighboring bin 201 should also be elevated by smoothing
    expect(outSpike[201]).toBeGreaterThan(1.2);
  });

  it('smooths phase vectors across +/-180 deg wrap without discontinuities', () => {
    const N = 256;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const angle = i % 2 === 0 ? (178 * Math.PI) / 180 : (-178 * Math.PI) / 180;
      re[i] = Math.cos(angle);
      im[i] = Math.sin(angle);
    }
    const outRe = new Float32Array(N);
    const outIm = new Float32Array(N);
    smoothPhaseOctave(re, im, outRe, outIm, 6);

    expect(outRe[100]).toBeCloseTo(-1.0, 2);
    expect(Math.abs(outIm[100])).toBeLessThan(0.05);
  });

  it('aggregates 1/3 octave RTA bands between 20 Hz and 20 kHz', () => {
    const N = 2049;
    const freqs = new Float32Array(N);
    const mod = new Float32Array(N).fill(0.5);
    const peakSq = new Float32Array(N).fill(1.0);
    for (let i = 0; i < N; i++) {
      freqs[i] = (i * 24000) / (N - 1);
    }

    const bands = aggregateFractionalOctaveBands(freqs, mod, peakSq, 3);
    expect(bands.centerFrequencies.length).toBeGreaterThanOrEqual(28);
    expect(bands.centerFrequencies).toContain(1000);
    expect(bands.magnitudes[15]).toBeCloseTo(0.5, 3);
    expect(bands.peaks[15]).toBeCloseTo(1.0, 3);
  });

  it('parses 2-column and 3-column calibration files and interpolates in log-frequency space', () => {
    const calText = `
      # Example Mic Calibration File
      20.0\t-3.0\t45.0
      200.0\t0.0\t0.0
      2000.0\t6.0\t-90.0
    `;
    const curve = parseCalibrationFile(calText, 'TestMic.cal');
    expect(curve.points.length).toBe(3);

    // Geometric midpoint between 200 Hz and 2000 Hz is sqrt(200 * 2000) = 632.4555 Hz -> +3.0 dB, -45 deg
    const freqs = new Float32Array([20, 632.45553, 2000]);
    const interp = interpolateCalibrationCurve(curve, freqs);

    expect(20 * Math.log10(interp.gainLinear[0])).toBeCloseTo(-3.0, 3);
    expect(20 * Math.log10(interp.gainLinear[1])).toBeCloseTo(3.0, 2);
    expect(20 * Math.log10(interp.gainLinear[2])).toBeCloseTo(6.0, 3);
    expect((interp.phaseRad[1] * 180) / Math.PI).toBeCloseTo(-45.0, 1);
  });

  it('simulates expected propagation delay in SyntheticAcousticRig presets', () => {
    const sr = 48000;
    const rig = new SyntheticAcousticRig(sr, 'flat-delayed'); // 10.0 ms = 480 samples
    const deconv = new DeconvolutionAnalyzer(4096, sr, 'hann');

    const blockR = new Float32Array(4096);
    const blockM = new Float32Array(4096);

    let seed = 987654321;
    for (let f = 0; f < 3; f++) {
      for (let i = 0; i < 4096; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        blockR[i] = ((seed >>> 0) / 2147483648.0 - 1.0) * 0.5;
      }
      rig.processBlock(blockR, blockM);
    }

    const est = deconv.processTimeDomain(blockM, blockR, 0);
    expect(est.delaySamples).toBe(480);
    expect(est.delayMs).toBeCloseTo(10.0, 1);
  });
});

