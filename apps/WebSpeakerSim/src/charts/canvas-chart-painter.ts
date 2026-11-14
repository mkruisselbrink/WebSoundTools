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
 * 2D Canvas chart axes, logarithmic frequency grid, fallback trace rendering,
 * discrete impulse arrival stems, and Audience SPL histogram painter (`src/charts/canvas-chart-painter.ts`).
 */

import type { VirtualMicInstance } from '../model/project-types.js';
import type { PlanGridResult } from '../physics/summation-solver.js';
import type { VirtualMicResponse } from '../physics/virtual-mic-solver.js';
import {
  ISO_LOG_GRID_FREQS,
  ISO_MAJOR_LABEL_FREQS,
  SIM_PLOT_METADATA,
  computeAudienceSplHistogram,
  formatFrequencyLabel,
  normXToValue,
  valueToNormX,
  valueToNormY,
  type SimPlotType,
} from './plot-types.js';

export interface ChartPlotBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ChartPaintParams {
  readonly plotType: SimPlotType;
  readonly box: ChartPlotBox;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly yStep?: number;
  readonly mics: readonly VirtualMicInstance[];
  readonly responses: readonly VirtualMicResponse[];
  readonly planGrid: PlanGridResult | null;
  readonly drawFallbackTraces: boolean;
  readonly hoverPx: number | null;
}

export function getChartPlotBox(cssWidth: number, cssHeight: number): ChartPlotBox {
  const left = 48;
  const rightPad = 18;
  const top = 12;
  const bottomPad = 22;
  return {
    left,
    top,
    width: Math.max(20, cssWidth - left - rightPad),
    height: Math.max(20, cssHeight - top - bottomPad),
  };
}

export function paintChartCanvas(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  params: ChartPaintParams
): void {
  const { plotType, box, xMin, xMax, yMin, yMax } = params;
  const meta = SIM_PLOT_METADATA[plotType];

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Plot background behind WebGL traces (drawn only on non-WebGL modes or border)
  if (params.drawFallbackTraces || plotType === 'arrivals' || plotType === 'histogram') {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(box.left, box.top, box.width, box.height);
  }

  ctx.save();
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  // Horizontal Y grid lines
  const yStep = params.yStep ?? meta.yStep;
  const firstY = Math.ceil(yMin / yStep) * yStep;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let yv = firstY; yv <= yMax + 1e-6; yv += yStep) {
    const ny = valueToNormY(yv, yMin, yMax);
    const py = box.top + (1 - ny) * box.height;
    const isZero = Math.abs(yv) < 1e-5;

    ctx.strokeStyle = isZero ? 'rgba(148, 163, 184, 0.45)' : 'rgba(30, 41, 59, 0.85)';
    ctx.lineWidth = isZero ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(box.left, py);
    ctx.lineTo(box.left + box.width, py);
    ctx.stroke();

    ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
    ctx.fillText(`${Math.round(yv)}${meta.yUnit === '°' ? '°' : ''}`, box.left - 5, py);
  }

  // Vertical X grid lines
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (meta.xLog) {
    for (const f of ISO_LOG_GRID_FREQS) {
      if (f < xMin || f > xMax) continue;
      const nx = valueToNormX(f, xMin, xMax, true);
      const px = box.left + nx * box.width;
      const isMajor = ISO_MAJOR_LABEL_FREQS.has(f);

      ctx.strokeStyle = isMajor ? 'rgba(51, 65, 85, 0.9)' : 'rgba(30, 41, 59, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, box.top);
      ctx.lineTo(px, box.top + box.height);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(formatFrequencyLabel(f), px, box.top + box.height + 4);
      }
    }
  } else {
    const spanX = Math.max(1, xMax - xMin);
    const xStep = spanX > 80 ? 20 : spanX > 30 ? 10 : 5;
    const firstX = Math.ceil(xMin / xStep) * xStep;
    for (let xv = firstX; xv <= xMax + 1e-6; xv += xStep) {
      const nx = valueToNormX(xv, xMin, xMax, false);
      const px = box.left + nx * box.width;
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.beginPath();
      ctx.moveTo(px, box.top);
      ctx.lineTo(px, box.top + box.height);
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      const suffix = plotType === 'arrivals' ? 'ms' : 'dB';
      ctx.fillText(`${Math.round(xv)}${xv === firstX ? suffix : ''}`, px, box.top + box.height + 4);
    }
  }

  // Specialized plot content
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();

  const micColorMap = new Map<string, string>();
  for (const m of params.mics) {
    micColorMap.set(m.id, m.color);
  }

  if (plotType === 'arrivals') {
    paintArrivalStems(ctx, params, micColorMap);
  } else if (plotType === 'histogram') {
    paintSplHistogram(ctx, params);
  } else if (params.drawFallbackTraces) {
    paintFallbackFrequencyTraces(ctx, params, micColorMap);
  }

  ctx.restore();

  // Plot frame border
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.strokeRect(box.left, box.top, box.width, box.height);

  // Hover cursor line + floating canvas readout tooltip (zero header layout shift)
  if (
    params.hoverPx !== null &&
    params.hoverPx >= box.left &&
    params.hoverPx <= box.left + box.width
  ) {
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(params.hoverPx, box.top);
    ctx.lineTo(params.hoverPx, box.top + box.height);
    ctx.stroke();
    ctx.setLineDash([]);

    paintHoverReadoutOverlay(ctx, params, micColorMap);
  }

  ctx.restore();
}

function paintHoverReadoutOverlay(
  ctx: CanvasRenderingContext2D,
  params: ChartPaintParams,
  micColorMap: ReadonlyMap<string, string>
): void {
  const { plotType, box, xMin, xMax, yMin, yMax, hoverPx } = params;
  if (hoverPx === null) return;

  const meta = SIM_PLOT_METADATA[plotType];
  const normX = (hoverPx - box.left) / Math.max(1, box.width);
  const xVal = normXToValue(normX, xMin, xMax, meta.xLog);

  interface ReadoutRow {
    readonly color?: string;
    readonly text: string;
  }

  let headerText = '';
  const rows: ReadoutRow[] = [];

  if (meta.xLog) {
    headerText = xVal >= 1000 ? `${(xVal / 1000).toFixed(2)} kHz` : `${xVal.toFixed(1)} Hz`;
    for (const resp of params.responses) {
      if (resp.frequenciesHz.length === 0) continue;
      let bestIdx = 0;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < resp.frequenciesHz.length; i++) {
        const d = Math.abs(resp.frequenciesHz[i] - xVal);
        if (d < bestDiff) {
          bestDiff = d;
          bestIdx = i;
        }
      }
      const yVal =
        plotType === 'magnitude'
          ? resp.magnitudeDbSpl[bestIdx]
          : plotType === 'phase'
            ? resp.phaseDeg[bestIdx]
            : resp.groupDelayMs[bestIdx];
      const color = micColorMap.get(resp.micId) ?? '#38bdf8';

      // Highlight tracked point on the curve when inside plot box
      const ny = valueToNormY(yVal, yMin, yMax);
      const py = box.top + (1 - ny) * box.height;
      if (py >= box.top && py <= box.top + box.height) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hoverPx, py, 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      rows.push({
        color,
        text: `${resp.micName}: ${yVal.toFixed(1)} ${meta.yUnit}`,
      });
    }
  } else if (plotType === 'arrivals') {
    headerText = `t = ${xVal.toFixed(1)} ms`;
  } else {
    const bins = computeAudienceSplHistogram(params.planGrid, xMin, xMax, 2);
    const hitBin = bins.find((b) => xVal >= b.binMinDb && xVal < b.binMaxDb);
    headerText = hitBin
      ? `${hitBin.binMinDb.toFixed(0)}–${hitBin.binMaxDb.toFixed(0)} dB · ${hitBin.percentage.toFixed(1)}%`
      : `${xVal.toFixed(1)} dB SPL`;
  }

  ctx.save();
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  let maxW = ctx.measureText(headerText).width;
  for (const r of rows) {
    const w = ctx.measureText(r.text).width + (r.color ? 12 : 0);
    if (w > maxW) maxW = w;
  }

  const padX = 8;
  const padY = 5;
  const lineH = 14;
  const totalLines = 1 + rows.length;
  const pillW = Math.ceil(maxW + padX * 2);
  const pillH = padY * 2 + totalLines * lineH - 2;

  const placeLeft = hoverPx + 10 + pillW > box.left + box.width - 4;
  const px = placeLeft
    ? Math.max(box.left + 4, hoverPx - 10 - pillW)
    : Math.min(box.left + box.width - pillW - 4, hoverPx + 10);
  const py = box.top + 6;

  ctx.fillStyle = 'rgba(6, 9, 17, 0.90)';
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, 4);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(headerText, px + padX, py + padY + lineH * 0.45);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ry = py + padY + (i + 1) * lineH + lineH * 0.45;
    let tx = px + padX;
    if (row.color) {
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(tx + 3.5, ry, 3.2, 0, Math.PI * 2);
      ctx.fill();
      tx += 11;
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(row.text, tx, ry);
  }

  ctx.restore();
}

function paintFallbackFrequencyTraces(
  ctx: CanvasRenderingContext2D,
  params: ChartPaintParams,
  micColorMap: ReadonlyMap<string, string>
): void {
  const { plotType, box, xMin, xMax, yMin, yMax } = params;

  for (const resp of params.responses) {
    const color = micColorMap.get(resp.micId) ?? '#38bdf8';
    const freqs = resp.frequenciesHz;
    const ys =
      plotType === 'magnitude'
        ? resp.magnitudeDbSpl
        : plotType === 'phase'
          ? resp.phaseDeg
          : resp.groupDelayMs;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    let penDown = false;

    for (let i = 0; i < freqs.length; i++) {
      if (plotType === 'phase' && i > 0 && Math.abs(ys[i] - ys[i - 1]) > 165) {
        penDown = false;
      }
      const nx = valueToNormX(freqs[i], xMin, xMax, true);
      const ny = valueToNormY(ys[i], yMin, yMax);
      const px = box.left + nx * box.width;
      const py = box.top + (1 - ny) * box.height;
      if (!penDown) {
        ctx.moveTo(px, py);
        penDown = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }
}

function paintArrivalStems(
  ctx: CanvasRenderingContext2D,
  params: ChartPaintParams,
  micColorMap: ReadonlyMap<string, string>
): void {
  const { box, xMin, xMax, yMin, yMax } = params;
  const baselinePy = box.top + box.height;

  for (const resp of params.responses) {
    const baseColor = micColorMap.get(resp.micId) ?? '#38bdf8';
    for (const arr of resp.arrivals) {
      if (arr.arrivalTimeMs < xMin || arr.arrivalTimeMs > xMax || arr.levelDbSpl < yMin) continue;
      const nx = valueToNormX(arr.arrivalTimeMs, xMin, xMax, false);
      const ny = valueToNormY(arr.levelDbSpl, yMin, yMax);
      const px = box.left + nx * box.width;
      const py = box.top + (1 - ny) * box.height;

      ctx.save();
      ctx.strokeStyle = arr.polaritySign < 0 ? '#ef4444' : baseColor;
      ctx.globalAlpha = arr.isReflection ? 0.55 : 0.95;
      ctx.lineWidth = arr.isReflection ? 1.5 : 2.25;
      if (arr.isReflection) ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(px, baselinePy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = arr.polaritySign < 0 ? '#ef4444' : baseColor;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function paintSplHistogram(ctx: CanvasRenderingContext2D, params: ChartPaintParams): void {
  const { box, xMin, xMax, yMin, yMax, planGrid } = params;
  const bins = computeAudienceSplHistogram(planGrid, xMin, xMax, 2);

  for (const b of bins) {
    if (b.percentage <= 0.01) continue;
    const nx0 = valueToNormX(b.binMinDb, xMin, xMax, false);
    const nx1 = valueToNormX(b.binMaxDb, xMin, xMax, false);
    const ny = valueToNormY(b.percentage, yMin, yMax);
    const px0 = box.left + nx0 * box.width + 1;
    const px1 = box.left + nx1 * box.width - 1;
    const py = box.top + (1 - ny) * box.height;

    const mean = planGrid?.stats.meanAudienceSplDb ?? 95;
    const inTarget = Math.abs(b.binCenterDb - mean) <= 3.0;
    ctx.fillStyle = inTarget ? 'rgba(16, 185, 129, 0.72)' : 'rgba(56, 189, 248, 0.45)';
    ctx.strokeStyle = inTarget ? '#10b981' : '#38bdf8';
    ctx.lineWidth = 1;
    ctx.fillRect(px0, py, Math.max(1, px1 - px0), box.top + box.height - py);
    ctx.strokeRect(px0, py, Math.max(1, px1 - px0), box.top + box.height - py);
  }

  // Mean SPL vertical marker
  if (planGrid && planGrid.stats.audienceSampleCount > 0) {
    const mean = planGrid.stats.meanAudienceSplDb;
    const mx = box.left + valueToNormX(mean, xMin, xMax, false) * box.width;
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(mx, box.top);
    ctx.lineTo(mx, box.top + box.height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

