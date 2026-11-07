import { describe, expect, it } from 'vitest';
import { evaluateBiquadCascadeResponse } from '../../src/dsp/biquad.js';
import {
  BroadbandMeterBank,
  createWeightingBiquadCoeffs,
} from '../../src/dsp/weighting-meters.js';

describe('IEC 61672-1 Weighting Filters & Broadband SPL / Leq Meters', () => {
  const sampleRate = 48000;

  it('matches IEC 61672-1 Class 1 nominal A-weighting and C-weighting attenuation values', () => {
    const aCoeffs = createWeightingBiquadCoeffs('A', sampleRate);
    const cCoeffs = createWeightingBiquadCoeffs('C', sampleRate);

    const evalDb = (coeffs: typeof aCoeffs, freq: number) =>
      20 * Math.log10(evaluateBiquadCascadeResponse(coeffs, freq, sampleRate).magnitude);

    // At 1000 Hz, both A and C weighting must be exactly 0.00 dB
    expect(evalDb(aCoeffs, 1000)).toBeCloseTo(0.0, 2);
    expect(evalDb(cCoeffs, 1000)).toBeCloseTo(0.0, 2);

    // IEC 61672-1 nominal A-weighting table:
    // 63 Hz: -26.2 dB, 125 Hz: -16.1 dB, 250 Hz: -8.6 dB, 500 Hz: -3.2 dB, 2000 Hz: +1.2 dB, 4000 Hz: +1.0 dB
    expect(evalDb(aCoeffs, 63)).toBeCloseTo(-26.2, 0);
    expect(evalDb(aCoeffs, 125)).toBeCloseTo(-16.1, 0);
    expect(evalDb(aCoeffs, 250)).toBeCloseTo(-8.6, 0);
    expect(evalDb(aCoeffs, 500)).toBeCloseTo(-3.2, 0);
    expect(evalDb(aCoeffs, 2000)).toBeCloseTo(1.2, 0);
    expect(evalDb(aCoeffs, 4000)).toBeCloseTo(1.0, 0);

    // IEC 61672-1 nominal C-weighting table:
    // 31.5 Hz: -3.0 dB, 63 Hz: -0.8 dB, 1000 Hz: 0.0 dB, 4000 Hz: -0.8 dB
    expect(evalDb(cCoeffs, 31.5)).toBeCloseTo(-3.0, 0);
    expect(evalDb(cCoeffs, 63)).toBeCloseTo(-0.8, 0);
    expect(evalDb(cCoeffs, 4000)).toBeCloseTo(-0.8, 0);
  });

  it('computes accurate Fast, Slow, Leq, and Peak levels for a 1 kHz full-scale sine wave', () => {
    const meters = new BroadbandMeterBank(sampleRate, 100.0); // 0 dBFS = 100 dB SPL

    // Feed 3 seconds of 1000 Hz sine wave with peak amplitude 1.0 (RMS = 1/sqrt(2) = -3.01 dBFS = 96.99 dB SPL)
    const blockSize = 4800;
    const blockM = new Float32Array(blockSize);
    const blockR = new Float32Array(blockSize);

    let phase = 0;
    const dPhase = (2 * Math.PI * 1000) / sampleRate;
    for (let b = 0; b < 30; b++) {
      for (let i = 0; i < blockSize; i++) {
        const s = Math.sin(phase);
        phase += dPhase;
        blockM[i] = s;
        blockR[i] = s * 0.5; // -6.02 dB relative to M
      }
      meters.processBlock(blockM, blockR);
    }

    const snap = meters.getSnapshot();
    const expectedRmsSpl = 100.0 - 3.0103; // 96.99 dB SPL
    const expectedPeakSpl = 100.0;         // 100.0 dB SPL

    // At 1 kHz, Z, A, and C weightings all have 0 dB attenuation
    expect(snap.levelsDb.Z.Fast).toBeCloseTo(expectedRmsSpl, 1);
    expect(snap.levelsDb.Z.Slow).toBeCloseTo(expectedRmsSpl, 0);
    expect(snap.levelsDb.Z.Leq).toBeCloseTo(expectedRmsSpl, 1);
    expect(snap.levelsDb.A.Fast).toBeCloseTo(expectedRmsSpl, 1);
    expect(snap.levelsDb.C.Fast).toBeCloseTo(expectedRmsSpl, 1);

    expect(snap.peaksDb.Z).toBeCloseTo(expectedPeakSpl, 1);
    expect(snap.referenceRmsDb).toBeCloseTo(-3.0103 - 6.0206, 1);
  });
});
