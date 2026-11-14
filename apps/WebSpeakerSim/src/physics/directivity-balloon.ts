// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * 3D spherical loudspeaker directivity balloon representation, fast bilinear/log-frequency
 * complex interpolation, and analytical piston + horn synthesis (`src/physics/directivity-balloon.ts`).
 */

import { ISO_THIRD_OCTAVE_BANDS_HZ } from '@foh/acoustics';
import {
  DSP_REFERENCE_SAMPLE_RATE_HZ,
  designCrossoverSections,
  evaluateBiquadCascade,
  type ComplexSample,
} from '@foh/dsp';
import { DEG_TO_RAD } from './transform3d.js';

export type BalloonSymmetry = 'axial' | 'quadrant' | 'none';

export interface DirectivityBalloon {
  /** Monotonically increasing frequency centers in Hz [F]. */
  readonly frequenciesHz: Float32Array;
  /** Symmetry class governing meridian angle folding. */
  readonly symmetry: BalloonSymmetry;
  /** Uniform or monotonic polar angles beta in [0, 180] degrees [P]. */
  readonly polarAnglesDeg: Float32Array;
  /**
   * Monotonic meridian roll angles gamma in degrees [M]:
   *   - 'axial': [0] (M = 1)
   *   - 'quadrant': [0 .. 90] (0 = horizontal, 90 = vertical)
   *   - 'none': [0 .. 360 - step] with periodic wrap at 360 deg (0 = +y_L left, 90 = +z_L top, 180 = -y_L right, 270 = -z_L bottom)
   */
  readonly meridianAnglesDeg: Float32Array;
  /** Relative on-axis magnitude response in dB [F] (0 dB nominal passband). */
  readonly onAxisMagDb: Float32Array;
  /** On-axis minimum/excess phase response in radians [F]. */
  readonly onAxisPhaseRad: Float32Array;
  /**
   * Off-axis directional level offset (typically <= 0 dB) relative to on-axis,
   * laid out contiguously as ((fIdx * M + mIdx) * P + pIdx).
   */
  readonly attenuationDb: Float32Array;
  /** Optional off-axis excess phase in radians [F * M * P]. */
  readonly offAxisPhaseRad?: Float32Array;
}

export interface ParametricBalloonConfig {
  readonly category: 'point-source' | 'subwoofer';
  /** Nominal horizontal -6 dB beamwidth in degrees (e.g. 90). */
  readonly horizontalDispersionDeg: number;
  /** Nominal vertical -6 dB beamwidth in degrees (e.g. 60). */
  readonly verticalDispersionDeg: number;
  /** Optional asymmetric vertical horn angles (+upDeg, -downDeg); overrides symmetric verticalDispersionDeg when set. */
  readonly asymmetricVerticalDeg?: { readonly upDeg: number; readonly downDeg: number };
  /** Effective cabinet width in meters (governs LF baffle diffraction transition). */
  readonly cabinetWidthM: number;
  /** Effective cabinet height in meters. */
  readonly cabinetHeightM: number;
  /** Lower -3 dB cutoff frequency in Hz. */
  readonly lowCutHz: number;
  /** Upper -3 dB rolloff frequency in Hz. */
  readonly highCutHz: number;
  /** Intrinsic enclosure radiation pattern at low frequencies ('omni' | 'cardioid'). */
  readonly lfPattern?: 'omni' | 'cardioid';
  /** Horn pattern control transition frequency in Hz (default auto-derived from horn aperture). */
  readonly hornControlHz?: number;
  /** Frequency grid (defaults to 30 ISO 1/3-octave bands 25 Hz .. 20 kHz). */
  readonly frequenciesHz?: ArrayLike<number>;
}

export interface BalloonSampleResult {
  readonly magnitudeDb: number;
  readonly phaseRad: number;
  readonly linearComplex: ComplexSample;
}

/** First-order Bessel function J_1(x) polynomial approximation (Abramowitz & Stegun 9.4.4 / 9.4.6). */
export function besselJ1(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-8) {
    return 0.5 * x;
  }
  if (ax < 3.0) {
    const y = (x / 3.0) * (x / 3.0);
    const poly =
      0.5 +
      y *
        (-0.56249985 +
          y *
            (0.21093573 +
              y * (-0.03954289 + y * (0.00443319 + y * (-0.00031761 + y * 0.00001109)))));
    return x * poly;
  }
  const z = 3.0 / ax;
  const f1 =
    0.79788456 +
    z *
      (0.00000156 +
        z *
          (0.01659667 +
            z * (0.00017105 + z * (-0.00249511 + z * (0.00113653 - z * 0.00020033)))));
  const theta1 =
    ax -
    2.35619449 +
    z *
      (0.12499612 +
        z *
          (0.0000565 +
            z * (-0.00637879 + z * (0.00074348 + z * (0.00079824 - z * 0.00029166)))));
  const val = (f1 / Math.sqrt(ax)) * Math.cos(theta1);
  return x < 0 ? -val : val;
}

/** Airy piston directivity factor |2 * J_1(u) / u| clamped cleanly away from zero nulls. */
function circularPistonDirectivityDb(kaSinBeta: number, maxAttenuationDb: number = -28): number {
  if (Math.abs(kaSinBeta) < 1e-5) {
    return 0;
  }
  const jinc = Math.abs((2 * besselJ1(kaSinBeta)) / kaSinBeta);
  const db = 20 * Math.log10(Math.max(1e-4, jinc));
  // Smooth deep sharp Bessel nulls slightly to reflect real finite-baffle loudspeaker drivers
  return Math.max(maxAttenuationDb, db);
}

function foldMeridianDeg(meridianDeg: number, symmetry: BalloonSymmetry): number {
  if (symmetry === 'axial') {
    return 0;
  }
  let g = meridianDeg % 360;
  if (g < 0) g += 360;

  if (symmetry === 'quadrant') {
    if (g <= 90) return g;
    if (g <= 180) return 180 - g;
    if (g <= 270) return g - 180;
    return 360 - g;
  }
  return g;
}

function findBoundingIndices(
  grid: Float32Array,
  value: number
): { i0: number; i1: number; t: number } {
  const n = grid.length;
  if (n <= 1 || value <= grid[0]) {
    return { i0: 0, i1: 0, t: 0 };
  }
  if (value >= grid[n - 1]) {
    return { i0: n - 1, i1: n - 1, t: 0 };
  }

  // Binary search
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (grid[mid] <= value) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = grid[hi] - grid[lo];
  const t = span > 1e-9 ? (value - grid[lo]) / span : 0;
  return { i0: lo, i1: hi, t };
}

function findLogFrequencyIndices(
  freqs: Float32Array,
  frequencyHz: number
): { f0: number; f1: number; tf: number } {
  const n = freqs.length;
  if (n <= 1 || frequencyHz <= freqs[0]) {
    return { f0: 0, f1: 0, tf: 0 };
  }
  if (frequencyHz >= freqs[n - 1]) {
    return { f0: n - 1, f1: n - 1, tf: 0 };
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (freqs[mid] <= frequencyHz) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const logSpan = Math.log(freqs[hi] / freqs[lo]);
  const tf = logSpan > 1e-9 ? Math.log(frequencyHz / freqs[lo]) / logSpan : 0;
  return { f0: lo, f1: hi, tf };
}

function sampleSingleBandAttenuation(
  balloon: DirectivityBalloon,
  fIdx: number,
  m0: number,
  m1: number,
  tm: number,
  p0: number,
  p1: number,
  tp: number
): { attDb: number; offPhaseRad: number } {
  const M = balloon.meridianAnglesDeg.length;
  const P = balloon.polarAnglesDeg.length;
  const base = fIdx * M * P;
  const att = balloon.attenuationDb;

  const v00 = att[base + m0 * P + p0];
  const v01 = att[base + m0 * P + p1];
  const v10 = att[base + m1 * P + p0];
  const v11 = att[base + m1 * P + p1];

  const a0 = v00 + (v01 - v00) * tp;
  const a1 = v10 + (v11 - v10) * tp;
  const attDb = a0 + (a1 - a0) * tm;

  let offPhaseRad = 0;
  if (balloon.offAxisPhaseRad) {
    const ph = balloon.offAxisPhaseRad;
    // Unit-phasor interpolation avoids +/-pi wrap artifacts
    const ph00 = ph[base + m0 * P + p0];
    const ph01 = ph[base + m0 * P + p1];
    const ph10 = ph[base + m1 * P + p0];
    const ph11 = ph[base + m1 * P + p1];
    const w00 = (1 - tm) * (1 - tp);
    const w01 = (1 - tm) * tp;
    const w10 = tm * (1 - tp);
    const w11 = tm * tp;
    const re =
      w00 * Math.cos(ph00) + w01 * Math.cos(ph01) + w10 * Math.cos(ph10) + w11 * Math.cos(ph11);
    const im =
      w00 * Math.sin(ph00) + w01 * Math.sin(ph01) + w10 * Math.sin(ph10) + w11 * Math.sin(ph11);
    offPhaseRad = Math.atan2(im, re);
  }

  return { attDb, offPhaseRad };
}

/**
 * Interpolates complex directional response D(polar, meridian, f) from a 3D `DirectivityBalloon`.
 */
export function sampleDirectivityBalloon(
  balloon: DirectivityBalloon,
  polarDeg: number,
  meridianDeg: number,
  frequencyHz: number
): BalloonSampleResult {
  const clampedPolar = Math.max(0, Math.min(180, polarDeg));
  const foldedMeridian = foldMeridianDeg(meridianDeg, balloon.symmetry);

  const { i0: p0, i1: p1, t: tp } = findBoundingIndices(balloon.polarAnglesDeg, clampedPolar);

  let m0 = 0;
  let m1 = 0;
  let tm = 0;
  const mGrid = balloon.meridianAnglesDeg;
  const M = mGrid.length;

  if (M > 1) {
    if (balloon.symmetry === 'none' && foldedMeridian > mGrid[M - 1]) {
      // Periodic wrap between last meridian (e.g. 350 deg) and 360 deg === 0 deg
      m0 = M - 1;
      m1 = 0;
      const span = 360 - mGrid[M - 1] + mGrid[0];
      tm = span > 1e-9 ? (foldedMeridian - mGrid[M - 1]) / span : 0;
    } else {
      const mBounds = findBoundingIndices(mGrid, foldedMeridian);
      m0 = mBounds.i0;
      m1 = mBounds.i1;
      tm = mBounds.t;
    }
  }

  const { f0, f1, tf } = findLogFrequencyIndices(balloon.frequenciesHz, frequencyHz);

  const s0 = sampleSingleBandAttenuation(balloon, fIdxOrZero(f0), m0, m1, tm, p0, p1, tp);
  const onMag0 = balloon.onAxisMagDb[f0];
  const onPh0 = balloon.onAxisPhaseRad[f0];

  if (f0 === f1 || tf <= 1e-7) {
    const magnitudeDb = onMag0 + s0.attDb;
    const phaseRad = onPh0 + s0.offPhaseRad;
    const lin = Math.pow(10, magnitudeDb / 20);
    return {
      magnitudeDb,
      phaseRad,
      linearComplex: { re: lin * Math.cos(phaseRad), im: lin * Math.sin(phaseRad) },
    };
  }

  const s1 = sampleSingleBandAttenuation(balloon, f1, m0, m1, tm, p0, p1, tp);
  const onMag1 = balloon.onAxisMagDb[f1];
  const onPh1 = balloon.onAxisPhaseRad[f1];

  const mag0 = onMag0 + s0.attDb;
  const mag1 = onMag1 + s1.attDb;
  const magnitudeDb = mag0 + (mag1 - mag0) * tf;

  const ph0 = onPh0 + s0.offPhaseRad;
  const ph1 = onPh1 + s1.offPhaseRad;
  //Shortest-arc phase interpolation across adjacent frequency bins
  let dPh = ph1 - ph0;
  while (dPh > Math.PI) dPh -= 2 * Math.PI;
  while (dPh < -Math.PI) dPh += 2 * Math.PI;
  const phaseRad = ph0 + dPh * tf;

  const lin = Math.pow(10, magnitudeDb / 20);
  return {
    magnitudeDb,
    phaseRad,
    linearComplex: { re: lin * Math.cos(phaseRad), im: lin * Math.sin(phaseRad) },
  };
}

function fIdxOrZero(idx: number): number {
  return idx >= 0 ? idx : 0;
}

/**
 * Synthesizes a physically grounded 3D `DirectivityBalloon` from cabinet dimensions,
 * nominal HxV horn dispersion, LF pattern, and passband cutoffs (including minimum-phase rotation).
 */
export function synthesizeParametricBalloon(config: ParametricBalloonConfig): DirectivityBalloon {
  const freqSource = config.frequenciesHz ?? ISO_THIRD_OCTAVE_BANDS_HZ;
  const F = freqSource.length;
  const frequenciesHz = new Float32Array(F);
  for (let i = 0; i < F; i++) {
    frequenciesHz[i] = freqSource[i];
  }

  const isSub = config.category === 'subwoofer';
  const hasAsymV = Boolean(config.asymmetricVerticalDeg);

  let symmetry: BalloonSymmetry = 'quadrant';
  if (isSub && (config.lfPattern ?? 'omni') === 'omni') {
    symmetry = 'axial';
  } else if (isSub && config.lfPattern === 'cardioid') {
    symmetry = 'axial';
  } else if (hasAsymV) {
    symmetry = 'none';
  }

  // 5-degree polar resolution (0..180 -> 37 points)
  const P = 37;
  const polarAnglesDeg = new Float32Array(P);
  for (let p = 0; p < P; p++) {
    polarAnglesDeg[p] = p * 5;
  }

  let meridianAnglesDeg: Float32Array;
  if (symmetry === 'axial') {
    meridianAnglesDeg = new Float32Array([0]);
  } else if (symmetry === 'quadrant') {
    // 10-degree meridian step in [0..90] -> 10 planes
    meridianAnglesDeg = new Float32Array(10);
    for (let m = 0; m < 10; m++) meridianAnglesDeg[m] = m * 10;
  } else {
    // 10-degree meridian step in [0..350] -> 36 planes
    meridianAnglesDeg = new Float32Array(36);
    for (let m = 0; m < 36; m++) meridianAnglesDeg[m] = m * 10;
  }
  const M = meridianAnglesDeg.length;

  // On-axis magnitude & minimum-phase passband via 4th-order Butterworth HPF + 2nd/4th-order LPF
  const hpSections = designCrossoverSections(
    'highpass',
    { topology: 'butterworth-24', frequencyHz: Math.max(15, config.lowCutHz) },
    DSP_REFERENCE_SAMPLE_RATE_HZ
  );
  const lpTopology = isSub ? 'butterworth-24' : 'butterworth-12';
  const lpSections =
    config.highCutHz < 22000
      ? designCrossoverSections(
          'lowpass',
          { topology: lpTopology, frequencyHz: config.highCutHz },
          DSP_REFERENCE_SAMPLE_RATE_HZ
        )
      : [];
  const passbandSections = [...hpSections, ...lpSections];

  const onAxisMagDb = new Float32Array(F);
  const onAxisPhaseRad = new Float32Array(F);
  for (let f = 0; f < F; f++) {
    const h = evaluateBiquadCascade(passbandSections, frequenciesHz[f], DSP_REFERENCE_SAMPLE_RATE_HZ);
    const mag = Math.max(1e-6, Math.hypot(h.re, h.im));
    onAxisMagDb[f] = 20 * Math.log10(mag);
    onAxisPhaseRad[f] = Math.atan2(h.im, h.re);
  }

  const attenuationDb = new Float32Array(F * M * P);
  const c = 343.2;
  const effRadiusH = Math.max(0.08, config.cabinetWidthM * 0.42);
  const effRadiusV = Math.max(0.08, config.cabinetHeightM * 0.42);
  const fBaffle = c / (Math.PI * Math.max(config.cabinetWidthM, config.cabinetHeightM));
  const fHorn =
    config.hornControlHz ??
    Math.max(550, Math.min(1800, c / Math.max(0.18, config.cabinetWidthM * 0.85)));

  const halfH = Math.max(10, config.horizontalDispersionDeg * 0.5);
  const halfVUp = config.asymmetricVerticalDeg
    ? Math.max(5, Math.abs(config.asymmetricVerticalDeg.upDeg))
    : Math.max(10, config.verticalDispersionDeg * 0.5);
  const halfVDown = config.asymmetricVerticalDeg
    ? Math.max(5, Math.abs(config.asymmetricVerticalDeg.downDeg))
    : Math.max(10, config.verticalDispersionDeg * 0.5);

  for (let f = 0; f < F; f++) {
    const freq = frequenciesHz[f];
    const k = (2 * Math.PI * freq) / c;

    // Blend weights across LF baffle -> Mid piston -> HF constant-directivity horn
    const hornBlend = isSub
      ? 0
      : clamp01(Math.log(freq / (fHorn * 0.65)) / Math.log(2.4));
    const baffleShadowBlend = clamp01(Math.log(freq / (fBaffle * 0.5)) / Math.log(4.0));

    for (let m = 0; m < M; m++) {
      const gammaRad = meridianAnglesDeg[m] * DEG_TO_RAD;
      const cosGamma = Math.cos(gammaRad); // Horizontal weight (+y_L / -y_L)
      const sinGamma = Math.sin(gammaRad); // Vertical weight (+z_L up / -z_L down)

      for (let p = 0; p < P; p++) {
        const betaDeg = polarAnglesDeg[p];
        const betaRad = betaDeg * DEG_TO_RAD;
        const idx = (f * M + m) * P + p;

        if (betaDeg === 0) {
          attenuationDb[idx] = 0;
          continue;
        }

        if (isSub) {
          // Omnidirectional bass-reflex or intrinsic cardioid enclosure
          const pistonLoss = circularPistonDirectivityDb(
            k * effRadiusH * Math.sin(betaRad) * 0.65,
            -10
          );
          if (config.lfPattern === 'cardioid') {
            // Subcardioid/cardioid gradient: 0.55 + 0.45 * cos(beta) -> ~20 dB rear null
            const cardioidGain = Math.max(0.08, 0.54 + 0.46 * Math.cos(betaRad));
            attenuationDb[idx] = 20 * Math.log10(cardioidGain) + pistonLoss * 0.3;
          } else {
            // Mild cabinet self-shadowing above 100 Hz
            const rearShadow = -1.5 * baffleShadowBlend * (0.5 * (1 - Math.cos(betaRad)));
            attenuationDb[idx] = pistonLoss * 0.5 + rearShadow;
          }
          continue;
        }

        // Point-source 2-way enclosure:
        // 1. Mid-bass elliptical piston + rear cabinet diffraction loss
        const effA = Math.hypot(effRadiusH * cosGamma, effRadiusV * sinGamma);
        const kaSin = k * effA * Math.sin(Math.min(Math.PI * 0.5, betaRad));
        const pistonDb = circularPistonDirectivityDb(kaSin, -18);
        const rearFactor = betaDeg > 90 ? (betaDeg - 90) / 90 : 0;
        const midBaffleDb =
          baffleShadowBlend * (pistonDb - 8.0 * rearFactor * rearFactor);

        // 2. Constant-directivity horn beamwidth law calibrated to exact -6.0 dB at half-beamwidth
        const halfV = sinGamma >= 0 ? halfVUp : halfVDown;
        // Effective half-angle in meridian plane gamma: elliptical beamwidth 1 / sqrt((cos/hH)^2 + (sin/hV)^2)
        const invBeamSq =
          (cosGamma * cosGamma) / (halfH * halfH) + (sinGamma * sinGamma) / (halfV * halfV);
        const halfBeamAtMeridian = 1 / Math.sqrt(Math.max(1e-6, invBeamSq));
        const normAngle = betaDeg / halfBeamAtMeridian;
        // Smooth super-quadratic rolloff: exactly -6 dB at normAngle = 1, clamped gracefully in rear hemisphere
        const rawHornDb = -6.0 * Math.pow(normAngle, 1.85);
        const hornMaxRearLoss = -22 - 4 * Math.min(1, freq / 8000);
        const hornDb = Math.max(hornMaxRearLoss, rawHornDb);

        attenuationDb[idx] = (1 - hornBlend) * midBaffleDb + hornBlend * hornDb;
      }
    }
  }

  return {
    frequenciesHz,
    symmetry,
    polarAnglesDeg,
    meridianAnglesDeg,
    onAxisMagDb,
    onAxisPhaseRad,
    attenuationDb,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

