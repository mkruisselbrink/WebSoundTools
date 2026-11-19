// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure chart coordinate transforms, NDC trace vertex builders, axis formatters,
 * coherence alpha curves, and adaptive axis bound calculators.
 */

import type { ChartAxisBounds, ChartPadding, ChartPlotBox } from './chart-scene-types.js';

export type MagnitudeSpanMode = 'auto-30' | 'auto-60' | 'auto-80';

export type CoherenceBlankingMode = 'off' | 'alpha' | 'cutoff';

export const DEFAULT_CHART_PADDING: ChartPadding = {
  left: 52,
  right: 18,
  top: 12,
  bottom: 24,
};

export const ISO_FREQUENCY_GRID_LINES: readonly number[] = [
  20, 31.5, 50, 63, 100, 125, 200, 250, 400, 500, 800, 1000, 1600, 2000, 3150, 4000, 6300,
  8000, 10000, 16000, 20000,
];

export const ISO_MAJOR_FREQUENCIES: readonly number[] = [
  20, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

export function getChartPlotBox(
  cssWidth: number,
  cssHeight: number,
  padding: ChartPadding = DEFAULT_CHART_PADDING
): ChartPlotBox {
  return {
    left: padding.left,
    top: padding.top,
    width: Math.max(16, cssWidth - padding.left - padding.right),
    height: Math.max(16, cssHeight - padding.top - padding.bottom),
  };
}

export function formatFrequencyLabel(freqHz: number): string {
  if (freqHz >= 1000) {
    const k = Math.round((freqHz / 1000) * 10) / 10;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  const rounded = Math.round(freqHz * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(1)}`;
}

export function formatRelativeTimeLabel(sec: number): string {
  if (Math.abs(sec) < 0.05) {
    return '0s';
  }
  const absSec = Math.abs(sec);
  const sign = sec < 0 ? '-' : '+';
  if (absSec >= 3600 && Math.abs(absSec % 3600) < 0.1) {
    return `${sign}${Math.round(absSec / 3600)}h`;
  }
  if (absSec >= 60 && Math.abs(absSec % 60) < 0.1) {
    return `${sign}${Math.round(absSec / 60)}m`;
  }
  if (absSec >= 60) {
    const m = Math.floor(absSec / 60);
    const remS = Math.round(absSec - m * 60);
    return `${sign}${m}m${remS}s`;
  }
  return `${sign}${Math.round(absSec)}s`;
}

/**
 * Maps a domain X value (Hz, ms, s, or dB) to normalized `[0, 1]` plot-box coordinate.
 */
export function valueToNormX(
  value: number,
  xMin: number,
  xMax: number,
  isLogX: boolean
): number {
  if (isLogX) {
    const safeVal = Math.max(1e-3, value);
    const safeMin = Math.max(1e-3, xMin);
    const safeMax = Math.max(safeMin * 1.01, xMax);
    return Math.log(safeVal / safeMin) / Math.log(safeMax / safeMin);
  }
  return (value - xMin) / Math.max(1e-9, xMax - xMin);
}

/**
 * Maps a normalized `[0, 1]` plot-box X coordinate back to a domain X value.
 */
export function normXToValue(
  normX: number,
  xMin: number,
  xMax: number,
  isLogX: boolean
): number {
  const clamped = Math.max(0, Math.min(1, normX));
  if (isLogX) {
    const safeMin = Math.max(1e-3, xMin);
    const safeMax = Math.max(safeMin * 1.01, xMax);
    return safeMin * Math.pow(safeMax / safeMin, clamped);
  }
  return xMin + clamped * (xMax - xMin);
}

/**
 * Maps a domain Y value to normalized `[0, 1]` plot-box coordinate (`0` = bottom, `1` = top).
 */
export function valueToNormY(value: number, yMin: number, yMax: number): number {
  return (value - yMin) / Math.max(1e-9, yMax - yMin);
}

/**
 * Maps a normalized `[0, 1]` plot-box Y coordinate (`0` = bottom, `1` = top) back to domain Y.
 */
export function normYToValue(normY: number, yMin: number, yMax: number): number {
  const clamped = Math.max(0, Math.min(1, normY));
  return yMin + clamped * (yMax - yMin);
}

export function computeZoomedYRange(
  yMin: number,
  yMax: number,
  factor: number
): { readonly yMin: number; readonly yMax: number } {
  const center = 0.5 * (yMin + yMax);
  const halfSpan = Math.max(1, 0.5 * (yMax - yMin) * factor);
  return {
    yMin: Math.round((center - halfSpan) * 10) / 10,
    yMax: Math.round((center + halfSpan) * 10) / 10,
  };
}

/**
 * Maps coherence `gamma^2` in `[0, 1]` to per-vertex alpha opacity in `[0, 1]`:
 * - `'off'` / `false`: always `1.0` (unmasked solid trace)
 * - `'alpha'` / `true`: square-root taper above `threshold` with a `0.05` ghost trace below it
 * - `'cutoff'`: hard gate (`1.0` at or above `threshold`, `0.0` break below `threshold`)
 */
export function computeCoherenceAlpha(
  coherence: number,
  threshold: number,
  modeOrEnabled: boolean | CoherenceBlankingMode = 'alpha'
): number {
  const mode: CoherenceBlankingMode =
    typeof modeOrEnabled === 'boolean' ? (modeOrEnabled ? 'alpha' : 'off') : modeOrEnabled;
  if (mode === 'off') return 1.0;
  if (mode === 'cutoff') {
    return coherence >= threshold ? 1.0 : 0.0;
  }
  if (coherence >= 1.0) return 1.0;
  if (coherence < threshold) return 0.05;
  const span = Math.max(0.01, 1.0 - threshold);
  return Math.sqrt(Math.max(0, (coherence - threshold) / span));
}

export interface TraceVertexBuffer {
  /** Interleaved `[ndcX, ndcY, alpha]` floats in plot-local NDC `[-1, +1]`. */
  readonly vertices: Float32Array;
  readonly vertexCount: number;
}

export interface BuildTraceNdcOptions {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly length?: number;
  readonly bounds: ChartAxisBounds;
  readonly isLogX: boolean;
  readonly alpha?: Float32Array | number;
  readonly unwrapPhaseBreaks?: boolean;
  readonly phaseBreakThresholdDeg?: number;
  readonly outScratch?: Float32Array;
}

/**
 * Builds an interleaved `[ndcX, ndcY, alpha]` vertex buffer in plot-local NDC `[-1, +1]`,
 * automatically inserting zero-alpha break vertices across phase wrap discontinuities.
 */
export function buildTraceNdcVertices(options: BuildTraceNdcOptions): TraceVertexBuffer {
  const { x, y, bounds, isLogX, alpha } = options;
  const n = Math.min(options.length ?? x.length, x.length, y.length);
  const maxVerts = n * 2 + 4;
  const out =
    options.outScratch && options.outScratch.length >= maxVerts * 3
      ? options.outScratch
      : new Float32Array(maxVerts * 3);

  const { xMin, xMax, yMin, yMax } = bounds;
  const xLo = isLogX ? xMin * 0.9 : xMin;
  const xHi = isLogX ? xMax * 1.05 : xMax;
  const breakThreshold = options.phaseBreakThresholdDeg ?? 165.0;
  const uniformAlpha = typeof alpha === 'number' ? alpha : 1.0;
  const alphaArr = alpha instanceof Float32Array ? alpha : null;

  let ptr = 0;
  let prevY: number | null = null;
  let prevNx = 0;
  let prevNy = 0;

  for (let i = 0; i < n; i++) {
    const xv = x[i];
    if (xv < xLo || xv > xHi) continue;
    const yv = y[i];
    const nx = valueToNormX(xv, xMin, xMax, isLogX) * 2.0 - 1.0;
    const ny = valueToNormY(yv, yMin, yMax) * 2.0 - 1.0;
    const a = alphaArr ? alphaArr[i] : uniformAlpha;

    if (
      options.unwrapPhaseBreaks &&
      prevY !== null &&
      Math.abs(yv - prevY) > breakThreshold
    ) {
      out[ptr++] = prevNx;
      out[ptr++] = prevNy;
      out[ptr++] = 0.0;

      out[ptr++] = nx;
      out[ptr++] = ny;
      out[ptr++] = 0.0;
    }

    out[ptr++] = nx;
    out[ptr++] = ny;
    out[ptr++] = a;

    prevY = yv;
    prevNx = nx;
    prevNy = ny;
  }

  return {
    vertices: out.subarray(0, ptr),
    vertexCount: ptr / 3,
  };
}

export function chooseCleanAxisStep(span: number, targetLines: number = 5): number {
  const raw = Math.max(1, span) / Math.max(2, targetLines);
  const steps = [1, 2, 5, 10, 15, 20, 25, 30, 50, 100];
  for (const s of steps) {
    if (s >= raw) return s;
  }
  return 100;
}

/**
 * Computes non-clipping magnitude Y-axis bounds anchored at `peakDb + 5 dB` rounded up to 5 dB.
 */
export function computeAdaptiveMagnitudeBounds(
  magnitudeArraysDb: readonly Float32Array[],
  spanMode: MagnitudeSpanMode = 'auto-60',
  xMin: number = 20,
  xMax: number = 20000,
  fallbackPeakDb: number = 105
): Required<ChartAxisBounds> {
  let peakDb = Number.NEGATIVE_INFINITY;
  for (const arr of magnitudeArraysDb) {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Number.isFinite(v) && v > -110 && v > peakDb) {
        peakDb = v;
      }
    }
  }
  if (!Number.isFinite(peakDb)) {
    peakDb = fallbackPeakDb;
  }
  const span = spanMode === 'auto-30' ? 30 : spanMode === 'auto-80' ? 80 : 60;
  const yMax = Math.ceil((peakDb + 5) / 5) * 5;
  const yMin = yMax - span;
  const yStep = span <= 35 ? 5 : span <= 65 ? 10 : 20;
  return { xMin, xMax, yMin, yMax, yStep };
}

/**
 * Computes magnitude-gated Group Delay Y-axis bounds (`>= localPeak - 50 dB`) so deep stopband
 * nulls do not blow up the vertical scale.
 */
export function computeAdaptiveGroupDelayBounds(
  series: readonly {
    readonly magnitudeDb: Float32Array;
    readonly groupDelayMs: Float32Array;
  }[],
  xMin: number = 20,
  xMax: number = 20000
): Required<ChartAxisBounds> {
  let minGd = -8;
  let maxGd = 20;
  for (const item of series) {
    let localPeak = -120;
    for (let i = 0; i < item.magnitudeDb.length; i++) {
      if (item.magnitudeDb[i] > localPeak) localPeak = item.magnitudeDb[i];
    }
    const gateDb = localPeak - 50;
    for (let i = 0; i < item.groupDelayMs.length; i++) {
      if (item.magnitudeDb[i] < gateDb) continue;
      const gd = item.groupDelayMs[i];
      if (!Number.isFinite(gd)) continue;
      const clamped = Math.max(-120, Math.min(160, gd));
      if (clamped < minGd) minGd = clamped;
      if (clamped > maxGd) maxGd = clamped;
    }
  }
  const pad = Math.max(2.5, (maxGd - minGd) * 0.12);
  const step = chooseCleanAxisStep(maxGd - minGd + pad * 2, 5);
  const yMin = Math.floor((minGd - pad) / step) * step;
  const yMax = Math.max(yMin + step * 2, Math.ceil((maxGd + pad) / step) * step);
  return { xMin, xMax, yMin, yMax, yStep: step };
}
