/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
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
 * Stateless 2D Canvas painting functions for acoustic chart overlays:
 *  - Logarithmic / linear grid lines and axis labels
 *  - Anti-aliased coherence-weighted trace strokes
 *  - Fractional-octave RTA bars and Peak Hold traces
 *  - Interactive Virtual EQ band handles and hover crosshair
 */

import { BiquadSpec } from '../dsp/biquad.js';
import { OctaveBandData, aggregateFractionalOctaveBands } from '../dsp/smoothing.js';
import { SourceData } from '../sources/source-data.js';
import { ChartAxisBounds } from './chart-interaction.js';
import {
  ISO_FREQUENCY_GRID_LINES,
  ISO_MAJOR_FREQUENCIES,
  PLOT_METADATA,
  PlotType,
  formatFrequencyLabel,
  valueToNormX,
  valueToNormY,
} from './plot-types.js';

export interface ChartPlotBox {
  readonly plotLeft: number;
  readonly plotTop: number;
  readonly plotW: number;
  readonly plotH: number;
}

export function drawGridAndAxes(
  ctx: CanvasRenderingContext2D,
  plotType: PlotType,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { plotLeft, plotTop, plotW, plotH } = box;
  const { xMin, xMax, yMin, yMax } = bounds;
  const meta = PLOT_METADATA[plotType];

  ctx.fillStyle = '#090d16';
  ctx.fillRect(plotLeft, plotTop, plotW, plotH);

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  // Horizontal Y grid lines & labels
  const ySpan = yMax - yMin;
  let yStep = meta.yStep;
  if (ySpan / yStep > 10) yStep *= 2;
  else if (ySpan / yStep < 3) yStep /= 2;

  const firstY = Math.ceil(yMin / yStep) * yStep;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let yVal = firstY; yVal <= yMax + 1e-6; yVal += yStep) {
    const normY = valueToNormY(yVal, yMin, yMax);
    const py = plotTop + (1.0 - normY) * plotH;

    const isZero = Math.abs(yVal) < 1e-5;
    ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
    ctx.lineWidth = isZero ? 1.25 : 1.0;
    ctx.beginPath();
    ctx.moveTo(plotLeft, py);
    ctx.lineTo(plotLeft + plotW, py);
    ctx.stroke();

    ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
    const decimals = yStep < 1 ? 2 : 0;
    ctx.fillText(
      `${yVal.toFixed(decimals)}${meta.yUnit === 'deg' ? '°' : ''}`,
      plotLeft - 6,
      py
    );
  }

  // Vertical X grid lines & labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (meta.isLogX) {
    for (const f of ISO_FREQUENCY_GRID_LINES) {
      if (f < xMin || f > xMax) continue;
      const normX = valueToNormX(f, xMin, xMax, true);
      const px = plotLeft + normX * plotW;
      const isMajor = ISO_MAJOR_FREQUENCIES.includes(f);

      ctx.strokeStyle = isMajor ? '#26334d' : '#151e30';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(px, plotTop);
      ctx.lineTo(px, plotTop + plotH);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(formatFrequencyLabel(f), px, plotTop + plotH + 5);
      }
    }
  } else {
    const xSpan = xMax - xMin;
    const xStep = xSpan <= 20 ? 2 : xSpan <= 50 ? 5 : 10;
    const firstX = Math.ceil(xMin / xStep) * xStep;
    for (let xVal = firstX; xVal <= xMax + 1e-6; xVal += xStep) {
      const normX = valueToNormX(xVal, xMin, xMax, false);
      const px = plotLeft + normX * plotW;
      const isZero = Math.abs(xVal) < 1e-5;

      ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
      ctx.lineWidth = isZero ? 1.25 : 1.0;
      ctx.beginPath();
      ctx.moveTo(px, plotTop);
      ctx.lineTo(px, plotTop + plotH);
      ctx.stroke();

      ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
      ctx.fillText(`${xVal}ms`, px, plotTop + plotH + 5);
    }
  }

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(plotLeft, plotTop, plotW, plotH);
}

export function drawCanvasTrace(
  ctx: CanvasRenderingContext2D,
  vertices: Float32Array,
  vertexCount: number,
  color: string,
  box: ChartPlotBox
): void {
  if (vertexCount < 2) return;
  const { plotLeft, plotTop, plotW, plotH } = box;
  ctx.lineWidth = 1.85;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;

  let currentAlphaBucket = -1;
  let pathOpen = false;

  for (let i = 0; i < vertexCount; i++) {
    const ndcX = vertices[i * 3];
    const ndcY = vertices[i * 3 + 1];
    const alpha = vertices[i * 3 + 2];

    const px = plotLeft + (ndcX + 1.0) * 0.5 * plotW;
    const py = plotTop + (1.0 - (ndcY + 1.0) * 0.5) * plotH;

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
  ctx.globalAlpha = 1.0;
}

const rtaOctaveBandsCache = new WeakMap<SourceData, Map<number, OctaveBandData>>();

function getCachedOctaveBands(
  src: SourceData,
  bandsPerOctave: 3 | 6 | 12
): OctaveBandData {
  let byBpo = rtaOctaveBandsCache.get(src);
  if (!byBpo) {
    byBpo = new Map<number, OctaveBandData>();
    rtaOctaveBandsCache.set(src, byBpo);
  }
  let bands = byBpo.get(bandsPerOctave);
  if (!bands) {
    bands = aggregateFractionalOctaveBands(
      src.freqData.frequency,
      src.freqData.module,
      src.freqData.peakSquared,
      bandsPerOctave
    );
    byBpo.set(bandsPerOctave, bands);
  }
  return bands;
}

export function drawRtaOctaveBars(
  ctx: CanvasRenderingContext2D,
  sources: readonly SourceData[],
  bandsPerOctave: 3 | 6 | 12,
  showPeakHold: boolean,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const numSources = sources.length;
  if (numSources === 0) return;
  const { plotLeft, plotTop, plotW, plotH } = box;
  const { xMin, xMax, yMin, yMax } = bounds;

  sources.forEach((src, sIdx) => {
    const bands = getCachedOctaveBands(src, bandsPerOctave);
    const count = bands.centerFrequencies.length;
    const totalBarSlotW = (plotW / Math.max(10, count)) * 0.78;
    const singleBarW = Math.max(2, totalBarSlotW / numSources);

    ctx.fillStyle = src.color;
    ctx.strokeStyle = src.color;

    for (let b = 0; b < count; b++) {
      const fc = bands.centerFrequencies[b];
      if (fc < xMin || fc > xMax) continue;

      const normX = valueToNormX(fc, xMin, xMax, true);
      const centerX = plotLeft + normX * plotW;
      const barX = centerX - totalBarSlotW * 0.5 + sIdx * singleBarW;

      const db =
        bands.magnitudes[b] > 1e-10
          ? 20 * Math.log10(bands.magnitudes[b]) + src.gainOffsetDb
          : -140;
      const normY = Math.max(0, Math.min(1, valueToNormY(db, yMin, yMax)));
      const barTop = plotTop + (1.0 - normY) * plotH;
      const barH = plotTop + plotH - barTop;

      ctx.globalAlpha = 0.72;
      ctx.fillRect(barX, barTop, Math.max(1.5, singleBarW - 1), barH);

      if (showPeakHold) {
        const peakDb =
          bands.peaks[b] > 1e-10
            ? 20 * Math.log10(bands.peaks[b]) + src.gainOffsetDb
            : -140;
        const peakNormY = Math.max(0, Math.min(1, valueToNormY(peakDb, yMin, yMax)));
        const peakY = plotTop + (1.0 - peakNormY) * plotH;
        ctx.globalAlpha = 1.0;
        ctx.fillRect(barX, peakY - 1.5, Math.max(1.5, singleBarW - 1), 2);
      }
    }
  });
  ctx.globalAlpha = 1.0;
}

export function drawRtaPeakLine(
  ctx: CanvasRenderingContext2D,
  src: SourceData,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { plotLeft, plotTop, plotW, plotH } = box;
  const { xMin, xMax, yMin, yMax } = bounds;
  const fd = src.freqData;
  ctx.strokeStyle = src.color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  let started = false;
  for (let i = 1; i < fd.length; i++) {
    const f = fd.frequency[i];
    if (f < xMin || f > xMax) continue;
    const pkDb =
      fd.peakSquared[i] > 1e-20
        ? 10 * Math.log10(fd.peakSquared[i]) + src.gainOffsetDb
        : -140;
    const px = plotLeft + valueToNormX(f, xMin, xMax, true) * plotW;
    const py = plotTop + (1.0 - valueToNormY(pkDb, yMin, yMax)) * plotH;
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1.0;
}

export function drawEqHandles(
  ctx: CanvasRenderingContext2D,
  bands: readonly BiquadSpec[],
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { plotLeft, plotTop, plotW, plotH } = box;
  const { xMin, xMax, yMin, yMax } = bounds;

  bands.forEach((b, idx) => {
    if (b.enabled === false) return;
    const px = plotLeft + valueToNormX(b.frequency, xMin, xMax, true) * plotW;
    const py = plotTop + (1.0 - valueToNormY(b.gainDb ?? 0, yMin, yMax)) * plotH;

    ctx.fillStyle = '#10b981';
    ctx.strokeStyle = '#052e16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`EQ${idx + 1}`, px, py - 8);
  });
}

export function drawCursorCrosshair(
  ctx: CanvasRenderingContext2D,
  cursorDomainX: number,
  isLogX: boolean,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { plotLeft, plotTop, plotW, plotH } = box;
  const normX = valueToNormX(cursorDomainX, bounds.xMin, bounds.xMax, isLogX);
  if (normX < 0 || normX > 1) return;

  const cx = plotLeft + normX * plotW;
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, plotTop);
  ctx.lineTo(cx, plotTop + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
}

