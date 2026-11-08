import { describe, expect, it } from 'vitest';
import {
  interpolateCalibrationCurve,
  parseCalibrationFile,
} from '../../src/dsp/calibration.js';

describe('Microphone Calibration Parser & Interpolator', () => {
  it('parses 2-column and 3-column calibration files while ignoring comments and malformed lines', () => {
    const rawText = [
      '# ECM8000 Calibration File',
      '* Serial: 12345',
      '; Frequency (Hz)  Gain (dB)  Phase (deg)',
      '// Header comment',
      'Frequency Gain Phase',
      '',
      '1000\t2.5\t-15.0',
      '20, -1.5, 45.0',
      '100   0.0',
      'invalid line with numbers 123',
      '-50 3.0 0.0',
      '20000; 4.0; -90.0',
    ].join('\n');

    const curve = parseCalibrationFile(rawText, 'ECM8000.cal');
    expect(curve.name).toBe('ECM8000.cal');
    expect(curve.points.length).toBe(4);

    // Should be sorted by ascending frequency
    expect(curve.points[0]).toEqual({ frequencyHz: 20, gainDb: -1.5, phaseDeg: 45.0 });
    expect(curve.points[1]).toEqual({ frequencyHz: 100, gainDb: 0.0, phaseDeg: 0.0 });
    expect(curve.points[2]).toEqual({ frequencyHz: 1000, gainDb: 2.5, phaseDeg: -15.0 });
    expect(curve.points[3]).toEqual({ frequencyHz: 20000, gainDb: 4.0, phaseDeg: -90.0 });
  });

  it('interpolates linearly in log-frequency space and clamps outside bounds', () => {
    const curve = parseCalibrationFile(
      ['100 0.0 0.0', '1000 6.0 -30.0'].join('\n'),
      'LogTest.cal'
    );

    // Geometric midpoint between 100 Hz and 1000 Hz is sqrt(100 * 1000) = 316.227766 Hz
    const midFreq = Math.sqrt(100 * 1000);
    const freqs = new Float32Array([0, 50, 100, midFreq, 1000, 5000]);
    const { gainLinear, phaseRad } = interpolateCalibrationCurve(curve, freqs);

    // DC (0 Hz) -> unity gain, 0 rad
    expect(gainLinear[0]).toBeCloseTo(1.0, 5);
    expect(phaseRad[0]).toBeCloseTo(0.0, 5);

    // Below 100 Hz -> clamped to first point (0 dB, 0 deg)
    expect(20 * Math.log10(gainLinear[1])).toBeCloseTo(0.0, 4);
    expect(phaseRad[1]).toBeCloseTo(0.0, 4);

    // Geometric midpoint -> halfway in dB (+3.0 dB) and phase (-15 deg)
    expect(20 * Math.log10(gainLinear[3])).toBeCloseTo(3.0, 3);
    expect((phaseRad[3] * 180) / Math.PI).toBeCloseTo(-15.0, 3);

    // Above 1000 Hz -> clamped to last point (+6.0 dB, -30 deg)
    expect(20 * Math.log10(gainLinear[5])).toBeCloseTo(6.0, 3);
    expect((phaseRad[5] * 180) / Math.PI).toBeCloseTo(-30.0, 3);
  });

  it('returns unity gain and zero phase for an empty calibration curve', () => {
    const empty = parseCalibrationFile('# Empty file\n', 'Empty.cal');
    expect(empty.points.length).toBe(0);

    const freqs = new Float32Array([20, 1000, 20000]);
    const { gainLinear, phaseRad } = interpolateCalibrationCurve(empty, freqs);
    expect(Array.from(gainLinear)).toEqual([1, 1, 1]);
    expect(Array.from(phaseRad)).toEqual([0, 0, 0]);
  });
});

