// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Hit-testing and interactive drag/aim/pan/ruler gesture state machine for
 * Plan and Side Section viewports (`src/viewport/viewport-interaction.ts`).
 */

import type { ProjectStore } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import { RAD_TO_DEG } from '../physics/transform3d.js';
import {
  getAimHandleWorldPoint,
  type RulerOverlayState,
  type ViewportMode,
} from './canvas-cad-painter.js';
import {
  panCameraByPixels,
  screenToWorld,
  worldToScreen,
  type ViewportCamera2D,
  type WorldPoint2D,
} from './viewport-coords.js';

export type HitTarget =
  | { readonly kind: 'aim-handle'; readonly sourceId: string }
  | { readonly kind: 'point-source'; readonly id: string }
  | { readonly kind: 'sub-array'; readonly id: string }
  | { readonly kind: 'virtual-mic'; readonly id: string }
  | { readonly kind: 'slice-line' }
  | { readonly kind: 'surface'; readonly id: string };

export function hitTestViewport(
  mode: ViewportMode,
  scene: ProjectScene,
  camera: ViewportCamera2D,
  cssWidth: number,
  cssHeight: number,
  px: number,
  py: number
): HitTarget | null {
  const hitRadiusPx = 12;

  // 1. Point Source Aim Handles (highest priority for easy aiming)
  for (const ps of scene.pointSources) {
    const hw = getAimHandleWorldPoint(mode, ps.position, ps.orientation);
    const hs = worldToScreen(camera, cssWidth, cssHeight, hw.u, hw.v);
    if (Math.hypot(px - hs.px, py - hs.py) <= hitRadiusPx) {
      return { kind: 'aim-handle', sourceId: ps.id };
    }
  }

  // 2. Virtual Microphones
  for (const mic of scene.virtualMics) {
    if (!mic.enabled) continue;
    const ms = worldToScreen(
      camera,
      cssWidth,
      cssHeight,
      mic.position.x,
      mode === 'plan' ? mic.position.y : mic.position.z
    );
    if (Math.hypot(px - ms.px, py - ms.py) <= hitRadiusPx) {
      return { kind: 'virtual-mic', id: mic.id };
    }
  }

  // 3. Point Source Bodies
  for (const ps of scene.pointSources) {
    const ss = worldToScreen(
      camera,
      cssWidth,
      cssHeight,
      ps.position.x,
      mode === 'plan' ? ps.position.y : ps.position.z
    );
    if (Math.hypot(px - ss.px, py - ss.py) <= hitRadiusPx + 2) {
      return { kind: 'point-source', id: ps.id };
    }
  }

  // 4. Subwoofer Array Origins
  for (const sa of scene.subArrays) {
    const sas = worldToScreen(
      camera,
      cssWidth,
      cssHeight,
      sa.origin.x,
      mode === 'plan' ? sa.origin.y : sa.origin.z
    );
    if (Math.hypot(px - sas.px, py - sas.py) <= hitRadiusPx + 2) {
      return { kind: 'sub-array', id: sa.id };
    }
  }

  // 5. Section Slice Line (Plan View)
  if (mode === 'plan') {
    const sliceScr = worldToScreen(camera, cssWidth, cssHeight, 0, scene.sectionBounds.sliceYM);
    if (Math.abs(py - sliceScr.py) <= 7 && px > cssWidth - 150) {
      return { kind: 'slice-line' };
    }
  }

  // 6. Audience / Stage Surfaces (Plan View interior click)
  if (mode === 'plan') {
    const wp = screenToWorld(camera, cssWidth, cssHeight, px, py);
    for (let i = scene.surfaces.length - 1; i >= 0; i--) {
      const sf = scene.surfaces[i];
      if (!sf.enabled) continue;
      if (wp.u < sf.xStart || wp.u > sf.xEnd) continue;
      const t = (wp.u - sf.xStart) / Math.max(1e-6, sf.xEnd - sf.xStart);
      const hw = 0.5 * (sf.widthStart + (sf.widthEnd - sf.widthStart) * t);
      if (Math.abs(wp.v - sf.yCenter) <= hw) {
        return { kind: 'surface', id: sf.id };
      }
    }
  }

  return null;
}

type ActiveGesture =
  | { readonly kind: 'pan'; lastPx: number; lastPy: number }
  | { readonly kind: 'ruler'; start: WorldPoint2D }
  | { readonly kind: 'drag-point-source'; readonly id: string; readonly offsetU: number; readonly offsetV: number }
  | { readonly kind: 'aim-point-source'; readonly id: string }
  | { readonly kind: 'drag-sub-array'; readonly id: string; readonly offsetU: number; readonly offsetV: number }
  | { readonly kind: 'drag-mic'; readonly id: string; readonly offsetU: number; readonly offsetV: number }
  | { readonly kind: 'drag-slice' };

export class ViewportGestureController {
  private gesture: ActiveGesture | null = null;
  public rulerToolActive = false;
  public rulerOverlay: RulerOverlayState | null = null;

  constructor(
    private readonly mode: ViewportMode,
    private readonly store: ProjectStore,
    private readonly onCameraChange: (nextCam: ViewportCamera2D) => void,
    private readonly onOverlayDirty: () => void
  ) {}

  public get isDragging(): boolean {
    return this.gesture !== null;
  }

  public onPointerDown(
    ev: PointerEvent,
    camera: ViewportCamera2D,
    cssWidth: number,
    cssHeight: number,
    px: number,
    py: number
  ): void {
    const worldPt = screenToWorld(camera, cssWidth, cssHeight, px, py);

    if (this.rulerToolActive || ev.shiftKey) {
      this.gesture = { kind: 'ruler', start: worldPt };
      this.rulerOverlay = { start: worldPt, end: worldPt };
      this.onOverlayDirty();
      return;
    }

    if (ev.button === 1 || ev.altKey) {
      this.gesture = { kind: 'pan', lastPx: px, lastPy: py };
      return;
    }

    const hit = hitTestViewport(this.mode, this.store.scene, camera, cssWidth, cssHeight, px, py);

    if (!hit) {
      this.gesture = { kind: 'pan', lastPx: px, lastPy: py };
      return;
    }

    switch (hit.kind) {
      case 'aim-handle': {
        this.store.setSelection({ kind: 'point-source', id: hit.sourceId });
        this.gesture = { kind: 'aim-point-source', id: hit.sourceId };
        return;
      }
      case 'point-source': {
        this.store.setSelection({ kind: 'point-source', id: hit.id });
        const ps = this.store.scene.pointSources.find((p) => p.id === hit.id);
        if (!ps) return;
        const vCoord = this.mode === 'plan' ? ps.position.y : ps.position.z;
        this.gesture = {
          kind: 'drag-point-source',
          id: hit.id,
          offsetU: ps.position.x - worldPt.u,
          offsetV: vCoord - worldPt.v,
        };
        return;
      }
      case 'sub-array': {
        this.store.setSelection({ kind: 'sub-array', id: hit.id });
        const sa = this.store.scene.subArrays.find((s) => s.id === hit.id);
        if (!sa) return;
        const vCoord = this.mode === 'plan' ? sa.origin.y : sa.origin.z;
        this.gesture = {
          kind: 'drag-sub-array',
          id: hit.id,
          offsetU: sa.origin.x - worldPt.u,
          offsetV: vCoord - worldPt.v,
        };
        return;
      }
      case 'virtual-mic': {
        this.store.setSelection({ kind: 'virtual-mic', id: hit.id });
        const mic = this.store.scene.virtualMics.find((m) => m.id === hit.id);
        if (!mic) return;
        const vCoord = this.mode === 'plan' ? mic.position.y : mic.position.z;
        this.gesture = {
          kind: 'drag-mic',
          id: hit.id,
          offsetU: mic.position.x - worldPt.u,
          offsetV: vCoord - worldPt.v,
        };
        return;
      }
      case 'slice-line': {
        this.gesture = { kind: 'drag-slice' };
        return;
      }
      case 'surface': {
        this.store.setSelection({ kind: 'surface', id: hit.id });
        this.gesture = { kind: 'pan', lastPx: px, lastPy: py };
        return;
      }
    }
  }

  public onPointerMove(
    camera: ViewportCamera2D,
    cssWidth: number,
    cssHeight: number,
    px: number,
    py: number
  ): void {
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pan') {
      const dx = px - g.lastPx;
      const dy = py - g.lastPy;
      g.lastPx = px;
      g.lastPy = py;
      this.onCameraChange(panCameraByPixels(camera, dx, dy));
      return;
    }

    const worldPt = screenToWorld(camera, cssWidth, cssHeight, px, py);

    switch (g.kind) {
      case 'ruler': {
        this.rulerOverlay = { start: g.start, end: worldPt };
        this.onOverlayDirty();
        return;
      }
      case 'drag-slice': {
        const y = roundStep(worldPt.v, 0.1);
        this.store.setSliceYM(y, 'drag-slice-y');
        return;
      }
      case 'drag-point-source': {
        const ps = this.store.scene.pointSources.find((p) => p.id === g.id);
        if (!ps) return;
        const u = roundStep(worldPt.u + g.offsetU, 0.05);
        const v = roundStep(worldPt.v + g.offsetV, 0.05);
        const position =
          this.mode === 'plan'
            ? { x: u, y: v, z: ps.position.z }
            : { x: u, y: ps.position.y, z: Math.max(0.05, v) };
        this.store.updatePointSource(g.id, { position }, `drag-ps-${g.id}`);
        return;
      }
      case 'aim-point-source': {
        const ps = this.store.scene.pointSources.find((p) => p.id === g.id);
        if (!ps) return;
        const du = worldPt.u - ps.position.x;
        const dv = worldPt.v - (this.mode === 'plan' ? ps.position.y : ps.position.z);
        if (Math.hypot(du, dv) < 0.15) return;
        const angleDeg = roundStep(Math.atan2(dv, du) * RAD_TO_DEG, 0.5);
        const orientation =
          this.mode === 'plan'
            ? { ...ps.orientation, azimuthDeg: angleDeg }
            : { ...ps.orientation, tiltDeg: Math.max(-85, Math.min(85, angleDeg)) };
        this.store.updatePointSource(g.id, { orientation }, `aim-ps-${g.id}`);
        return;
      }
      case 'drag-sub-array': {
        const sa = this.store.scene.subArrays.find((s) => s.id === g.id);
        if (!sa) return;
        const u = roundStep(worldPt.u + g.offsetU, 0.05);
        const v = roundStep(worldPt.v + g.offsetV, 0.05);
        const origin =
          this.mode === 'plan'
            ? { x: u, y: v, z: sa.origin.z }
            : { x: u, y: sa.origin.y, z: Math.max(0.05, v) };
        this.store.updateSubArray(g.id, { origin }, `drag-sa-${g.id}`);
        return;
      }
      case 'drag-mic': {
        const mic = this.store.scene.virtualMics.find((m) => m.id === g.id);
        if (!mic) return;
        const u = roundStep(worldPt.u + g.offsetU, 0.05);
        const v = roundStep(worldPt.v + g.offsetV, 0.05);
        const position =
          this.mode === 'plan'
            ? { x: u, y: v, z: mic.position.z }
            : { x: u, y: mic.position.y, z: Math.max(0.05, v) };
        this.store.updateVirtualMic(g.id, { position }, `drag-mic-${g.id}`);
        return;
      }
    }
  }

  public onPointerUp(): void {
    if (this.gesture) {
      this.gesture = null;
      this.store.endTransaction();
    }
  }

  public clearRuler(): void {
    this.rulerOverlay = null;
    this.onOverlayDirty();
  }
}

function roundStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

