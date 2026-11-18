// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `.FRD` / `.CAL` / `.TXT` / `.CSV` Frequency Response & Microphone Calibration
 * Parser, Serializer, and Phase-Unwrap-Aware Log-Frequency Interpolator.
 *
 * Powers Predict-to-Measure `.FRD` exchange between WebSpeakerSim and WebSoundMeter.
 */

export interface CalibrationPoint {
  readonly frequencyHz: number;
  readonly gainDb: number;
  readonly phaseDeg: number;
}

export interface CalibrationCurve {
  readonly name: string;
  readonly points: readonly CalibrationPoint[];
}

export interface FrdCurve {
  readonly frequenciesHz: Float32Array;
  readonly magnitudeDb: Float32Array;
  readonly phaseRad: Float32Array;
}

const DEG_TO_RAD = Math.PI / 180.0;

/**
 * Parses a standard 2-column (Freq, dB) or 3-column (Freq, dB, PhaseDeg)
 * tab/comma/semicolon/space-separated `.cal` / `.frd` / `.txt` / `.csv` text file.
 */
export function parseCalibrationFile(
  text: string,
  name: string = 'Calibration'
): CalibrationCurve {
  const lines = text.split(/\r?\n/);
  const points: CalibrationPoint[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith('#') ||
      line.startsWith('*') ||
      line.startsWith(';') ||
      line.startsWith('//')
    ) {
      continue;
    }
    if (!/^[0-9.]/.test(line)) {
      continue;
    }

    const parts = line.split(/[\t,;]+|\s+/).filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const frequencyHz = Number(parts[0]);
    const gainDb = Number(parts[1]);
    const phaseDeg = parts.length >= 3 ? Number(parts[2]) : 0.0;

    if (Number.isFinite(frequencyHz) && frequencyHz > 0 && Number.isFinite(gainDb)) {
      points.push({
        frequencyHz,
        gainDb,
        phaseDeg: Number.isFinite(phaseDeg) ? phaseDeg : 0.0,
      });
    }
  }

  points.sort((a, b) => a.frequencyHz - b.frequencyHz);
  return { name, points };
}

/**
 * Parses a `.frd` / `.csv` response file into typed `Float32Array` buffers (`frequenciesHz`, `magnitudeDb`, `phaseRad`).
 * Throws if fewer than 2 valid positive-frequency rows are found.
 */
export function parseFrdCurveText(text: string): FrdCurve {
  const cal = parseCalibrationFile(text, 'FRD');
  if (cal.points.length < 2) {
    throw new Error('Invalid .frd/.csv response file: fewer than 2 valid frequency rows.');
  }

  const n = cal.points.length;
  const frequenciesHz = new Float32Array(n);
  const magnitudeDb = new Float32Array(n);
  const phaseRad = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    frequenciesHz[i] = cal.points[i].frequencyHz;
    magnitudeDb[i] = cal.points[i].gainDb;
    phaseRad[i] = cal.points[i].phaseDeg * DEG_TO_RAD;
  }

  return { frequenciesHz, magnitudeDb, phaseRad };
}

export const parseFrdText = parseFrdCurveText;

/**
 * Interpolates an `FrdCurve` at `targetFreqHz` in log-frequency space with shortest-arc phase unwrapping.
 */
export function interpolateFrdCurveLogFreq(
  curve: FrdCurve,
  targetFreqHz: number
): { magDb: number; phaseRad: number } {
  const f = curve.frequenciesHz;
  const n = f.length;
  if (n === 0 || targetFreqHz <= 0) {
    return { magDb: 0, phaseRad: 0 };
  }
  if (targetFreqHz <= f[0]) {
    return { magDb: curve.magnitudeDb[0], phaseRad: curve.phaseRad[0] };
  }
  if (targetFreqHz >= f[n - 1]) {
    return { magDb: curve.magnitudeDb[n - 1], phaseRad: curve.phaseRad[n - 1] };
  }

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (f[mid] <= targetFreqHz) lo = mid;
    else hi = mid;
  }
  const span = Math.log(f[hi] / f[lo]);
  const t = span > 1e-9 ? Math.log(targetFreqHz / f[lo]) / span : 0;
  const magDb = curve.magnitudeDb[lo] + (curve.magnitudeDb[hi] - curve.magnitudeDb[lo]) * t;

  let dPh = curve.phaseRad[hi] - curve.phaseRad[lo];
  while (dPh > Math.PI) dPh -= 2 * Math.PI;
  while (dPh < -Math.PI) dPh += 2 * Math.PI;
  const phaseRad = curve.phaseRad[lo] + dPh * t;

  return { magDb, phaseRad };
}

/**
 * Interpolates a `CalibrationCurve` onto a target `frequencies` array (in Hz)
 * using piecewise-linear interpolation in log-frequency space with phase-wrap continuity.
 */
export function interpolateCalibrationCurve(
  curve: CalibrationCurve,
  frequencies: Float32Array
): { gainLinear: Float32Array; phaseRad: Float32Array } {
  const N = frequencies.length;
  const gainLinear = new Float32Array(N);
  const phaseRad = new Float32Array(N);
  gainLinear.fill(1.0);

  const pts = curve.points;
  if (pts.length === 0) {
    return { gainLinear, phaseRad };
  }

  let j = 0;
  for (let i = 0; i < N; i++) {
    const f = frequencies[i];
    if (f <= 0) {
      gainLinear[i] = 1.0;
      phaseRad[i] = 0.0;
      continue;
    }

    if (f <= pts[0].frequencyHz) {
      gainLinear[i] = Math.pow(10.0, pts[0].gainDb / 20.0);
      phaseRad[i] = pts[0].phaseDeg * DEG_TO_RAD;
      continue;
    }

    if (f >= pts[pts.length - 1].frequencyHz) {
      const last = pts[pts.length - 1];
      gainLinear[i] = Math.pow(10.0, last.gainDb / 20.0);
      phaseRad[i] = last.phaseDeg * DEG_TO_RAD;
      continue;
    }

    while (j + 1 < pts.length - 1 && pts[j + 1].frequencyHz < f) {
      j++;
    }

    const p0 = pts[j];
    const p1 = pts[j + 1];
    const logF = Math.log(f);
    const logF0 = Math.log(p0.frequencyHz);
    const logF1 = Math.log(p1.frequencyHz);
    const t = logF1 > logF0 ? (logF - logF0) / (logF1 - logF0) : 0;

    const db = p0.gainDb + t * (p1.gainDb - p0.gainDb);

    let dDeg = p1.phaseDeg - p0.phaseDeg;
    while (dDeg > 180) dDeg -= 360;
    while (dDeg < -180) dDeg += 360;
    const deg = p0.phaseDeg + t * dDeg;

    gainLinear[i] = Math.pow(10.0, db / 20.0);
    phaseRad[i] = deg * DEG_TO_RAD;
  }

  return { gainLinear, phaseRad };
}

/**
 * Serializes frequency, magnitude (dB), and optional phase (degrees) arrays to standard
 * 3-column `.frd` text (`FreqHz\tMagDb\tPhaseDeg`) compatible with Smaart, REW, OSM,
 * WebSpeakerSim, and WebSoundMeter.
 */
export function serializeFrdText(
  frequenciesHz: ArrayLike<number>,
  magnitudeDb: ArrayLike<number>,
  phaseDeg?: ArrayLike<number>,
  headerComment?: string
): string {
  const lines: string[] = [];
  if (headerComment) {
    for (const commentLine of headerComment.split(/\r?\n/)) {
      lines.push(`* ${commentLine}`);
    }
  }
  lines.push('* Frequency (Hz)\tMagnitude (dB)\tPhase (deg)');

  const count = Math.min(frequenciesHz.length, magnitudeDb.length);
  for (let i = 0; i < count; i++) {
    const f = frequenciesHz[i];
    const mag = magnitudeDb[i];
    if (!(f > 0) || !Number.isFinite(f) || !Number.isFinite(mag)) continue;
    const ph = phaseDeg && i < phaseDeg.length && Number.isFinite(phaseDeg[i]) ? phaseDeg[i] : 0;
    lines.push(`${f.toFixed(2)}\t${mag.toFixed(3)}\t${ph.toFixed(2)}`);
  }

  return `${lines.join('\n')}\n`;
}
