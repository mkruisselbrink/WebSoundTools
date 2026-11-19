// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Stateless 2D Canvas painters for chart axes, logarithmic/linear/relative-time grids,
 * coherence-bucketed 2D trace strokes, fractional-octave RTA bars, arrival stems,
 * SPL histograms, and compliance threshold guides.
 */

import type {
  ChartAxisBounds,
  ChartAxisSpec,
  ChartPlotBox,
  FractionalOctaveBarSeries,
  HistogramSeries,
  StemPoint,
  ThresholdGuide,
} from './chart-scene-types.js';
import {
  ISO_FREQUENCY_GRID_LINES,
  ISO_MAJOR_FREQUENCIES,
  chooseCleanAxisStep,
  formatFrequencyLabel,
  formatRelativeTimeLabel,
  valueToNormX,
  valueToNormY,
} from './coord-math.js';

export function drawChartGridAndAxes(
  ctx: CanvasRenderingContext2D,
  axis: ChartAxisSpec,
  box: ChartPlotBox,
  fillPlotBackground: boolean = true
): void {
  const { left, top, width, height } = box;
  const { xMin, xMax, yMin, yMax } = axis.bounds;

  if (fillPlotBackground) {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(left, top, width, height);
  }

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  const ySpan = Math.max(1e-6, yMax - yMin);
  let yStep = axis.bounds.yStep ?? chooseCleanAxisStep(ySpan, 6);
  if (ySpan / yStep > 10) yStep *= 2;
  else if (ySpan / yStep < 3) yStep /= 2;

  const firstY = Math.ceil(yMin / yStep) * yStep;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const unitSuffix = axis.yUnit === 'deg' || axis.yUnit === '°' ? '°' : '';
  const decimals = yStep < 1 ? 2 : 0;

  for (let yVal = firstY; yVal <= yMax + 1e-6; yVal += yStep) {
    const normY = valueToNormY(yVal, yMin, yMax);
    const py = top + (1.0 - normY) * height;
    const isZero = Math.abs(yVal) < 1e-5;

    ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
    ctx.lineWidth = isZero ? 1.25 : 1.0;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(left + width, py);
    ctx.stroke();

    ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
    ctx.fillText(`${yVal.toFixed(decimals)}${unitSuffix}`, left - 6, py);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (axis.xScale === 'log') {
    for (const f of ISO_FREQUENCY_GRID_LINES) {
      if (f < xMin || f > xMax) continue;
      const normX = valueToNormX(f, xMin, xMax, true);
      const px = left + normX * width;
      const isMajor = ISO_MAJOR_FREQUENCIES.includes(f);

      ctx.strokeStyle = isMajor ? '#26334d' : '#151e30';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + height);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(formatFrequencyLabel(f), px, top + height + 5);
      }
    }
  } else if (axis.xScale === 'relative-time') {
    const xSpan = Math.max(10, xMax - xMin);
    const xStep =
      xSpan <= 90
        ? 15
        : xSpan <= 360
          ? 60
          : xSpan <= 1200
            ? 180
            : xSpan <= 4000
              ? 600
              : 1800;
    const firstX = Math.ceil(xMin / xStep) * xStep;
    for (let xVal = firstX; xVal <= xMax + 1e-6; xVal += xStep) {
      const normX = valueToNormX(xVal, xMin, xMax, false);
      const px = left + normX * width;
      const isZero = Math.abs(xVal) < 1e-5;

      ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
      ctx.lineWidth = isZero ? 1.25 : 1.0;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + height);
      ctx.stroke();

      ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
      ctx.fillText(formatRelativeTimeLabel(xVal), px, top + height + 5);
    }
  } else {
    const xSpan = Math.max(1, xMax - xMin);
    const xStep =
      xSpan <= 20 ? 2 : xSpan <= 50 ? 5 : xSpan <= 100 ? 10 : chooseCleanAxisStep(xSpan, 6);
    const firstX = Math.ceil(xMin / xStep) * xStep;
    for (let xVal = firstX; xVal <= xMax + 1e-6; xVal += xStep) {
      const normX = valueToNormX(xVal, xMin, xMax, false);
      const px = left + normX * width;
      const isZero = Math.abs(xVal) < 1e-5;

      ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
      ctx.lineWidth = isZero ? 1.25 : 1.0;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + height);
      ctx.stroke();

      ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
      const label =
        axis.xUnit === 'dB'
          ? `${Math.round(xVal)}${xVal === firstX ? 'dB' : ''}`
          : `${Math.round(xVal * 10) / 10}${axis.xUnit}`;
      ctx.fillText(label, px, top + height + 5);
    }
  }

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, width, height);
}

export interface CanvasTraceStyle {
  readonly lineDash?: readonly number[];
  readonly lineWidth?: number;
  readonly opacity?: number;
}

export function drawCanvasTrace(
  ctx: CanvasRenderingContext2D,
  vertices: Float32Array,
  vertexCount: number,
  color: string,
  box: ChartPlotBox,
  style?: CanvasTraceStyle
): void {
  if (vertexCount < 2) return;
  const { left, top, width, height } = box;
  const baseOpacity = style?.opacity ?? 1.0;

  ctx.save();
  ctx.lineWidth = style?.lineWidth ?? 2.0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  if (style?.lineDash && style.lineDash.length > 0) {
    ctx.setLineDash([...style.lineDash]);
  }

  let currentAlphaBucket = -1;
  let pathOpen = false;

  for (let i = 0; i < vertexCount; i++) {
    const ndcX = vertices[i * 3];
    const ndcY = vertices[i * 3 + 1];
    const alpha = vertices[i * 3 + 2] * baseOpacity;

    const px = left + (ndcX + 1.0) * 0.5 * width;
    const py = top + (1.0 - (ndcY + 1.0) * 0.5) * height;

    if (alpha <= 0.01) {
      if (pathOpen) {
        ctx.stroke();
        pathOpen = false;
      }
      currentAlphaBucket = -1;
      continue;
    }

    const bucket = Math.max(1, Math.min(8, Math.round(alpha * 8)));
    if (bucket !== currentAlphaBucket) {
      if (pathOpen) {
        ctx.lineTo(px, py);
        ctx.stroke();
      }
      currentAlphaBucket = bucket;
      ctx.globalAlpha = bucket / 8.0;
      ctx.beginPath();
      ctx.moveTo(px, py);
      pathOpen = true;
    } else {
      ctx.lineTo(px, py);
    }
  }

  if (pathOpen) {
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

export function drawRtaBarSeries(
  ctx: CanvasRenderingContext2D,
  seriesList: readonly FractionalOctaveBarSeries[],
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const numSeries = seriesList.length;
  if (numSeries === 0) return;
  const { left, top, width, height } = box;
  const { xMin, xMax, yMin, yMax } = bounds;

  seriesList.forEach((series, sIdx) => {
    const count = series.centerFrequencies.length;
    const totalBarSlotW = (width / Math.max(10, count)) * 0.78;
    const singleBarW = Math.max(2, totalBarSlotW / numSeries);

    ctx.fillStyle = series.color;
    ctx.strokeStyle = series.color;

    for (let b = 0; b < count; b++) {
      const fc = series.centerFrequencies[b];
      if (fc < xMin || fc > xMax) continue;

      const normX = valueToNormX(fc, xMin, xMax, true);
      const centerX = left + normX * width;
      const barX = centerX - totalBarSlotW * 0.5 + sIdx * singleBarW;

      const db = series.magnitudesDb[b];
      const normY = Math.max(0, Math.min(1, valueToNormY(db, yMin, yMax)));
      const barTop = top + (1.0 - normY) * height;
      const barH = top + height - barTop;

      ctx.globalAlpha = 0.72;
      ctx.fillRect(barX, barTop, Math.max(1.5, singleBarW - 1), barH);

      if (series.showPeakHold && series.peaksDb) {
        const peakDb = series.peaksDb[b];
        const peakNormY = Math.max(0, Math.min(1, valueToNormY(peakDb, yMin, yMax)));
        const peakY = top + (1.0 - peakNormY) * height;
        ctx.globalAlpha = 1.0;
        ctx.fillRect(barX, peakY - 1.5, Math.max(1.5, singleBarW - 1), 2);
      }
    }
  });
  ctx.globalAlpha = 1.0;
}

export function drawStemPoints(
  ctx: CanvasRenderingContext2D,
  stems: readonly StemPoint[],
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { left, top, width, height } = box;
  const { xMin, xMax, yMin, yMax } = bounds;
  const baselinePy = top + height;

  for (const stem of stems) {
    if (stem.x < xMin || stem.x > xMax || stem.y < yMin) continue;
    const nx = valueToNormX(stem.x, xMin, xMax, false);
    const ny = valueToNormY(stem.y, yMin, yMax);
    const px = left + nx * width;
    const py = top + (1.0 - ny) * height;

    ctx.save();
    ctx.strokeStyle = stem.color;
    ctx.globalAlpha = stem.opacity ?? 0.95;
    ctx.lineWidth = stem.lineWidth ?? 2.25;
    if (stem.dashed) {
      ctx.setLineDash([3, 2]);
    }
    ctx.beginPath();
    ctx.moveTo(px, baselinePy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = stem.color;
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function drawHistogramSeries(
  ctx: CanvasRenderingContext2D,
  histogram: HistogramSeries,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { left, top, width, height } = box;
  const { xMin, xMax, yMin, yMax } = bounds;

  for (const b of histogram.bins) {
    if (b.value <= 0.01) continue;
    const nx0 = valueToNormX(b.binMin, xMin, xMax, false);
    const nx1 = valueToNormX(b.binMax, xMin, xMax, false);
    const ny = valueToNormY(b.value, yMin, yMax);
    const px0 = left + nx0 * width + 1;
    const px1 = left + nx1 * width - 1;
    const py = top + (1.0 - ny) * height;

    ctx.fillStyle = b.highlighted
      ? 'rgba(16, 185, 129, 0.72)'
      : 'rgba(56, 189, 248, 0.45)';
    ctx.strokeStyle = b.highlighted ? '#10b981' : '#38bdf8';
    ctx.lineWidth = 1;
    ctx.fillRect(px0, py, Math.max(1, px1 - px0), top + height - py);
    ctx.strokeRect(px0, py, Math.max(1, px1 - px0), top + height - py);
  }

  if (histogram.meanMarkerX !== undefined && Number.isFinite(histogram.meanMarkerX)) {
    const mx = left + valueToNormX(histogram.meanMarkerX, xMin, xMax, false) * width;
    ctx.save();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(mx, top);
    ctx.lineTo(mx, top + height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

export function drawThresholdGuide(
  ctx: CanvasRenderingContext2D,
  guide: ThresholdGuide,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { left, top, width, height } = box;
  const { yMin, yMax } = bounds;
  const warnY = top + (1.0 - valueToNormY(guide.warningY, yMin, yMax)) * height;
  const limitY = top + (1.0 - valueToNormY(guide.limitY, yMin, yMax)) * height;

  if (limitY > top) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
    ctx.fillRect(left, top, width, Math.min(height, limitY - top));
  }

  if (warnY >= top && warnY <= top + height) {
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(left, warnY);
    ctx.lineTo(left + width, warnY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(guide.warningLabel, left + 6, Math.max(top + 10, warnY - 3));
    ctx.restore();
  }

  if (limitY >= top && limitY <= top + height) {
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(left, limitY);
    ctx.lineTo(left + width, limitY);
    ctx.stroke();

    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(guide.limitLabel, left + 6, Math.max(top + 10, limitY - 3));
    ctx.restore();
  }
}
