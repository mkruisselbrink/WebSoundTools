// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATMOSPHERE,
  computeAirAbsorptionDbPerMeter,
  computeAirAbsorptionTable,
  computeSpeedOfSoundMpS,
  delayMsToMeters,
  frequencyToPeriodMs,
  frequencyToWavelengthM,
  metersToDelayMs,
} from './atmosphere.js';

describe('Atmosphere (ISO 9613-1 & Propagation Conversions)', () => {
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
    const a125 = computeAirAbsorptionDbPerMeter(125, DEFAULT_ATMOSPHERE);
    const a1k = computeAirAbsorptionDbPerMeter(1000, DEFAULT_ATMOSPHERE);
    const a4k = computeAirAbsorptionDbPerMeter(4000, DEFAULT_ATMOSPHERE);
    const a8k = computeAirAbsorptionDbPerMeter(8000, DEFAULT_ATMOSPHERE);

    expect(a125).toBeCloseTo(0.00041, 4);
    expect(a1k).toBeCloseTo(0.00466, 4);
    expect(a4k).toBeCloseTo(0.0297, 3);
    expect(a8k).toBeCloseTo(0.105, 2);

    const table = computeAirAbsorptionTable([125, 1000], DEFAULT_ATMOSPHERE);
    expect(table[0]).toBeCloseTo(a125, 6);
    expect(table[1]).toBeCloseTo(a1k, 6);
  });

  it('converts between wavelength, period, distance, and flight delay', () => {
    expect(frequencyToWavelengthM(1000, 343)).toBeCloseTo(0.343, 5);
    expect(frequencyToPeriodMs(250)).toBeCloseTo(4.0, 5);
    expect(delayMsToMeters(metersToDelayMs(12.5, 343.2), 343.2)).toBeCloseTo(12.5, 5);
  });
});
