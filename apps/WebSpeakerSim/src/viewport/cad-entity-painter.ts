// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * CAD entity glyph painters for Subwoofer Arrays, Point Sources (with nominal
 * dispersion cones and aim handles), and Virtual Measurement Microphones.
 */

import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { SelectedEntity } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import { expandSubwooferArray } from '../physics/sub-array-designer.js';
import { DEG_TO_RAD } from '../physics/transform3d.js';
import { traceRoundRect, type OccupiedPillRect, type ViewportMode } from './cad-grid-ruler.js';
import { worldToScreen, type ViewportCamera2D, type WorldPoint2D } from './viewport-coords.js';

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
  }
): void {
  const { mode, scene, speakerMap, selected, groupColors, camera, cssWidth, cssHeight } = params;

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
    const clampX = (x: number) => Math.max(6, Math.min(cssWidth - bw - 6, x));
    const clampY = (y: number) => Math.max(6, Math.min(cssHeight - bh - 6, y));
    const candidates = [
      { x: clampX(p.px + 9), y: clampY(p.py - 10), fitsRight: p.px + 9 + bw <= cssWidth - 6 },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py - 28), fitsRight: true },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py + 10), fitsRight: true },
      { x: clampX(p.px - 9 - bw), y: clampY(p.py - 10), fitsRight: true },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py - 48), fitsRight: true },
      { x: clampX(p.px - bw * 0.5), y: clampY(p.py + 30), fitsRight: true },
    ];
    const overlapsAny = (cx: number, cy: number) =>
      occupiedPills.some(
        (r) => cx < r.x + r.w && cx + bw > r.x && cy < r.y + r.h && cy + bh > r.y
      );
    const chosen =
      candidates.find((cnd) => cnd.fitsRight && !overlapsAny(cnd.x, cnd.y)) ?? candidates[1];
    const bx = chosen.x;
    const by = chosen.y;
    occupiedPills.push({ x: bx - 2, y: by - 2, w: bw + 4, h: bh + 4 });

    if (Math.abs(by + bh * 0.5 - p.py) > 13) {
      ctx.strokeStyle = mic.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(Math.max(bx + 4, Math.min(bx + bw - 4, p.px)), by < p.py ? by + bh : by);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    ctx.fillStyle = 'rgba(6, 9, 17, 0.88)';
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
