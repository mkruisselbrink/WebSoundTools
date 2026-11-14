// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Metric coordinate grid, ground/slice datum lines, interactive acoustic ruler,
 * and SPL colorbar legend painters for the 2D CAD viewport.
 */

import type { ColormapConfig } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import { DEFAULT_GROUND_REFLECTOR } from '../physics/transform3d.js';
import { evaluateSplLutRgb } from './gl-heatmap-renderer.js';
import {
  chooseMetricGridStepM,
  screenToWorld,
  worldToScreen,
  type ViewportCamera2D,
  type WorldPoint2D,
} from './viewport-coords.js';

export type ViewportMode = 'plan' | 'section';

export interface RulerOverlayState {
  readonly start: WorldPoint2D;
  readonly end: WorldPoint2D;
}

export interface OccupiedPillRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

export function drawMetricGrid(
  ctx: CanvasRenderingContext2D,
  camera: ViewportCamera2D,
  cssWidth: number,
  cssHeight: number,
  mode: ViewportMode
): void {
  const step = chooseMetricGridStepM(camera.pixelsPerMeter);
  const topLeft = screenToWorld(camera, cssWidth, cssHeight, 0, 0);
  const botRight = screenToWorld(camera, cssWidth, cssHeight, cssWidth, cssHeight);

  const uStart = Math.floor(topLeft.u / step) * step;
  const uEnd = Math.ceil(botRight.u / step) * step;
  const vStart = Math.floor(botRight.v / step) * step;
  const vEnd = Math.ceil(topLeft.v / step) * step;

  ctx.save();
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  for (let u = uStart; u <= uEnd + 1e-6; u += step) {
    const px = worldToScreen(camera, cssWidth, cssHeight, u, 0).px;
    const isZero = Math.abs(u) < 1e-5;
    ctx.strokeStyle = isZero ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = isZero ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, cssHeight);
    ctx.stroke();

    ctx.fillStyle = 'rgba(203, 213, 225, 0.72)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${formatMeterTick(u)}m`, px, cssHeight - 4);
  }

  for (let v = vStart; v <= vEnd + 1e-6; v += step) {
    const py = worldToScreen(camera, cssWidth, cssHeight, 0, v).py;
    const isZero = Math.abs(v) < 1e-5;
    ctx.strokeStyle = isZero ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = isZero ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(cssWidth, py);
    ctx.stroke();

    ctx.fillStyle = 'rgba(203, 213, 225, 0.72)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const prefix = mode === 'section' ? 'Z ' : '';
    ctx.fillText(`${prefix}${formatMeterTick(v)}m`, 6, py);
  }

  ctx.restore();
}

export function drawDatumOrSliceLine(
  ctx: CanvasRenderingContext2D,
  scene: ProjectScene,
  camera: ViewportCamera2D,
  cssWidth: number,
  cssHeight: number,
  mode: ViewportMode,
  occupiedPills: OccupiedPillRect[]
): void {
  if (mode === 'section') {
    const groundRef = scene.reflectors.find((r) => r.id === DEFAULT_GROUND_REFLECTOR.id);
    const y0 = worldToScreen(camera, cssWidth, cssHeight, 0, 0).py;
    ctx.save();
    ctx.strokeStyle = groundRef?.enabled ? 'rgba(16, 185, 129, 0.7)' : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = groundRef?.enabled ? 2 : 1;
    if (!groundRef?.enabled) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(cssWidth, y0);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const sliceY = scene.sectionBounds.sliceYM;
  const pSlice = worldToScreen(camera, cssWidth, cssHeight, 0, sliceY);
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(0, pSlice.py);
  ctx.lineTo(cssWidth, pSlice.py);
  ctx.stroke();
  ctx.setLineDash([]);

  const label = `Section Y = ${sliceY.toFixed(1)} m`;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  const tw = ctx.measureText(label).width + 12;
  const sx = cssWidth - tw - 10;
  const sy = pSlice.py - 10;
  occupiedPills.push({ x: sx - 3, y: sy - 2, w: tw + 6, h: 24 });
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
  ctx.beginPath();
  traceRoundRect(ctx, sx, sy, tw, 20, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#bae6fd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cssWidth - tw * 0.5 - 10, pSlice.py);
  ctx.restore();
}

export function drawColormapLegendBar(
  ctx: CanvasRenderingContext2D,
  colormap: ColormapConfig,
  effectiveRange: { readonly minSplDb: number; readonly maxSplDb: number },
  cssWidth: number,
  cssHeight: number
): void {
  if (cssWidth < 240 || cssHeight < 95) return;

  const pillW = 200;
  const pillH = 34;
  const x = cssWidth - pillW - 10;
  const y = cssHeight - pillH - 18;
  const barX = x + 9;
  const barY = y + 6;
  const barW = pillW - 18;
  const barH = 9;

  const minDb = effectiveRange.minSplDb;
  const maxDb = Math.max(minDb + 0.5, effectiveRange.maxSplDb);
  const spanDb = maxDb - minDb;
  const iso = colormap.isolineStepDb;

  ctx.save();
  ctx.fillStyle = 'rgba(6, 9, 17, 0.88)';
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.92)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  traceRoundRect(ctx, x, y, pillW, pillH, 5);
  ctx.fill();
  ctx.stroke();

  const slices = 76;
  const sliceW = barW / slices;
  for (let i = 0; i < slices; i++) {
    const f = (i + 0.5) / slices;
    let spl = minDb + f * spanDb;
    if (colormap.stepped) {
      const bStep = iso > 0 ? iso : 1.5;
      spl = Math.floor(spl / bStep) * bStep + 0.5 * bStep;
    }
    const normT = Math.max(0, Math.min(1, (spl - minDb) / spanDb));
    const [r, g, b] = evaluateSplLutRgb(normT, colormap.palette);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(barX + i * sliceW, barY, Math.ceil(sliceW + 0.5), barH);
  }

  if (iso > 0 && spanDb / iso <= 40) {
    const firstIso = Math.ceil((minDb + 1e-4) / iso) * iso;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = 1;
    for (let db = firstIso; db < maxDb - 1e-4; db += iso) {
      const tx = barX + ((db - minDb) / spanDb) * barW;
      ctx.beginPath();
      ctx.moveTo(tx, barY);
      ctx.lineTo(tx, barY + barH);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(barX, barY, barW, barH);

  const midDb = 0.5 * (minDb + maxDb);
  const fmtDb = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  ctx.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#cbd5e1';
  ctx.textBaseline = 'bottom';

  ctx.textAlign = 'left';
  ctx.fillText(`${fmtDb(minDb)}`, barX, y + pillH - 4);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    iso > 0 ? `${fmtDb(midDb)} (${iso}dB)` : `${fmtDb(midDb)}`,
    barX + barW * 0.5,
    y + pillH - 4
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`${fmtDb(maxDb)} dB`, barX + barW, y + pillH - 4);

  ctx.restore();
}

export function drawRulerOverlay(
  ctx: CanvasRenderingContext2D,
  ruler: RulerOverlayState,
  camera: ViewportCamera2D,
  cssWidth: number,
  cssHeight: number,
  speedOfSoundMpS: number
): void {
  const s0 = worldToScreen(camera, cssWidth, cssHeight, ruler.start.u, ruler.start.v);
  const s1 = worldToScreen(camera, cssWidth, cssHeight, ruler.end.u, ruler.end.v);
  const du = ruler.end.u - ruler.start.u;
  const dv = ruler.end.v - ruler.start.v;
  const distM = Math.hypot(du, dv);
  const flightMs = (distM / Math.max(250, speedOfSoundMpS)) * 1000;
  const angleDeg = (Math.atan2(dv, du) * 180) / Math.PI;

  ctx.save();
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(s0.px, s0.py);
  ctx.lineTo(s1.px, s1.py);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const pt of [s0, s1]) {
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(pt.px, pt.py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const label = `${distM.toFixed(2)} m · ${flightMs.toFixed(2)} ms · ${angleDeg.toFixed(1)}°`;
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const tw = ctx.measureText(label).width + 14;
  const midX = 0.5 * (s0.px + s1.px);
  const midY = 0.5 * (s0.py + s1.py) - 16;

  ctx.fillStyle = 'rgba(6, 9, 17, 0.92)';
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  traceRoundRect(ctx, midX - tw * 0.5, midY - 11, tw, 22, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fef08a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, midX, midY);
  ctx.restore();
}

function formatMeterTick(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
