/**
 * Microphone Calibration File (.cal / .txt / .frd) Parser and Log-Frequency Interpolator.
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

/**
 * Parses a standard 2-column (Freq, dB) or 3-column (Freq, dB, PhaseDeg)
 * tab/comma/space-separated microphone calibration text file.
 */
export function parseCalibrationFile(text: string, name: string = 'Calibration'): CalibrationCurve {
  const lines = text.split(/\r?\n/);
  const points: CalibrationPoint[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('*') || line.startsWith(';') || line.startsWith('//')) {
      continue;
    }
    // Must begin with a digit or decimal point
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
 * Interpolates a `CalibrationCurve` onto a target `frequencies` array (in Hz)
 * using piecewise-linear interpolation in log-frequency space.
 *
 * Returns `{ gainLinear, phaseRad }` arrays of the same length as `frequencies`.
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

  const degToRad = Math.PI / 180.0;

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
      phaseRad[i] = pts[0].phaseDeg * degToRad;
      continue;
    }

    if (f >= pts[pts.length - 1].frequencyHz) {
      const last = pts[pts.length - 1];
      gainLinear[i] = Math.pow(10.0, last.gainDb / 20.0);
      phaseRad[i] = last.phaseDeg * degToRad;
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
    const deg = p0.phaseDeg + t * (p1.phaseDeg - p0.phaseDeg);

    gainLinear[i] = Math.pow(10.0, db / 20.0);
    phaseRad[i] = deg * degToRad;
  }

  return { gainLinear, phaseRad };
}

