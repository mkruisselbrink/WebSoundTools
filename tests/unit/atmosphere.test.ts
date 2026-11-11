/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATMOSPHERE,
  computeAWeightingDb,
  computeAirAbsorptionDbPerMeter,
  computeCWeightingDb,
  computeSpeedOfSoundMpS,
  createLogFrequencyGrid,
} from '../../src/physics/atmosphere.js';

describe('atmosphere (ISO 9613-1 & IEC 61672)', () => {
  it('computes realistic speed of sound across temperature and humidity', () => {
    const c20 = computeSpeedOfSoundMpS(DEFAULT_ATMOSPHERE);
    expect(c20).toBeGreaterThan(343.0);
    expect(c20).toBeLessThan(345.0);

    const cCold = computeSpeedOfSoundMpS({
      temperatureCelsius: 0,
      relativeHumidityPercent: 50,
      pressureKpa: 101.325,
    });
    const cHot = computeSpeedOfSoundMpS({
      temperatureCelsius: 35,
      relativeHumidityPercent: 50,
      pressureKpa: 101.325,
    });
    expect(cCold).toBeCloseTo(331.5, 0);
    expect(cHot).toBeGreaterThan(351.5);
  });

  it('matches published ISO 9613-1 Table 1 air absorption values at 20 °C, 50% RH', () => {
    // Published ISO 9613-1 Table 1 @ 20 °C, 50% RH, 101.325 kPa (in dB/km -> /1000 for dB/m):
    //   125 Hz: ~0.41 dB/km (0.00041 dB/m)
    //   1000 Hz: ~4.66 dB/km (0.00466 dB/m)
    //   4000 Hz: ~29.7 dB/km (0.0297 dB/m)
    //   8000 Hz: ~105 dB/km  (0.105 dB/m)
    const a125 = computeAirAbsorptionDbPerMeter(125, DEFAULT_ATMOSPHERE);
    const a1k = computeAirAbsorptionDbPerMeter(1000, DEFAULT_ATMOSPHERE);
    const a4k = computeAirAbsorptionDbPerMeter(4000, DEFAULT_ATMOSPHERE);
    const a8k = computeAirAbsorptionDbPerMeter(8000, DEFAULT_ATMOSPHERE);

    expect(a125).toBeCloseTo(0.00041, 4);
    expect(a1k).toBeCloseTo(0.00466, 4);
    expect(a4k).toBeCloseTo(0.0297, 3);
    expect(a8k).toBeCloseTo(0.105, 2);
    expect(a8k).toBeGreaterThan(a4k);
    expect(a4k).toBeGreaterThan(a1k);
  });

  it('normalizes IEC 61672 A- and C-weighting to 0 dB at 1 kHz with standard LF rolloff', () => {
    expect(computeAWeightingDb(1000)).toBeCloseTo(0, 2);
    expect(computeCWeightingDb(1000)).toBeCloseTo(0, 2);

    // At 100 Hz: A-weighting is -19.1 dB, C-weighting is -0.3 dB
    expect(computeAWeightingDb(100)).toBeCloseTo(-19.1, 1);
    expect(computeCWeightingDb(100)).toBeCloseTo(-0.3, 1);
  });

  it('creates monotonically increasing logarithmic frequency grids', () => {
    const grid = createLogFrequencyGrid(121, 20, 20000);
    expect(grid.length).toBe(121);
    expect(grid[0]).toBeCloseTo(20, 4);
    expect(grid[60]).toBeCloseTo(Math.sqrt(20 * 20000), 1);
    expect(grid[120]).toBeCloseTo(20000, 2);
  });
});
