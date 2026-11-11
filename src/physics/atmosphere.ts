/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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

/**
 * ISO 9613-1:1993 atmospheric sound absorption, speed of sound, ISO 266 fractional-octave
 * frequency grids, and IEC 61672-1 A/C/Z frequency weighting curves (`src/physics/atmosphere.ts`).
 */

export interface AtmosphericConditions {
  /** Ambient air temperature in degrees Celsius (typical range -20 to +50). */
  readonly temperatureCelsius: number;
  /** Relative humidity in percent [0, 100]. */
  readonly relativeHumidityPercent: number;
  /** Ambient barometric pressure in kilopascals (standard sea level = 101.325 kPa). */
  readonly pressureKpa: number;
}

export type FrequencyWeighting = 'Z' | 'A' | 'C';

export const DEFAULT_ATMOSPHERE: AtmosphericConditions = {
  temperatureCelsius: 20,
  relativeHumidityPercent: 50,
  pressureKpa: 101.325,
};

const REF_PRESSURE_KPA = 101.325;
const REF_TEMP_KELVIN = 293.15; // 20 °C
const TRIPLE_POINT_KELVIN = 273.16; // 0.01 °C

/**
 * Standard 30 nominal 1/3-octave band center frequencies (25 Hz to 20 kHz, ISO 266).
 */
export const ISO_THIRD_OCTAVE_BANDS_HZ: readonly number[] = [
  25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200,
  250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/**
 * Standard 10 nominal 1/1-octave band center frequencies (31.5 Hz to 16 kHz, ISO 266).
 */
export const ISO_OCTAVE_BANDS_HZ: readonly number[] = [
  31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/**
 * Computes molar concentration of water vapor h (in percent) per ISO 9613-1 Annex B.
 */
export function computeWaterVaporMolarPercent(atmo: AtmosphericConditions): number {
  const tempK = Math.max(223.15, Math.min(343.15, atmo.temperatureCelsius + 273.15));
  const rh = Math.max(0, Math.min(100, atmo.relativeHumidityPercent));
  const pa = Math.max(50, Math.min(150, atmo.pressureKpa));

  const cSat = -6.8346 * Math.pow(TRIPLE_POINT_KELVIN / tempK, 1.261) + 4.6151;
  const pSatRatio = Math.pow(10, cSat); // p_sat / p_r
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

  // Oxygen relaxation frequency f_rO (Hz)
  const frO = pRatio * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));

  // Nitrogen relaxation frequency f_rN (Hz)
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

/**
 * Computes IEC 61672-1 A-weighting relative response in dB (normalized to 0.0 dB at 1000 Hz).
 */
export function computeAWeightingDb(frequencyHz: number): number {
  if (frequencyHz <= 0) return -120;
  const f2 = frequencyHz * frequencyHz;
  const c1 = 20.598997 * 20.598997;
  const c2 = 107.65265 * 107.65265;
  const c3 = 737.86223 * 737.86223;
  const c4 = 12194.217 * 12194.217;

  const num = c4 * f2 * f2;
  const den = (f2 + c1) * Math.sqrt((f2 + c2) * (f2 + c3)) * (f2 + c4);
  if (den <= 0 || num <= 0) return -120;
  return 20 * Math.log10(num / den) + 1.9997;
}

/**
 * Computes IEC 61672-1 C-weighting relative response in dB (normalized to 0.0 dB at 1000 Hz).
 */
export function computeCWeightingDb(frequencyHz: number): number {
  if (frequencyHz <= 0) return -120;
  const f2 = frequencyHz * frequencyHz;
  const c1 = 20.598997 * 20.598997;
  const c4 = 12194.217 * 12194.217;

  const num = c4 * f2;
  const den = (f2 + c1) * (f2 + c4);
  if (den <= 0 || num <= 0) return -120;
  return 20 * Math.log10(num / den) + 0.0619;
}

/**
 * Evaluates IEC 61672-1 frequency weighting (Z, A, or C) in dB.
 */
export function computeFrequencyWeightingDb(
  frequencyHz: number,
  weighting: FrequencyWeighting
): number {
  if (weighting === 'A') return computeAWeightingDb(frequencyHz);
  if (weighting === 'C') return computeCWeightingDb(frequencyHz);
  return 0;
}

/**
 * Generates logarithmically spaced frequency bins from `minHz` to `maxHz` (inclusive).
 */
export function createLogFrequencyGrid(
  binCount: number,
  minHz: number = 20,
  maxHz: number = 20000
): Float32Array {
  const count = Math.max(2, Math.floor(binCount));
  const out = new Float32Array(count);
  const logRatio = Math.log(maxHz / minHz);
  for (let i = 0; i < count; i++) {
    out[i] = minHz * Math.exp((i / (count - 1)) * logRatio);
  }
  return out;
}
