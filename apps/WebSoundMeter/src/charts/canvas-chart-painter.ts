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
import {
  DetectedFeedbackTrack,
  MAX_VISIBLE_CALLOUT_FLAGS,
} from '../dsp/feedback-detector.js';
import { OctaveBandData, aggregateFractionalOctaveBands } from '../dsp/smoothing.js';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  SplAlertThresholds,
  SplHistoryTraceMode,
} from '../dsp/spl-history.js';
import { SourceData } from '../sources/source-data.js';
import { ChartAxisBounds } from './chart-interaction.js';
import {
  ISO_FREQUENCY_GRID_LINES,
  ISO_MAJOR_FREQUENCIES,
  PLOT_METADATA,
  PlotType,
  buildSplSeriesVertices,
  formatFrequencyLabel,
  formatRelativeTimeLabel,
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
  } else if (plotType === 'spl-history') {
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
      const px = plotLeft + normX * plotW;
      const isZero = Math.abs(xVal) < 1e-5;

      ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
      ctx.lineWidth = isZero ? 1.25 : 1.0;
      ctx.beginPath();
      ctx.moveTo(px, plotTop);
      ctx.lineTo(px, plotTop + plotH);
      ctx.stroke();

      ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
      ctx.fillText(formatRelativeTimeLabel(xVal), px, plotTop + plotH + 5);
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

/**
 * Renders the `'spl-history'` plot traces and accessible compliance threshold lines (`▲ WARN`, `◆ LIMIT`).
 */
export function drawSplHistoryPlot(
  ctx: CanvasRenderingContext2D,
  sources: readonly SourceData[],
  traceMode: SplHistoryTraceMode,
  showThresholds: boolean,
  thresholds: SplAlertThresholds = DEFAULT_SPL_ALERT_THRESHOLDS,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { plotLeft, plotTop, plotW, plotH } = box;
  const { xMin, xMax, yMin, yMax } = bounds;

  // 1. Draw accessible warning & limit threshold guides
  if (showThresholds && thresholds.enabled) {
    const warnY = plotTop + (1.0 - valueToNormY(thresholds.warningDb, yMin, yMax)) * plotH;
    const limitY = plotTop + (1.0 - valueToNormY(thresholds.limitDb, yMin, yMax)) * plotH;

    // Danger band shading above limitDb
    if (limitY > plotTop) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(plotLeft, plotTop, plotW, Math.min(plotH, limitY - plotTop));
    }

    // Warning line (dashed amber + triangle badge)
    if (warnY >= plotTop && warnY <= plotTop + plotH) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, warnY);
      ctx.lineTo(plotLeft + plotW, warnY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        `▲ WARN ${thresholds.warningDb.toFixed(0)} dB`,
        plotLeft + 6,
        Math.max(plotTop + 10, warnY - 3)
      );
      ctx.restore();
    }

    // Limit line (double solid red + diamond badge)
    if (limitY >= plotTop && limitY <= plotTop + plotH) {
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(plotLeft, limitY);
      ctx.lineTo(plotLeft + plotW, limitY);
      ctx.stroke();

      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        `◆ LIMIT ${thresholds.limitDb.toFixed(0)} dB (${thresholds.metric})`,
        plotLeft + 6,
        Math.max(plotTop + 10, limitY - 3)
      );
      ctx.restore();
    }
  }

  const liveSourcesWithHistory = sources.filter(
    (s) => s.splHistory && s.splHistory.length > 0
  );
  if (liveSourcesWithHistory.length === 0) {
    return;
  }

  for (const src of liveSourcesWithHistory) {
    const hist = src.splHistory!;

    if (traceMode === 'multi-slot') {
      const vBuf = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq15mDbA,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        1.0
      );
      drawCanvasTrace(ctx, vBuf.vertices, vBuf.vertexCount, src.color, box);
      continue;
    }

    if (traceMode === 'dba-dbc-leq1m') {
      ctx.save();
      ctx.setLineDash([5, 3]);
      const vC = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq1mDbC,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        0.75
      );
      drawCanvasTrace(ctx, vC.vertices, vC.vertexCount, src.color, box);
      ctx.setLineDash([]);
      ctx.restore();

      const vA = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq1mDbA,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        1.0
      );
      drawCanvasTrace(ctx, vA.vertices, vA.vertexCount, src.color, box);
      continue;
    }

    // Draw translucent short-term LAF envelope in src.color
    const vFast = buildSplSeriesVertices(
      hist.timeSec,
      hist.shortTermDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      0.32
    );
    drawCanvasTrace(ctx, vFast.vertices, vFast.vertexCount, src.color, box);

    if (traceMode === 'dba-fast-leq1m') {
      const vLeq1 = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq1mDbA,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        1.0
      );
      drawCanvasTrace(ctx, vLeq1.vertices, vLeq1.vertexCount, src.color, box);
      continue;
    }

    // Default: 'compliance-15m' (LAeq,15m solid + LAeq,1m dashed + Peak dotted, all in src.color)
    ctx.save();
    ctx.setLineDash([2, 3]);
    const vPeak = buildSplSeriesVertices(
      hist.timeSec,
      hist.peakDb,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      0.45
    );
    drawCanvasTrace(ctx, vPeak.vertices, vPeak.vertexCount, src.color, box);

    ctx.setLineDash([5, 3]);
    const vLeq1 = buildSplSeriesVertices(
      hist.timeSec,
      hist.leq1mDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      0.75
    );
    drawCanvasTrace(ctx, vLeq1.vertices, vLeq1.vertexCount, src.color, box);
    ctx.setLineDash([]);
    ctx.restore();

    const vLeq15 = buildSplSeriesVertices(
      hist.timeSec,
      hist.leq15mDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      1.0
    );
    drawCanvasTrace(ctx, vLeq15.vertices, vLeq15.vertexCount, src.color, box);
  }
}

/**
 * Draws collision-avoiding acoustic feedback & ringing callout flags on RTA / Magnitude charts.
 */
export function drawFeedbackCalloutFlags(
  ctx: CanvasRenderingContext2D,
  sources: readonly SourceData[],
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { plotLeft, plotTop, plotW, plotH } = box;
  const { xMin, xMax } = bounds;

  const allTracks: DetectedFeedbackTrack[] = [];
  for (const src of sources) {
    if (src.feedbackTracks && src.feedbackTracks.length > 0) {
      allTracks.push(...src.feedbackTracks);
    }
  }
  if (allTracks.length === 0) return;

  const stateRank = (s: DetectedFeedbackTrack['state']): number =>
    s === 'feedback' ? 3 : s === 'ringing' ? 2 : 1;

  allTracks.sort((a, b) => {
    const r = stateRank(b.state) - stateRank(a.state);
    return r !== 0 ? r : b.prominenceDb - a.prominenceDb;
  });

  const visibleTracks = allTracks.slice(0, MAX_VISIBLE_CALLOUT_FLAGS);
  const occupiedBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];

  ctx.save();
  for (const track of visibleTracks) {
    if (track.frequencyHz < xMin || track.frequencyHz > xMax) continue;
    const normX = valueToNormX(track.frequencyHz, xMin, xMax, true);
    const px = plotLeft + normX * plotW;

    const alpha =
      track.state === 'latched'
        ? Math.max(0.25, 0.85 * track.latchRemainingRatio)
        : 0.95;
    const accentColor =
      track.state === 'feedback'
        ? '#ef4444'
        : track.state === 'ringing'
          ? '#f59e0b'
          : '#94a3b8';
    const icon =
      track.state === 'feedback' ? '◆' : track.state === 'ringing' ? '▲' : '●';

    // 1. Vertical marker line
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = track.state === 'feedback' ? 1.5 : 1.15;
    if (track.state === 'ringing') {
      ctx.setLineDash([5, 3]);
    } else if (track.state === 'latched') {
      ctx.setLineDash([2, 3]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(px, plotTop);
    ctx.lineTo(px, plotTop + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Collision-avoiding top callout pill
    const freqText =
      track.frequencyHz >= 1000
        ? `${(track.frequencyHz / 1000).toFixed(2)} kHz`
        : `${Math.round(track.frequencyHz)} Hz`;
    const line1 = `${icon} ${freqText} (ISO ${track.isoBandLabel})`;
    const line2 = `+${track.prominenceDb.toFixed(1)}dB • Q≈${Math.round(track.estimatedQ)} • ${track.musicalNote.split(' ')[0]} • ${track.slotName}`;

    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w1 = ctx.measureText(line1).width;
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w2 = ctx.measureText(line2).width;
    const pillW = Math.max(w1, w2) + 14;
    const pillH = 28;

    let pillLeft = Math.max(
      plotLeft + 4,
      Math.min(plotLeft + plotW - pillW - 4, px - pillW * 0.5)
    );
    let pillTop = plotTop + 6;

    // Shift downward if overlapping an existing higher-priority pill
    for (let attempt = 0; attempt < 4; attempt++) {
      const overlaps = occupiedBoxes.some(
        (b) =>
          pillLeft < b.right + 4 &&
          pillLeft + pillW > b.left - 4 &&
          pillTop < b.bottom + 3 &&
          pillTop + pillH > b.top - 3
      );
      if (!overlaps) break;
      pillTop += pillH + 4;
    }

    occupiedBoxes.push({
      left: pillLeft,
      right: pillLeft + pillW,
      top: pillTop,
      bottom: pillTop + pillH,
    });

    ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.rect(pillLeft, pillTop, pillW, pillH);
    ctx.fill();
    ctx.stroke();

    // Slot color indicator bar on left edge of pill
    ctx.fillStyle = track.slotColor;
    ctx.fillRect(pillLeft, pillTop, 3, pillH);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(line1, pillLeft + 7, pillTop + 3);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(line2, pillLeft + 7, pillTop + 15);
  }
  ctx.restore();
}


