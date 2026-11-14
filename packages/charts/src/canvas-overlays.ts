// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Interactive 2D Canvas overlays for `@foh/charts`:
 * - Draggable parametric EQ band handles (`referenceZeroDbY`-aware for both 0 dB TF and absolute SPL plots)
 * - Collision-avoiding acoustic feedback/ringing callout flags
 * - Floating canvas cursor HUD pill with curve tracking dots and right-edge flip
 */

import type {
  CalloutFlag,
  ChartAxisBounds,
  ChartPlotBox,
  CursorReadoutModel,
  EqHandleBand,
  InteractiveEqOverlay,
} from './chart-scene-types.js';
import { normXToValue, valueToNormX, valueToNormY } from './coord-math.js';

function getBandFrequencyHz(band: EqHandleBand): number {
  return 'frequencyHz' in band ? band.frequencyHz : band.frequency;
}

export function drawEqHandles(
  ctx: CanvasRenderingContext2D,
  overlay: InteractiveEqOverlay,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { left, top, width, height } = box;
  const { xMin, xMax, yMin, yMax } = bounds;
  const refZeroY = overlay.referenceZeroDbY;

  if (Math.abs(refZeroY) > 1e-4) {
    const refPy = top + (1.0 - valueToNormY(refZeroY, yMin, yMax)) * height;
    if (refPy >= top && refPy <= top + height) {
      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(left, refPy);
      ctx.lineTo(left + width, refPy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  overlay.bands.forEach((b, idx) => {
    if (b.enabled === false) return;
    const px = left + valueToNormX(getBandFrequencyHz(b), xMin, xMax, true) * width;
    const targetY = refZeroY + (b.gainDb ?? 0);
    const py = top + (1.0 - valueToNormY(targetY, yMin, yMax)) * height;

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

export function findHitEqBandIndex(
  relX: number,
  relY: number,
  plotW: number,
  plotH: number,
  bands: readonly EqHandleBand[],
  bounds: ChartAxisBounds,
  referenceZeroDbY: number = 0,
  hitRadiusPx: number = 12
): number | null {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.enabled === false) continue;
    const bx = valueToNormX(getBandFrequencyHz(b), bounds.xMin, bounds.xMax, true) * plotW;
    const targetY = referenceZeroDbY + (b.gainDb ?? 0);
    const by = (1.0 - valueToNormY(targetY, bounds.yMin, bounds.yMax)) * plotH;
    if (Math.hypot(relX - bx, relY - by) <= hitRadiusPx) {
      return i;
    }
  }
  return null;
}

export function computeDraggedEqBand(
  relX: number,
  relY: number,
  plotW: number,
  plotH: number,
  bounds: ChartAxisBounds,
  referenceZeroDbY: number = 0
): { readonly frequency: number; readonly gainDb: number } {
  const normX = Math.max(0.01, Math.min(0.99, relX / Math.max(1, plotW)));
  const normY = Math.max(0.0, Math.min(1.0, 1.0 - relY / Math.max(1, plotH)));
  const frequency = Math.round(normXToValue(normX, bounds.xMin, bounds.xMax, true));
  const domainY = bounds.yMin + normY * (bounds.yMax - bounds.yMin);
  const rawGainDb = domainY - referenceZeroDbY;
  const gainDb = Math.round(Math.max(-18, Math.min(18, rawGainDb)) * 2) / 2;
  return { frequency, gainDb };
}

export function drawCalloutFlags(
  ctx: CanvasRenderingContext2D,
  flags: readonly CalloutFlag[],
  isLogX: boolean,
  bounds: ChartAxisBounds,
  box: ChartPlotBox,
  maxVisible: number = 5
): void {
  if (flags.length === 0) return;
  const { left, top, width, height } = box;
  const { xMin, xMax } = bounds;

  const visibleFlags = flags.slice(0, maxVisible);
  const occupiedBoxes: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];

  ctx.save();
  for (const flag of visibleFlags) {
    if (flag.x < xMin || flag.x > xMax) continue;
    const normX = valueToNormX(flag.x, xMin, xMax, isLogX);
    const px = left + normX * width;

    ctx.globalAlpha = flag.opacity;
    ctx.strokeStyle = flag.accentColor;
    ctx.lineWidth = flag.state === 'feedback' ? 1.5 : 1.15;
    if (flag.state === 'ringing') {
      ctx.setLineDash([5, 3]);
    } else if (flag.state === 'latched') {
      ctx.setLineDash([2, 3]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, top + height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w1 = ctx.measureText(flag.line1).width;
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w2 = ctx.measureText(flag.line2).width;
    const pillW = Math.max(w1, w2) + 14;
    const pillH = 28;

    const pillLeft = Math.max(
      left + 4,
      Math.min(left + width - pillW - 4, px - pillW * 0.5)
    );
    let pillTop = top + 6;

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
    ctx.strokeStyle = flag.accentColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.rect(pillLeft, pillTop, pillW, pillH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = flag.badgeColor;
    ctx.fillRect(pillLeft, pillTop, 3, pillH);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(flag.line1, pillLeft + 7, pillTop + 3);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(flag.line2, pillLeft + 7, pillTop + 15);
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

export function drawFloatingCursorHud(
  ctx: CanvasRenderingContext2D,
  readout: CursorReadoutModel,
  isLogX: boolean,
  bounds: ChartAxisBounds,
  box: ChartPlotBox
): void {
  const { left, top, width, height } = box;
  const { xMin, xMax, yMin, yMax } = bounds;

  const normX = valueToNormX(readout.domainX, xMin, xMax, isLogX);
  if (normX < 0 || normX > 1) return;
  const cursorPx = left + normX * width;

  ctx.save();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cursorPx, top);
  ctx.lineTo(cursorPx, top + height);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const row of readout.rows) {
    if (row.highlightDomainY === undefined || !Number.isFinite(row.highlightDomainY)) {
      continue;
    }
    const ny = valueToNormY(row.highlightDomainY, yMin, yMax);
    const py = top + (1.0 - ny) * height;
    if (py >= top && py <= top + height) {
      ctx.fillStyle = row.color ?? '#38bdf8';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cursorPx, py, 3.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  let maxW = ctx.measureText(readout.headerText).width;
  if (readout.subHeaderText) {
    maxW = Math.max(maxW, ctx.measureText(readout.subHeaderText).width);
  }
  for (const r of readout.rows) {
    const w = ctx.measureText(r.text).width + (r.color ? 12 : 0);
    if (w > maxW) maxW = w;
  }

  const padX = 8;
  const padY = 5;
  const lineH = 14;
  const headerLineCount = readout.subHeaderText ? 2 : 1;
  const totalLines = headerLineCount + readout.rows.length;
  const pillW = Math.ceil(maxW + padX * 2);
  const pillH = padY * 2 + totalLines * lineH - 2;

  const placeLeft = cursorPx + 10 + pillW > left + width - 4;
  const px = placeLeft
    ? Math.max(left + 4, cursorPx - 10 - pillW)
    : Math.min(left + width - pillW - 4, cursorPx + 10);
  const py = top + 6;

  ctx.fillStyle = 'rgba(6, 9, 17, 0.90)';
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(px, py, pillW, pillH, 4);
  } else {
    ctx.rect(px, py, pillW, pillH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(readout.headerText, px + padX, py + padY + lineH * 0.45);

  if (readout.subHeaderText) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(readout.subHeaderText, px + padX, py + padY + lineH * 1.45);
  }

  for (let i = 0; i < readout.rows.length; i++) {
    const row = readout.rows[i];
    const ry = py + padY + (headerLineCount + i) * lineH + lineH * 0.45;
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
