// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Audience Listening Plane and Stage Rejection Zone painter for Plan and Section views.
 */

import type { SelectedEntity } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import type { OccupiedPillRect, ViewportMode } from './cad-grid-ruler.js';
import { worldToScreen, type ViewportCamera2D } from './viewport-coords.js';

export function drawSurfaces(
  ctx: CanvasRenderingContext2D,
  params: {
    readonly mode: ViewportMode;
    readonly scene: ProjectScene;
    readonly selected: SelectedEntity | null;
    readonly camera: ViewportCamera2D;
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly occupiedPills?: OccupiedPillRect[];
  }
): void {
  const { mode, scene, selected, camera, cssWidth, cssHeight, occupiedPills } = params;

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
      const tw = ctx.measureText(surf.name).width;
      const lx = Math.max(6, Math.min(cssWidth - tw - 6, c0.px + 6));
      const ly = Math.max(6, Math.min(cssHeight - 16, c0.py + 5));
      ctx.strokeStyle = 'rgba(6, 9, 17, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.strokeText(surf.name, lx, ly);
      ctx.fillStyle = isStage ? '#fcd34d' : '#e2e8f0';
      ctx.fillText(surf.name, lx, ly);
      occupiedPills?.push({ x: lx - 2, y: ly - 1, w: tw + 4, h: 13 });
      ctx.restore();
    } else {
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

      ctx.strokeStyle = isStage ? '#f59e0b' : isSel ? '#ffffff' : '#cbd5e1';
      ctx.lineWidth = isSel ? 3 : 2.2;
      ctx.beginPath();
      ctx.moveTo(d0.px, d0.py);
      ctx.lineTo(d1.px, d1.py);
      ctx.stroke();

      ctx.strokeStyle = isStage ? 'rgba(251, 191, 36, 0.7)' : 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(e0.px, e0.py);
      ctx.lineTo(e1.px, e1.py);
      ctx.stroke();
      ctx.setLineDash([]);

      const secLabel = `${surf.name} (+${surf.earHeightM.toFixed(2)}m)`;
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      const tw = ctx.measureText(secLabel).width;
      const lx = Math.max(6, Math.min(cssWidth - tw - 6, e0.px + 4));
      const ly = Math.max(15, Math.min(cssHeight - 6, e0.py - 3));
      ctx.strokeStyle = 'rgba(6, 9, 17, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.strokeText(secLabel, lx, ly);
      ctx.fillStyle = isStage ? '#fcd34d' : '#bae6fd';
      ctx.fillText(secLabel, lx, ly);
      occupiedPills?.push({ x: lx - 2, y: ly - 12, w: tw + 4, h: 13 });
      ctx.restore();
    }
  }
}
