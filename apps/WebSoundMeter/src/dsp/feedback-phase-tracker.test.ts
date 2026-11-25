// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { Radix2FFT } from '@foh/dsp';
import { describe, expect, it } from 'vitest';
import {
  SpectrumPhaseHistory,
  createTrackPitchStatsBuffer,
  evaluateTrackPitchStability,
  pushTrackPitchSample,
  wrapPhaseRad,
} from './feedback-phase-tracker.js';

describe('SpectrumPhaseHistory & Phase-Vocoder Pitch Stability', () => {
  it('wraps arbitrary angles cleanly into [-pi, pi]', () => {
    expect(wrapPhaseRad(0)).toBeCloseTo(0, 6);
    expect(wrapPhaseRad(2 * Math.PI + 0.3)).toBeCloseTo(0.3, 6);
    expect(wrapPhaseRad(-2 * Math.PI - 0.4)).toBeCloseTo(-0.4, 6);
  });

  it('tracks sub-bin instantaneous frequency with < 1 cent jitter on a pure sinusoid and flags vocal vibrato', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const hopSamples = 1920; // 40 ms hop
    const fft = new Radix2FFT(fftSize, 'hann');
    const B = (fftSize >>> 1) + 1;
    const df = sampleRate / fftSize;

    const buf = new Float32Array(fftSize);
    const dummy = new Float32Array(fftSize);
    const re = new Float32Array(B);
    const im = new Float32Array(B);
    const dRe = new Float32Array(B);
    const dIm = new Float32Array(B);

    // 1. Pure non-bin-centered feedback tone at 2483.7 Hz
    const targetHz = 2483.7;
    const phaseHistory = new SpectrumPhaseHistory();
    const stats = createTrackPitchStatsBuffer(targetHz);

    for (let frame = 0; frame < 8; frame++) {
      const sampleOffset = frame * hopSamples;
      for (let n = 0; n < fftSize; n++) {
        buf[n] = 0.25 * Math.sin((2 * Math.PI * targetHz * (sampleOffset + n)) / sampleRate);
      }
      fft.transformDualReal(buf, dummy, re, im, dRe, dIm, true);
      const centerBin = Math.round(targetHz / df);
      const alpha = Math.log(Math.max(1e-12, Math.hypot(re[centerBin - 1], im[centerBin - 1])));
      const beta = Math.log(Math.max(1e-12, Math.hypot(re[centerBin], im[centerBin])));
      const gamma = Math.log(Math.max(1e-12, Math.hypot(re[centerBin + 1], im[centerBin + 1])));
      const delta = (0.5 * (alpha - gamma)) / (alpha - 2 * beta + gamma);

      const est = phaseHistory.refinePeak({
        binIndex: centerBin,
        parabolicDelta: delta,
        curRe: re,
        curIm: im,
        fftSize,
        sampleRate,
        hopSamples,
      });
      if (frame > 0) {
        expect(est.hasPhaseLockSample).toBe(true);
        expect(est.refinedFreqHz).toBeCloseTo(targetHz, 0);
        expect(est.phaseStepCos).toBeGreaterThan(0.95);
        pushTrackPitchSample(stats, est.refinedFreqHz, est.phaseStepCos, true);
      }
      phaseHistory.commitSpectrum(re, im, fftSize, sampleRate);
    }

    const pureStability = evaluateTrackPitchStability(stats);
    expect(pureStability.pitchStdCents).toBeLessThan(1.0);
    expect(pureStability.phaseCoherence).toBeGreaterThan(0.95);

    // 2. Vocal vibrato (+/- 30 cents at 5.5 Hz around 880 Hz)
    const vibHistory = new SpectrumPhaseHistory();
    const vibStats = createTrackPitchStatsBuffer(880);
    let instPhase = 0;
    const totalSamples = fftSize + 8 * hopSamples;
    const vibSignal = new Float32Array(totalSamples);
    for (let n = 0; n < totalSamples; n++) {
      const t = n / sampleRate;
      const centsMod = 32 * Math.sin(2 * Math.PI * 5.5 * t);
      const fInst = 880 * Math.pow(2, centsMod / 1200);
      instPhase += (2 * Math.PI * fInst) / sampleRate;
      vibSignal[n] = 0.25 * Math.sin(instPhase);
    }

    for (let frame = 0; frame < 8; frame++) {
      const offset = frame * hopSamples;
      buf.set(vibSignal.subarray(offset, offset + fftSize));
      fft.transformDualReal(buf, dummy, re, im, dRe, dIm, true);

      let peakBin = 1;
      let peakMag = 0;
      for (let k = 60; k < 90; k++) {
        const m = Math.hypot(re[k], im[k]);
        if (m > peakMag) {
          peakMag = m;
          peakBin = k;
        }
      }
      const alpha = Math.log(Math.max(1e-12, Math.hypot(re[peakBin - 1], im[peakBin - 1])));
      const beta = Math.log(Math.max(1e-12, peakMag));
      const gamma = Math.log(Math.max(1e-12, Math.hypot(re[peakBin + 1], im[peakBin + 1])));
      const delta = (0.5 * (alpha - gamma)) / (alpha - 2 * beta + gamma);

      const est = vibHistory.refinePeak({
        binIndex: peakBin,
        parabolicDelta: delta,
        curRe: re,
        curIm: im,
        fftSize,
        sampleRate,
        hopSamples,
      });
      if (frame > 0) {
        pushTrackPitchSample(vibStats, est.refinedFreqHz, est.phaseStepCos, est.hasPhaseLockSample);
      }
      vibHistory.commitSpectrum(re, im, fftSize, sampleRate);
    }

    const vibStability = evaluateTrackPitchStability(vibStats);
    expect(vibStability.pitchStdCents).toBeGreaterThan(12.0);
  });
});
