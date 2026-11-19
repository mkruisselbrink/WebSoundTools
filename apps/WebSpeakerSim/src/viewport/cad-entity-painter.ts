// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * CAD entity glyph painters for Subwoofer Arrays, Point Sources (with nominal
 * dispersion cones and aim handles), and Virtual Measurement Microphones.
 */

import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { SelectedEntity } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import { formatMirroredSourceLabel } from '../physics/radiator-expander.js';
import { expandSubwooferArray } from '../physics/sub-array-designer.js';
import { DEG_TO_RAD } from '../physics/transform3d.js';
import { traceRoundRect, type OccupiedPillRect, type ViewportMode } from './cad-grid-ruler.js';
import { worldToScreen, type ViewportCamera2D, type WorldPoint2D } from './viewport-coords.js';

const AIM_HANDLE_LENGTH_M = 3.2;

function rectOverlapArea(
  x: number,
  y: number,
  w: number,
  h: number,
  occupied: readonly OccupiedPillRect[]
): number {
  let area = 0;
  for (const r of occupied) {
    const ox = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
    const oy = Math.min(y + h, r.y + r.h) - Math.max(y, r.y);
    if (ox > 0 && oy > 0) {
      area += ox * oy;
    }
  }
  return area;
}

function chooseBestRectPlacement(
  candidates: ReadonlyArray<{ readonly x: number; readonly y: number; readonly penalty?: number }>,
  w: number,
  h: number,
  occupied: readonly OccupiedPillRect[]
): { readonly x: number; readonly y: number } {
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const overlap = rectOverlapArea(c.x, c.y, w, h, occupied);
    const score = overlap + (c.penalty ?? 0);
    if (overlap === 0 && (c.penalty ?? 0) === 0) {
      return { x: c.x, y: c.y };
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return { x: best.x, y: best.y };
}

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

export function drawSubArrays(
  ctx: CanvasRenderingContext2D,
  params: {
    readonly mode: ViewportMode;
    readonly scene: ProjectScene;
    readonly speakerMap: ReadonlyMap<string, SpeakerDefinition>;
    readonly selected: SelectedEntity | null;
    readonly groupColors: ReadonlyMap<string, string>;
    readonly speedOfSoundMpS: number;
    readonly camera: ViewportCamera2D;
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly occupiedPills?: OccupiedPillRect[];
  }
): void {
  const {
    mode,
    scene,
    speakerMap,
    selected,
    groupColors,
    speedOfSoundMpS,
    camera,
    cssWidth,
    cssHeight,
    occupiedPills,
  } = params;

  for (const sa of scene.subArrays) {
    const isSel = selected?.kind === 'sub-array' && selected.id === sa.id;
    const color = groupColors.get(sa.dspGroupId) ?? '#f59e0b';
    const cabs = expandSubwooferArray(sa, speedOfSoundMpS);
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

      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wPx * 0.5, -hPx * 0.4);
      ctx.lineTo(wPx * 0.5, hPx * 0.4);
      ctx.stroke();
      ctx.restore();
    }

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
    occupiedPills?.push({
      x: originScr.px - 9,
      y: originScr.py - 9,
      w: 18,
      h: 18,
    });

    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
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
    const saTh = 13;
    const clampSaX = (x: number) => Math.max(6, Math.min(cssWidth - saTw - 6, x));
    const clampSaY = (y: number) => Math.max(4, Math.min(cssHeight - saTh - 4, y));
    const saCandidates = [
      { x: clampSaX(originScr.px + 10), y: clampSaY(originScr.py - 18) },
      { x: clampSaX(originScr.px + 10), y: clampSaY(originScr.py + 8) },
      { x: clampSaX(originScr.px - saTw - 10), y: clampSaY(originScr.py - 18), penalty: 6 },
      { x: clampSaX(originScr.px - saTw * 0.5), y: clampSaY(originScr.py + 16), penalty: 8 },
    ];
    const saPos = chooseBestRectPlacement(saCandidates, saTw, saTh, occupiedPills ?? []);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(6, 9, 17, 0.9)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(saLabel, saPos.x, saPos.y);
    ctx.fillStyle = '#fde68a';
    ctx.fillText(saLabel, saPos.x, saPos.y);
    occupiedPills?.push({ x: saPos.x - 2, y: saPos.y - 1, w: saTw + 4, h: saTh + 2 });
    ctx.restore();
  }
}

export function drawPointSources(
  ctx: CanvasRenderingContext2D,
  params: {
    readonly mode: ViewportMode;
    readonly scene: ProjectScene;
    readonly speakerMap: ReadonlyMap<string, SpeakerDefinition>;
    readonly selected: SelectedEntity | null;
    readonly groupColors: ReadonlyMap<string, string>;
    readonly camera: ViewportCamera2D;
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly occupiedPills?: OccupiedPillRect[];
  }
): void {
  const {
    mode,
    scene,
    speakerMap,
    selected,
    groupColors,
    camera,
    cssWidth,
    cssHeight,
    occupiedPills,
  } = params;

  for (const ps of scene.pointSources) {
    const isSel = selected?.kind === 'point-source' && selected.id === ps.id;
    const color = groupColors.get(ps.dspGroupId) ?? '#38bdf8';
    const spk = speakerMap.get(ps.speakerId);

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
        label: formatMirroredSourceLabel(ps.name),
        isSelected: false,
        isMirroredTwin: true,
        muted: ps.muted,
        occupiedPills,
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
      occupiedPills,
    });
  }
}

export function drawVirtualMics(
  ctx: CanvasRenderingContext2D,
  params: {
    readonly mode: ViewportMode;
    readonly scene: ProjectScene;
    readonly selected: SelectedEntity | null;
    readonly micSplMap: ReadonlyMap<string, number>;
    readonly camera: ViewportCamera2D;
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly occupiedPills: OccupiedPillRect[];
  }
): void {
  const { mode, scene, selected, micSplMap, camera, cssWidth, cssHeight, occupiedPills } = params;
  const activeMics = scene.virtualMics
    .filter((mic) => mic.enabled)
    .map((mic) => ({
      mic,
      isSel: selected?.kind === 'virtual-mic' && selected.id === mic.id,
      screen: worldToScreen(
        camera,
        cssWidth,
        cssHeight,
        mic.position.x,
        mode === 'plan' ? mic.position.y : mic.position.z
      ),
    }));

  // Pass 1: Draw all mic dots and reserve their circles in occupiedPills so no pill covers a mic dot
  for (const { mic, isSel, screen: p } of activeMics) {
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

    ctx.fillStyle = mic.color;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    occupiedPills.push({ x: p.px - 9, y: p.py - 9, w: 18, h: 18 });
  }

  // Pass 2: Place and draw all mic pills against all zones, speakers, sub arrays, and mic dots
  for (const { mic, screen: p } of activeMics) {
    ctx.save();
    const splVal = micSplMap.get(mic.id);
    const badge =
      splVal !== undefined && splVal > -100
        ? `${mic.name} · ${splVal.toFixed(1)} dBA`
        : mic.name;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    const bw = ctx.measureText(badge).width + 10;
    const bh = 19;
    const clampX = (x: number) => Math.max(6, Math.min(cssWidth - bw - 6, x));
    const clampY = (y: number) => Math.max(6, Math.min(cssHeight - bh - 6, y));
    const candidates = [
      { x: clampX(p.px + 11), y: clampY(p.py - bh * 0.5) },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py - bh - 11), penalty: 2 },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py + 11), penalty: 2 },
      { x: clampX(p.px - 11 - bw), y: clampY(p.py - bh * 0.5), penalty: 4 },
      { x: clampX(p.px + 10), y: clampY(p.py - bh - 10), penalty: 6 },
      { x: clampX(p.px + 10), y: clampY(p.py + 10), penalty: 6 },
      { x: clampX(p.px - bw - 10), y: clampY(p.py - bh - 10), penalty: 8 },
      { x: clampX(p.px - bw - 10), y: clampY(p.py + 10), penalty: 8 },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py - bh - 32), penalty: 12 },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py + 32), penalty: 12 },
    ];
    const chosen = chooseBestRectPlacement(candidates, bw, bh, occupiedPills);
    const bx = chosen.x;
    const by = chosen.y;
    occupiedPills.push({ x: bx - 3, y: by - 3, w: bw + 6, h: bh + 6 });

    const nearX = Math.max(bx, Math.min(bx + bw, p.px));
    const nearY = Math.max(by, Math.min(by + bh, p.py));
    const edgeDist = Math.hypot(nearX - p.px, nearY - p.py);
    if (edgeDist > 9) {
      const ux = (nearX - p.px) / edgeDist;
      const uy = (nearY - p.py) / edgeDist;
      ctx.strokeStyle = mic.color;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(p.px + ux * 7, p.py + uy * 7);
      ctx.lineTo(nearX, nearY);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    ctx.fillStyle = 'rgba(6, 9, 17, 0.90)';
    ctx.strokeStyle = mic.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    traceRoundRect(ctx, bx, by, bw, bh, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge, bx + 5, by + bh * 0.5);
    ctx.restore();
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
    occupiedPills?: OccupiedPillRect[];
  }
): void {
  const {
    mode,
    camera,
    cssWidth,
    cssHeight,
    position,
    orientation,
    speaker,
    color,
    occupiedPills,
  } = params;
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

  occupiedPills?.push({ x: p.px - 9, y: p.py - 9, w: 18, h: 18 });

  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
  const psLabel = `${params.label}${params.muted ? ' (M)' : ''}`;
  const psTw = ctx.measureText(psLabel).width;
  const psTh = 13;
  const clampPsX = (x: number) => Math.max(6, Math.min(cssWidth - psTw - 6, x));
  const clampPsY = (y: number) => Math.max(4, Math.min(cssHeight - psTh - 4, y));
  const psCandidates = [
    { x: clampPsX(p.px + 10), y: clampPsY(p.py - 18) },
    { x: clampPsX(p.px + 10), y: clampPsY(p.py + 8) },
    { x: clampPsX(p.px - psTw - 10), y: clampPsY(p.py - 18), penalty: 4 },
    { x: clampPsX(p.px - psTw * 0.5), y: clampPsY(p.py - 24), penalty: 6 },
    { x: clampPsX(p.px - psTw * 0.5), y: clampPsY(p.py + 12), penalty: 6 },
  ];
  const psPos = chooseBestRectPlacement(psCandidates, psTw, psTh, occupiedPills ?? []);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = 'rgba(6, 9, 17, 0.9)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(psLabel, psPos.x, psPos.y);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(psLabel, psPos.x, psPos.y);
  occupiedPills?.push({ x: psPos.x - 2, y: psPos.y - 1, w: psTw + 4, h: psTh + 2 });

  ctx.restore();
}
