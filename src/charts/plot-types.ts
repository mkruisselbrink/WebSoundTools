/**
 * Plot Coordinate Mappers, Trace Vertex Builders, Group Delay Computer,
 * and Acoustic Cursor Readout Calculator.
 *
 * Pure TypeScript functions so all coordinate transforms, phase-wrap splitting,
 * coherence alpha mapping, and cursor readouts are 100% unit-testable in Node/Vitest.
 */

import { SourceData, getEffectiveBinResponse } from '../sources/source-data.js';

export type PlotType =
  | 'magnitude'
  | 'phase'
  | 'rta'
  | 'coherence'
  | 'impulse'
  | 'etc'
  | 'step'
  | 'group-delay';

export interface PlotMetadata {
  readonly type: PlotType;
  readonly label: string;
  readonly xUnit: 'Hz' | 'ms';
  readonly yUnit: string;
  readonly isLogX: boolean;
  readonly defaultXMin: number;
  readonly defaultXMax: number;
  readonly defaultYMin: number;
  readonly defaultYMax: number;
  readonly yStep: number;
}

export const PLOT_METADATA: Record<PlotType, PlotMetadata> = {
  magnitude: {
    type: 'magnitude',
    label: 'Magnitude (TF)',
    xUnit: 'Hz',
    yUnit: 'dB',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -24,
    defaultYMax: 24,
    yStep: 6,
  },
  phase: {
    type: 'phase',
    label: 'Phase',
    xUnit: 'Hz',
    yUnit: 'deg',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -180,
    defaultYMax: 180,
    yStep: 45,
  },
  rta: {
    type: 'rta',
    label: 'Spectrum (RTA)',
    xUnit: 'Hz',
    yUnit: 'dBFS',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -90,
    defaultYMax: 0,
    yStep: 15,
  },
  coherence: {
    type: 'coherence',
    label: 'Coherence (γ²)',
    xUnit: 'Hz',
    yUnit: '%',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: 0,
    defaultYMax: 100,
    yStep: 20,
  },
  impulse: {
    type: 'impulse',
    label: 'Impulse (Linear)',
    xUnit: 'ms',
    yUnit: 'amp',
    isLogX: false,
    defaultXMin: -10,
    defaultXMax: 30,
    defaultYMin: -1.0,
    defaultYMax: 1.0,
    yStep: 0.25,
  },
  etc: {
    type: 'etc',
    label: 'Impulse (ETC dB)',
    xUnit: 'ms',
    yUnit: 'dB',
    isLogX: false,
    defaultXMin: -5,
    defaultXMax: 45,
    defaultYMin: -72,
    defaultYMax: 0,
    yStep: 12,
  },
  step: {
    type: 'step',
    label: 'Step Response',
    xUnit: 'ms',
    yUnit: 'amp',
    isLogX: false,
    defaultXMin: -10,
    defaultXMax: 30,
    defaultYMin: -1.2,
    defaultYMax: 1.2,
    yStep: 0.4,
  },
  'group-delay': {
    type: 'group-delay',
    label: 'Group Delay',
    xUnit: 'Hz',
    yUnit: 'ms',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -20,
    defaultYMax: 20,
    yStep: 5,
  },
};

export const ISO_FREQUENCY_GRID_LINES = [
  20, 31.5, 50, 63, 100, 125, 200, 250, 400, 500, 800, 1000, 1600, 2000, 3150, 4000, 6300, 8000,
  10000, 16000, 20000,
];

export const ISO_MAJOR_FREQUENCIES = [
  20, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

export function formatFrequencyLabel(freqHz: number): string {
  if (freqHz >= 1000) {
    const k = freqHz / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return Number.isInteger(freqHz) ? `${freqHz}` : `${freqHz.toFixed(1)}`;
}

/**
 * Maps a domain X value (Hz or ms) to normalized [0, 1] viewport coordinate.
 */
export function valueToNormX(value: number, xMin: number, xMax: number, isLogX: boolean): number {
  if (isLogX) {
    const safeVal = Math.max(1e-3, value);
    const safeMin = Math.max(1e-3, xMin);
    const safeMax = Math.max(safeMin * 1.01, xMax);
    return Math.log(safeVal / safeMin) / Math.log(safeMax / safeMin);
  }
  return (value - xMin) / Math.max(1e-9, xMax - xMin);
}

/**
 * Maps a normalized [0, 1] viewport X coordinate back to domain X value (Hz or ms).
 */
export function normXToValue(normX: number, xMin: number, xMax: number, isLogX: boolean): number {
  const clamped = Math.max(0, Math.min(1, normX));
  if (isLogX) {
    const safeMin = Math.max(1e-3, xMin);
    const safeMax = Math.max(safeMin * 1.01, xMax);
    return safeMin * Math.pow(safeMax / safeMin, clamped);
  }
  return xMin + clamped * (xMax - xMin);
}

/**
 * Maps a domain Y value to normalized [0, 1] coordinate (0 = bottom, 1 = top).
 */
export function valueToNormY(value: number, yMin: number, yMax: number): number {
  return (value - yMin) / Math.max(1e-9, yMax - yMin);
}

/**
 * Maps coherence gamma^2 in [0, 1] to vertex alpha opacity in [0, 1]
 * using OSM's square-root curve above `threshold`.
 */
export function computeCoherenceAlpha(
  coherence: number,
  threshold: number,
  enabled: boolean
): number {
  if (!enabled) return 1.0;
  if (coherence >= 1.0) return 1.0;
  if (coherence < threshold) return 0.05; // Faint ghost trace below coherence threshold
  const span = Math.max(0.01, 1.0 - threshold);
  return Math.sqrt(Math.max(0, (coherence - threshold) / span));
}

export interface TraceVertexBuffer {
  /** Interleaved [ndcX, ndcY, alpha] floats for WebGL2 / 2D rendering */
  readonly vertices: Float32Array;
  readonly vertexCount: number;
}

/**
 * Builds an interleaved `[ndcX, ndcY, alpha]` vertex buffer in Normalized Device Coordinates `[-1, +1]`
 * for a given `SourceData` and `PlotType`.
 *
 * Automatically inserts zero-alpha break vertices on Phase wrap-around jumps (> 180 deg)
 * so vertical wrap lines are never drawn across the chart!
 */
export function buildTraceVertices(
  source: SourceData,
  plotType: PlotType,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  coherenceAlphaEnabled: boolean = true,
  coherenceThreshold: number = 0.35
): TraceVertexBuffer {
  const meta = PLOT_METADATA[plotType];

  if (plotType === 'impulse' || plotType === 'etc' || plotType === 'step') {
    const td = source.timeData;
    const N = td.length;
    const out = new Float32Array(N * 3);
    let ptr = 0;

    const gainLinear =
      source.gainOffsetDb !== 0 ? Math.pow(10.0, source.gainOffsetDb / 20.0) : 1.0;
    const polSign = source.invertPolarity ? -1.0 : 1.0;
    const delayShift = source.delayOffsetMs;

    for (let i = 0; i < N; i++) {
      const t = td.timeMs[i] + delayShift;
      if (t < xMin || t > xMax) continue;

      let yVal = 0;
      if (plotType === 'impulse') {
        yVal = td.impulse[i] * gainLinear * polSign;
      } else if (plotType === 'etc') {
        const absAmp = Math.abs(td.impulse[i] * gainLinear);
        yVal = absAmp > 1e-10 ? 20.0 * Math.log10(absAmp) : -120.0;
      } else {
        yVal = td.stepResponse[i] * gainLinear * polSign;
      }

      const nx = valueToNormX(t, xMin, xMax, false) * 2.0 - 1.0;
      const ny = valueToNormY(yVal, yMin, yMax) * 2.0 - 1.0;

      out[ptr++] = nx;
      out[ptr++] = ny;
      out[ptr++] = 1.0;
    }

    return {
      vertices: out.subarray(0, ptr),
      vertexCount: ptr / 3,
    };
  }

  // Frequency-domain plots
  const fd = source.freqData;
  const B = fd.length;
  // Allocate extra room for phase wrap-around break vertices
  const out = new Float32Array(B * 6);
  let ptr = 0;

  let prevPhaseDeg: number | null = null;
  let prevNx = 0;
  let prevNy = 0;

  for (let i = 1; i < B; i++) {
    const bin = getEffectiveBinResponse(source, i);
    const f = bin.frequency;
    if (f < xMin * 0.9 || f > xMax * 1.05) continue;

    let yVal = 0;
    const useCoh =
      coherenceAlphaEnabled &&
      (plotType === 'magnitude' || plotType === 'phase' || plotType === 'group-delay');
    const alpha = computeCoherenceAlpha(bin.coherence, coherenceThreshold, useCoh);

    if (plotType === 'magnitude') {
      yVal = bin.magnitude > 1e-10 ? 20.0 * Math.log10(bin.magnitude) : -120.0;
    } else if (plotType === 'rta') {
      yVal = bin.module > 1e-10 ? 20.0 * Math.log10(bin.module) : -140.0;
    } else if (plotType === 'coherence') {
      yVal = bin.coherence * 100.0;
    } else if (plotType === 'phase') {
      yVal = (Math.atan2(bin.phaseIm, bin.phaseRe) * 180.0) / Math.PI;
    } else if (plotType === 'group-delay') {
      // Group delay: -d(phi)/d(omega) in ms between bin i-1 and bin i
      const prevBin = getEffectiveBinResponse(source, i - 1);
      const df = f - prevBin.frequency;
      if (df > 0) {
        // Phase difference via complex conjugate product: bin * conj(prevBin)
        const dRe = bin.phaseRe * prevBin.phaseRe + bin.phaseIm * prevBin.phaseIm;
        const dIm = bin.phaseIm * prevBin.phaseRe - bin.phaseRe * prevBin.phaseIm;
        const dPhi = Math.atan2(dIm, dRe);
        yVal = (-1000.0 * dPhi) / (2.0 * Math.PI * df);
      }
    }

    const nx = valueToNormX(f, xMin, xMax, meta.isLogX) * 2.0 - 1.0;
    const ny = valueToNormY(yVal, yMin, yMax) * 2.0 - 1.0;

    // Suppress vertical jump lines when phase wraps across +/-180 degrees
    if (plotType === 'phase' && prevPhaseDeg !== null && Math.abs(yVal - prevPhaseDeg) > 170.0) {
      // Emit zero-alpha break vertices at end of old segment and start of new segment
      out[ptr++] = prevNx;
      out[ptr++] = prevNy;
      out[ptr++] = 0.0;

      out[ptr++] = nx;
      out[ptr++] = ny;
      out[ptr++] = 0.0;
    }

    out[ptr++] = nx;
    out[ptr++] = ny;
    out[ptr++] = alpha;

    prevPhaseDeg = yVal;
    prevNx = nx;
    prevNy = ny;
  }

  return {
    vertices: out.subarray(0, ptr),
    vertexCount: ptr / 3,
  };
}

export interface CursorAcousticReadout {
  readonly isFrequencyDomain: boolean;
  readonly xValue: number;
  readonly frequencyHz?: number;
  readonly periodMs?: number;
  readonly wavelengthMeters?: number;
  readonly wavelengthFeet?: number;
  readonly sourceValues: Array<{
    readonly sourceId: string;
    readonly name: string;
    readonly color: string;
    readonly formattedValue: string;
    readonly coherencePct?: number;
  }>;
}

/**
 * Computes acoustic cursor readout (Frequency, Period, Wavelength in m/ft, and per-source values)
 * at a given domain X position (`xValue` in Hz or ms).
 */
export function computeCursorReadout(
  plotType: PlotType,
  xValue: number,
  sources: readonly SourceData[]
): CursorAcousticReadout {
  const meta = PLOT_METADATA[plotType];
  const visibleSources = sources.filter((s) => s.visible && s.active);

  if (!meta.isLogX) {
    // Time-domain readout
    const sourceValues = visibleSources.map((src) => {
      const td = src.timeData;
      const N = td.length;
      // Find closest sample to xValue
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < N; i++) {
        const d = Math.abs(td.timeMs[i] + src.delayOffsetMs - xValue);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const amp = td.impulse[bestIdx];
      let formattedValue = '';
      if (plotType === 'etc') {
        const db = Math.abs(amp) > 1e-10 ? 20 * Math.log10(Math.abs(amp)) : -120;
        formattedValue = `${db.toFixed(1)} dB`;
      } else if (plotType === 'step') {
        formattedValue = `${td.stepResponse[bestIdx].toFixed(3)}`;
      } else {
        formattedValue = `${amp.toFixed(3)}`;
      }
      return {
        sourceId: src.id,
        name: src.name,
        color: src.color,
        formattedValue,
      };
    });

    return {
      isFrequencyDomain: false,
      xValue,
      sourceValues,
    };
  }

  // Frequency-domain readout with acoustic wavelength & period
  const freqHz = Math.max(1, xValue);
  const periodMs = 1000.0 / freqHz;
  const wavelengthMeters = 343.0 / freqHz; // Speed of sound @ 20°C = 343 m/s
  const wavelengthFeet = 1125.33 / freqHz;

  const sourceValues = visibleSources.map((src) => {
    const fd = src.freqData;
    const B = fd.length;
    const df = B > 1 ? fd.frequency[1] - fd.frequency[0] : 1;
    const idx = Math.max(1, Math.min(B - 1, Math.round(freqHz / Math.max(1e-6, df))));
    const bin = getEffectiveBinResponse(src, idx);
    const cohPct = Math.round(bin.coherence * 100);

    let formattedValue = '';
    if (plotType === 'magnitude') {
      const db = bin.magnitude > 1e-10 ? 20 * Math.log10(bin.magnitude) : -120;
      formattedValue = `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
    } else if (plotType === 'rta') {
      const db = bin.module > 1e-10 ? 20 * Math.log10(bin.module) : -140;
      formattedValue = `${db.toFixed(1)} dBFS`;
    } else if (plotType === 'phase') {
      const deg = (Math.atan2(bin.phaseIm, bin.phaseRe) * 180) / Math.PI;
      formattedValue = `${deg >= 0 ? '+' : ''}${deg.toFixed(0)}°`;
    } else if (plotType === 'coherence') {
      formattedValue = `${cohPct}%`;
    } else if (plotType === 'group-delay') {
      const prevBin = getEffectiveBinResponse(src, Math.max(1, idx - 1));
      const stepF = Math.max(1e-3, bin.frequency - prevBin.frequency);
      const dRe = bin.phaseRe * prevBin.phaseRe + bin.phaseIm * prevBin.phaseIm;
      const dIm = bin.phaseIm * prevBin.phaseRe - bin.phaseRe * prevBin.phaseIm;
      const gdMs = (-1000.0 * Math.atan2(dIm, dRe)) / (2.0 * Math.PI * stepF);
      formattedValue = `${gdMs.toFixed(2)} ms`;
    }

    return {
      sourceId: src.id,
      name: src.name,
      color: src.color,
      formattedValue,
      coherencePct: cohPct,
    };
  });

  return {
    isFrequencyDomain: true,
    xValue: freqHz,
    frequencyHz: freqHz,
    periodMs,
    wavelengthMeters,
    wavelengthFeet,
    sourceValues,
  };
}
