// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * ISO 9613-1:1993 atmospheric sound absorption, speed of sound, and wavelength/delay physics.
 */

export interface AtmosphericConditions {
  /** Ambient air temperature in degrees Celsius (typical range -20 to +50). */
  readonly temperatureCelsius: number;
  /** Relative humidity in percent [0, 100]. */
  readonly relativeHumidityPercent: number;
  /** Ambient barometric pressure in kilopascals (standard sea level = 101.325 kPa). */
  readonly pressureKpa: number;
}

export const DEFAULT_ATMOSPHERE: AtmosphericConditions = {
  temperatureCelsius: 20,
  relativeHumidityPercent: 50,
  pressureKpa: 101.325,
};

const REF_PRESSURE_KPA = 101.325;
const REF_TEMP_KELVIN = 293.15; // 20 °C
const TRIPLE_POINT_KELVIN = 273.16; // 0.01 °C

/**
 * Computes molar concentration of water vapor h (in percent) per ISO 9613-1 Annex B.
 */
export function computeWaterVaporMolarPercent(atmo: AtmosphericConditions): number {
  const tempK = Math.max(223.15, Math.min(343.15, atmo.temperatureCelsius + 273.15));
  const rh = Math.max(0, Math.min(100, atmo.relativeHumidityPercent));
  const pa = Math.max(50, Math.min(150, atmo.pressureKpa));

  const cSat = -6.8346 * Math.pow(TRIPLE_POINT_KELVIN / tempK, 1.261) + 4.6151;
  const pSatRatio = Math.pow(10, cSat);
  return rh * pSatRatio * (REF_PRESSURE_KPA / pa);
}

/**
 * Computes speed of sound c in m/s accounting for temperature and humidity.
 */
export function computeSpeedOfSoundMpS(atmo: AtmosphericConditions = DEFAULT_ATMOSPHERE): number {
  const tempK = Math.max(223.15, Math.min(343.15, atmo.temperatureCelsius + 273.15));
  const h = computeWaterVaporMolarPercent(atmo);
  return 343.2 * Math.sqrt(tempK / REF_TEMP_KELVIN) * (1 + 0.0016 * h);
}

/**
 * Computes the ISO 9613-1:1993 pure-tone atmospheric attenuation coefficient alpha(f) in dB/m.
 */
export function computeAirAbsorptionDbPerMeter(
  frequencyHz: number,
  atmo: AtmosphericConditions = DEFAULT_ATMOSPHERE
): number {
  if (frequencyHz <= 0) {
    return 0;
  }

  const tempK = Math.max(223.15, Math.min(343.15, atmo.temperatureCelsius + 273.15));
  const pa = Math.max(50, Math.min(150, atmo.pressureKpa));
  const pRatio = pa / REF_PRESSURE_KPA;
  const tRatio = tempK / REF_TEMP_KELVIN;
  const h = computeWaterVaporMolarPercent(atmo);

  const frO = pRatio * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN =
    pRatio *
    Math.pow(tRatio, -0.5) *
    (9 + 280 * h * Math.exp(-4.17 * (Math.pow(tRatio, -1 / 3) - 1)));

  const f2 = frequencyHz * frequencyHz;
  const classicalTerm = 1.84e-11 * (1 / pRatio) * Math.sqrt(tRatio);
  const relaxationO = (0.01275 * Math.exp(-2239.1 / tempK)) / (frO + f2 / frO);
  const relaxationN = (0.1068 * Math.exp(-3352.0 / tempK)) / (frN + f2 / frN);

  return 8.686 * f2 * (classicalTerm + Math.pow(tRatio, -2.5) * (relaxationO + relaxationN));
}

/**
 * Precomputes alpha(f) in dB/m for an array of frequencies.
 */
export function computeAirAbsorptionTable(
  frequenciesHz: ArrayLike<number>,
  atmo: AtmosphericConditions = DEFAULT_ATMOSPHERE
): Float32Array {
  const out = new Float32Array(frequenciesHz.length);
  for (let i = 0; i < frequenciesHz.length; i++) {
    out[i] = computeAirAbsorptionDbPerMeter(frequenciesHz[i], atmo);
  }
  return out;
}

/** Converts frequency in Hz to acoustic wavelength in meters (`c / f`). */
export function frequencyToWavelengthM(
  frequencyHz: number,
  speedOfSoundMpS: number = 343.2
): number {
  return frequencyHz > 0 ? speedOfSoundMpS / frequencyHz : 0;
}

/** Converts frequency in Hz to acoustic period in milliseconds (`1000 / f`). */
export function frequencyToPeriodMs(frequencyHz: number): number {
  return frequencyHz > 0 ? 1000 / frequencyHz : 0;
}

/** Converts distance in meters to propagation delay in milliseconds. */
export function metersToDelayMs(distanceM: number, speedOfSoundMpS: number = 343.2): number {
  return (distanceM / speedOfSoundMpS) * 1000;
}

/** Converts propagation delay in milliseconds to distance in meters. */
export function delayMsToMeters(delayMs: number, speedOfSoundMpS: number = 343.2): number {
  return (delayMs / 1000) * speedOfSoundMpS;
}
