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
 * HiDPI 2D Canvas CAD Overlay Painter (`src/viewport/canvas-cad-painter.ts`) for
 * Plan View (X-Y) and Side Section View (X-Z).
 */

import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { ColormapConfig, SelectedEntity } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import { computeSpeedOfSoundMpS } from '../physics/atmosphere.js';
import { expandSubwooferArray } from '../physics/sub-array-designer.js';
import { DEG_TO_RAD, DEFAULT_GROUND_REFLECTOR } from '../physics/transform3d.js';
import type { VirtualMicResponse } from '../physics/virtual-mic-solver.js';
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

export interface CadPaintOptions {
  readonly mode: ViewportMode;
  readonly scene: ProjectScene;
  readonly speakerMap: ReadonlyMap<string, SpeakerDefinition>;
  readonly selected: SelectedEntity | null;
  readonly virtualMicResponses: readonly VirtualMicResponse[];
  readonly camera: ViewportCamera2D;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly ruler: RulerOverlayState | null;
  readonly colormap?: ColormapConfig;
  readonly effectiveSplRange?: { readonly minSplDb: number; readonly maxSplDb: number };
}

const AIM_HANDLE_LENGTH_M = 3.2;

export function getAimHandleWorldPoint(
  mode: ViewportMode,
  pos: { x: number; y: number; z: number },
  orientation: { azimuthDeg: number; tiltDeg: number }
): WorldPoint2D {
  if (mode === 'plan') {
    const az = orientation.azimuthDeg * DEG_TO_RAD;
    return {
      u: pos.x + Math.cos(az) * AIM_HANDLE_LENGTH_M,
      v: pos.y + Math.sin(az) * AIM_HANDLE_LENGTH_M,
    };
  }
  const tilt = orientation.tiltDeg * DEG_TO_RAD;
  return {
    u: pos.x + Math.cos(tilt) * AIM_HANDLE_LENGTH_M,
    v: pos.z + Math.sin(tilt) * AIM_HANDLE_LENGTH_M,
  };
}

export function paintViewportCadOverlay(
  ctx: CanvasRenderingContext2D,
  opts: CadPaintOptions
): void {
  const { mode, scene, speakerMap, selected, virtualMicResponses, camera, cssWidth, cssHeight } =
    opts;
  if (cssWidth <= 0 || cssHeight <= 0) return;

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const groupColors = new Map<string, string>();
  for (const g of scene.dspGroups) {
    groupColors.set(g.id, g.color);
  }
  const micSplMap = new Map<string, number>();
  for (const mr of virtualMicResponses) {
    micSplMap.set(mr.micId, mr.broadbandSplADb);
  }

  // 1. Metric Grid
  drawMetricGrid(ctx, camera, cssWidth, cssHeight, mode);

  // 2. Ground Datum (Section View) or Centerline + Slice Line (Plan View)
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
  } else {
    // Section slice plane line in Plan view
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
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.beginPath();
    ctx.roundRect(cssWidth - tw - 10, pSlice.py - 10, tw, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#bae6fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cssWidth - tw * 0.5 - 10, pSlice.py);
    ctx.restore();
  }

  // 3. Audience & Stage Surfaces
  drawSurfaces(ctx, opts);

  // 4. Subwoofer Arrays
  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  for (const sa of scene.subArrays) {
    const isSel = selected?.kind === 'sub-array' && selected.id === sa.id;
    const color = groupColors.get(sa.dspGroupId) ?? '#f59e0b';
    const cabs = expandSubwooferArray(sa, c);
    const spk = speakerMap.get(sa.speakerId);
    const cabW = spk?.dimensionsMeters.width ?? 0.6;
    const cabD = spk?.dimensionsMeters.depth ?? 0.7;
    const cabH = spk?.dimensionsMeters.height ?? 0.65;

    for (const cab of cabs) {
      const p = worldToScreen(
        camera,
        cssWidth,
        cssHeight,
        cab.position.x,
        mode === 'plan' ? cab.position.y : cab.position.z
      );
      ctx.save();
      ctx.translate(p.px, p.py);
      if (mode === 'plan') {
        ctx.rotate(-cab.orientation.azimuthDeg * DEG_TO_RAD);
      }
      const wPx = Math.max(6, cabD * camera.pixelsPerMeter);
      const hPx = Math.max(6, (mode === 'plan' ? cabW : cabH) * camera.pixelsPerMeter);

      ctx.fillStyle = cab.invertPolarity ? 'rgba(239, 68, 68, 0.4)' : 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = cab.invertPolarity ? '#f87171' : color;
      ctx.lineWidth = isSel ? 2 : 1.25;
      ctx.fillRect(-wPx * 0.5, -hPx * 0.5, wPx, hPx);
      ctx.strokeRect(-wPx * 0.5, -hPx * 0.5, wPx, hPx);

      // Grille tick on local +X edge
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wPx * 0.5, -hPx * 0.4);
      ctx.lineTo(wPx * 0.5, hPx * 0.4);
      ctx.stroke();
      ctx.restore();
    }

    // Sub Array origin handle
    const originScr = worldToScreen(
      camera,
      cssWidth,
      cssHeight,
      sa.origin.x,
      mode === 'plan' ? sa.origin.y : sa.origin.z
    );
    ctx.save();
    if (isSel) {
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(originScr.px, originScr.py, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(originScr.px, originScr.py, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#fde68a';
    ctx.textBaseline = 'bottom';
    const modeTag =
      sa.mode === 'cardioid-csa'
        ? 'CSA'
        : sa.mode === 'end-fire'
          ? 'EF'
          : sa.mode === 'delay-arc'
            ? 'ARC'
            : 'BS';
    const saLabel = `${sa.name} [${sa.boxCount}× ${modeTag}]${sa.muted ? ' (M)' : ''}`;
    const saTw = ctx.measureText(saLabel).width;
    const saPlaceLeft = originScr.px + 9 + saTw > cssWidth - 6;
    ctx.textAlign = saPlaceLeft ? 'right' : 'left';
    const saLx = saPlaceLeft
      ? Math.max(saTw + 6, originScr.px - 9)
      : Math.max(6, originScr.px + 9);
    const saLy = Math.max(14, Math.min(cssHeight - 8, originScr.py - 6));
    ctx.fillText(saLabel, saLx, saLy);
    ctx.restore();
  }

  // 5. Point Sources (+ Mirrored Counterparts)
  for (const ps of scene.pointSources) {
    const isSel = selected?.kind === 'point-source' && selected.id === ps.id;
    const color = groupColors.get(ps.dspGroupId) ?? '#38bdf8';
    const spk = speakerMap.get(ps.speakerId);

    // Draw mirrored twin first (subtle dashed style)
    if (ps.mirrorLeftRight && Math.abs(ps.position.y) > 1e-3 && mode === 'plan') {
      drawSinglePointSourceGlyph(ctx, {
        mode,
        camera,
        cssWidth,
        cssHeight,
        position: { x: ps.position.x, y: -ps.position.y, z: ps.position.z },
        orientation: {
          azimuthDeg: -ps.orientation.azimuthDeg,
          tiltDeg: ps.orientation.tiltDeg,
          rollDeg: -ps.orientation.rollDeg,
        },
        speaker: spk,
        color,
        label: `${ps.name} (R)`,
        isSelected: false,
        isMirroredTwin: true,
        muted: ps.muted,
      });
    }

    drawSinglePointSourceGlyph(ctx, {
      mode,
      camera,
      cssWidth,
      cssHeight,
      position: ps.position,
      orientation: ps.orientation,
      speaker: spk,
      color,
      label: ps.name,
      isSelected: isSel,
      isMirroredTwin: false,
      muted: ps.muted,
    });
  }

  // 6. Virtual Microphones
  for (const mic of scene.virtualMics) {
    if (!mic.enabled) continue;
    const isSel = selected?.kind === 'virtual-mic' && selected.id === mic.id;
    const p = worldToScreen(
      camera,
      cssWidth,
      cssHeight,
      mic.position.x,
      mode === 'plan' ? mic.position.y : mic.position.z
    );
    ctx.save();
    if (isSel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 11, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = mic.color;
    ctx.lineWidth = 2.25;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Crosshair dot
    ctx.fillStyle = mic.color;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 2.2, 0, Math.PI * 2);
    ctx.fill();

    const splVal = micSplMap.get(mic.id);
    const badge =
      splVal !== undefined && splVal > -100
        ? `${mic.name} · ${splVal.toFixed(1)} dBA`
        : mic.name;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    const bw = ctx.measureText(badge).width + 10;
    const bh = 19;
    const bx = p.px + 9 + bw <= cssWidth - 6 ? p.px + 9 : Math.max(6, p.px - 9 - bw);
    const by = Math.max(6, Math.min(cssHeight - bh - 6, p.py - 10));
    ctx.fillStyle = 'rgba(6, 9, 17, 0.88)';
    ctx.strokeStyle = mic.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge, bx + 5, by + bh * 0.5);
    ctx.restore();
  }

  // 7. Interactive Ruler Overlay
  if (opts.ruler) {
    drawRulerOverlay(ctx, opts.ruler, camera, cssWidth, cssHeight, c);
  }

  // 8. On-Viewport SPL Colorbar Legend
  if (opts.colormap && opts.effectiveSplRange) {
    drawColormapLegendBar(ctx, opts.colormap, opts.effectiveSplRange, cssWidth, cssHeight);
  }
}

function drawMetricGrid(
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

function drawSurfaces(ctx: CanvasRenderingContext2D, opts: CadPaintOptions): void {
  const { mode, scene, selected, camera, cssWidth, cssHeight } = opts;

  for (const surf of scene.surfaces) {
    if (!surf.enabled) continue;
    const isSel = selected?.kind === 'surface' && selected.id === surf.id;
    const isStage = surf.role === 'stage';

    if (mode === 'plan') {
      const hw0 = surf.widthStart * 0.5;
      const hw1 = surf.widthEnd * 0.5;
      const c0 = worldToScreen(camera, cssWidth, cssHeight, surf.xStart, surf.yCenter + hw0);
      const c1 = worldToScreen(camera, cssWidth, cssHeight, surf.xEnd, surf.yCenter + hw1);
      const c2 = worldToScreen(camera, cssWidth, cssHeight, surf.xEnd, surf.yCenter - hw1);
      const c3 = worldToScreen(camera, cssWidth, cssHeight, surf.xStart, surf.yCenter - hw0);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(c0.px, c0.py);
      ctx.lineTo(c1.px, c1.py);
      ctx.lineTo(c2.px, c2.py);
      ctx.lineTo(c3.px, c3.py);
      ctx.closePath();

      if (isStage) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.fill();
        ctx.strokeStyle = isSel ? '#fde047' : 'rgba(245, 158, 11, 0.85)';
      } else {
        ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(226, 232, 240, 0.82)';
      }
      ctx.lineWidth = isSel ? 2.4 : 1.5;
      ctx.stroke();

      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = isStage ? '#fcd34d' : '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(surf.name, c0.px + 6, c0.py + 5);
      ctx.restore();
    } else {
      // Side Section View: draw solid deck profile + dashed ear-height line
      const sliceOffset = Math.abs(scene.sectionBounds.sliceYM - surf.yCenter);
      const maxHalfWidth = Math.max(surf.widthStart, surf.widthEnd) * 0.5;
      const inSlice = sliceOffset <= maxHalfWidth + 1e-4;

      const d0 = worldToScreen(camera, cssWidth, cssHeight, surf.xStart, surf.zStart);
      const d1 = worldToScreen(camera, cssWidth, cssHeight, surf.xEnd, surf.zEnd);
      const e0 = worldToScreen(
        camera,
        cssWidth,
        cssHeight,
        surf.xStart,
        surf.zStart + surf.earHeightM
      );
      const e1 = worldToScreen(
        camera,
        cssWidth,
        cssHeight,
        surf.xEnd,
        surf.zEnd + surf.earHeightM
      );

      ctx.save();
      ctx.globalAlpha = inSlice ? 1.0 : 0.4;

      // Deck line
      ctx.strokeStyle = isStage ? '#f59e0b' : isSel ? '#ffffff' : '#cbd5e1';
      ctx.lineWidth = isSel ? 3 : 2.2;
      ctx.beginPath();
      ctx.moveTo(d0.px, d0.py);
      ctx.lineTo(d1.px, d1.py);
      ctx.stroke();

      // Ear-height listening line
      ctx.strokeStyle = isStage ? 'rgba(251, 191, 36, 0.7)' : 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(e0.px, e0.py);
      ctx.lineTo(e1.px, e1.py);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = isStage ? '#fcd34d' : '#bae6fd';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${surf.name} (+${surf.earHeightM.toFixed(2)}m)`, e0.px + 4, e0.py - 3);
      ctx.restore();
    }
  }
}

function drawSinglePointSourceGlyph(
  ctx: CanvasRenderingContext2D,
  params: {
    mode: ViewportMode;
    camera: ViewportCamera2D;
    cssWidth: number;
    cssHeight: number;
    position: { x: number; y: number; z: number };
    orientation: { azimuthDeg: number; tiltDeg: number; rollDeg: number };
    speaker: SpeakerDefinition | undefined;
    color: string;
    label: string;
    isSelected: boolean;
    isMirroredTwin: boolean;
    muted: boolean;
  }
): void {
  const { mode, camera, cssWidth, cssHeight, position, orientation, speaker, color } = params;
  const p = worldToScreen(
    camera,
    cssWidth,
    cssHeight,
    position.x,
    mode === 'plan' ? position.y : position.z
  );
  const aimAngleDeg = mode === 'plan' ? orientation.azimuthDeg : orientation.tiltDeg;
  const isRolled90 = Math.abs(Math.abs(orientation.rollDeg) - 90) < 45;
  const nominalBeamDeg = speaker
    ? mode === 'plan'
      ? isRolled90
        ? speaker.nominalDispersionDeg.vertical
        : speaker.nominalDispersionDeg.horizontal
      : isRolled90
        ? speaker.nominalDispersionDeg.horizontal
        : speaker.nominalDispersionDeg.vertical
    : 80;

  ctx.save();
  ctx.globalAlpha = params.muted ? 0.4 : params.isMirroredTwin ? 0.65 : 1.0;

  // Nominal -6 dB dispersion cone wedge (out to 6.5 m)
  if (!params.muted && nominalBeamDeg < 200) {
    const coneLenPx = 6.5 * camera.pixelsPerMeter;
    const centerScreenRad = -aimAngleDeg * DEG_TO_RAD;
    const halfSpread = (nominalBeamDeg * 0.5) * DEG_TO_RAD;

    ctx.beginPath();
    ctx.moveTo(p.px, p.py);
    ctx.arc(p.px, p.py, coneLenPx, centerScreenRad - halfSpread, centerScreenRad + halfSpread);
    ctx.closePath();
    ctx.fillStyle = params.isSelected
      ? 'rgba(56, 189, 248, 0.14)'
      : 'rgba(248, 250, 252, 0.05)';
    ctx.fill();
    ctx.strokeStyle = params.isSelected
      ? 'rgba(56, 189, 248, 0.55)'
      : 'rgba(248, 250, 252, 0.22)';
    ctx.lineWidth = 1;
    if (params.isMirroredTwin) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Aim vector & interactive Aim Handle (for primary instances)
  if (!params.isMirroredTwin) {
    const handleWorld = getAimHandleWorldPoint(mode, position, orientation);
    const hScr = worldToScreen(camera, cssWidth, cssHeight, handleWorld.u, handleWorld.v);

    ctx.strokeStyle = color;
    ctx.lineWidth = params.isSelected ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.moveTo(p.px, p.py);
    ctx.lineTo(hScr.px, hScr.py);
    ctx.stroke();

    ctx.fillStyle = params.isSelected ? '#ffffff' : color;
    ctx.strokeStyle = '#060911';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hScr.px, hScr.py, params.isSelected ? 5 : 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Trapezoidal Loudspeaker Enclosure Icon
  ctx.save();
  ctx.translate(p.px, p.py);
  ctx.rotate(-aimAngleDeg * DEG_TO_RAD);

  if (params.isSelected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -5);
  ctx.lineTo(6, -7.5);
  ctx.lineTo(6, 7.5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Label (clamped inside viewport bounds)
  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'bottom';
  const psLabel = `${params.label}${params.muted ? ' (M)' : ''}`;
  const psTw = ctx.measureText(psLabel).width;
  const placeLeft = p.px + 10 + psTw > cssWidth - 6;
  ctx.textAlign = placeLeft ? 'right' : 'left';
  const lx = placeLeft ? Math.max(psTw + 6, p.px - 10) : Math.max(6, p.px + 10);
  const ly = Math.max(14, Math.min(cssHeight - 8, p.py - 6));
  ctx.fillText(psLabel, lx, ly);

  ctx.restore();
}

function drawColormapLegendBar(
  ctx: CanvasRenderingContext2D,
  colormap: ColormapConfig,
  effectiveRange: { readonly minSplDb: number; readonly maxSplDb: number },
  cssWidth: number,
  cssHeight: number
): void {
  if (cssWidth < 220 || cssHeight < 95) return;

  const pillW = 172;
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
  ctx.roundRect(x, y, pillW, pillH, 5);
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

  // Draw subtle contour tick marks inside the legend bar when contours are active
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

function drawRulerOverlay(
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
  ctx.roundRect(midX - tw * 0.5, midY - 11, tw, 22, 5);
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

