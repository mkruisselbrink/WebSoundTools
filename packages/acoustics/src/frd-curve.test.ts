// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  interpolateCalibrationCurve,
  interpolateFrdCurveLogFreq,
  parseCalibrationFile,
  parseFrdCurveText,
  serializeFrdText,
} from './frd-curve.js';

describe('.FRD / .CAL Parser, Serializer & Log-Frequency Interpolator', () => {
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
    expect(curve.points[0]).toEqual({ frequencyHz: 20, gainDb: -1.5, phaseDeg: 45.0 });
    expect(curve.points[1]).toEqual({ frequencyHz: 100, gainDb: 0.0, phaseDeg: 0.0 });
    expect(curve.points[2]).toEqual({ frequencyHz: 1000, gainDb: 2.5, phaseDeg: -15.0 });
    expect(curve.points[3]).toEqual({ frequencyHz: 20000, gainDb: 4.0, phaseDeg: -90.0 });
  });

  it('interpolates linearly in log-frequency space and unwraps phase across +/-180 deg', () => {
    const curve = parseCalibrationFile(
      ['100 0.0 170.0', '1000 6.0 -170.0'].join('\n'),
      'WrapTest.cal'
    );

    const midFreq = Math.sqrt(100 * 1000);
    const freqs = new Float32Array([0, 50, 100, midFreq, 1000, 5000]);
    const { gainLinear, phaseRad } = interpolateCalibrationCurve(curve, freqs);

    expect(gainLinear[0]).toBeCloseTo(1.0, 5);
    expect(20 * Math.log10(gainLinear[1])).toBeCloseTo(0.0, 4);
    expect(20 * Math.log10(gainLinear[3])).toBeCloseTo(3.0, 3);
    // Shortest arc from +170 deg to -170 deg goes through +/-180 deg!
    expect(Math.abs(Math.cos(phaseRad[3]))).toBeCloseTo(1.0, 3);
    expect(20 * Math.log10(gainLinear[5])).toBeCloseTo(6.0, 3);
  });

  it('serializes and round-trips 3-column .frd curves losslessly', () => {
    const freqs = [50, 200, 1000, 8000];
    const mags = [94.2, 98.5, 100.0, 96.25];
    const phases = [45.0, 12.5, 0.0, -72.0];

    const text = serializeFrdText(freqs, mags, phases, 'Predicted FOH Mic Response');
    expect(text).toContain('* Predicted FOH Mic Response');

    const parsed = parseFrdCurveText(text);
    expect(Array.from(parsed.frequenciesHz)).toEqual(freqs);
    expect(parsed.magnitudeDb[2]).toBeCloseTo(100.0, 3);

    const mid = interpolateFrdCurveLogFreq(parsed, Math.sqrt(200 * 1000));
    expect(mid.magDb).toBeCloseTo((98.5 + 100.0) / 2, 2);
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
