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
 * 1:1 aspect-locked 2D CAD camera transforms & bilinear SPL grid sampling (`src/viewport/viewport-coords.ts`).
 *
 * Both Plan View (world X horizontal, world Y vertical) and Section View (world X horizontal,
 * world Z vertical) map +X to screen right and +V (+Y or +Z) to screen up.
 */

export interface ViewportCamera2D {
  /** World X coordinate at viewport center in meters. */
  readonly centerX: number;
  /** World vertical coordinate (Y in Plan, Z in Section) at viewport center in meters. */
  readonly centerV: number;
  /** CSS pixels per world meter (uniform in both axes to preserve true angles). */
  readonly pixelsPerMeter: number;
}

export interface ScreenPoint2D {
  readonly px: number;
  readonly py: number;
}

export interface WorldPoint2D {
  readonly u: number;
  readonly v: number;
}

export function fitCameraToWorldBox(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  paddingFraction: number = 0.08
): ViewportCamera2D {
  const spanU = Math.max(1, uMax - uMin);
  const spanV = Math.max(1, vMax - vMin);
  const usableW = Math.max(64, viewportWidthPx * (1 - 2 * paddingFraction));
  const usableH = Math.max(64, viewportHeightPx * (1 - 2 * paddingFraction));
  const pixelsPerMeter = Math.max(2, Math.min(usableW / spanU, usableH / spanV));

  return {
    centerX: 0.5 * (uMin + uMax),
    centerV: 0.5 * (vMin + vMax),
    pixelsPerMeter,
  };
}

export function worldToScreen(
  cam: ViewportCamera2D,
  widthPx: number,
  heightPx: number,
  u: number,
  v: number
): ScreenPoint2D {
  return {
    px: widthPx * 0.5 + (u - cam.centerX) * cam.pixelsPerMeter,
    py: heightPx * 0.5 - (v - cam.centerV) * cam.pixelsPerMeter,
  };
}

export function screenToWorld(
  cam: ViewportCamera2D,
  widthPx: number,
  heightPx: number,
  px: number,
  py: number
): WorldPoint2D {
  const inv = 1 / Math.max(1e-4, cam.pixelsPerMeter);
  return {
    u: cam.centerX + (px - widthPx * 0.5) * inv,
    v: cam.centerV - (py - heightPx * 0.5) * inv,
  };
}

export function panCameraByPixels(
  cam: ViewportCamera2D,
  deltaPx: number,
  deltaPy: number
): ViewportCamera2D {
  const inv = 1 / Math.max(1e-4, cam.pixelsPerMeter);
  return {
    centerX: cam.centerX - deltaPx * inv,
    centerV: cam.centerV + deltaPy * inv,
    pixelsPerMeter: cam.pixelsPerMeter,
  };
}

export function zoomCameraAtScreenPoint(
  cam: ViewportCamera2D,
  widthPx: number,
  heightPx: number,
  cursorPx: number,
  cursorPy: number,
  zoomFactor: number
): ViewportCamera2D {
  const anchor = screenToWorld(cam, widthPx, heightPx, cursorPx, cursorPy);
  const nextPpm = Math.max(1.5, Math.min(250, cam.pixelsPerMeter * zoomFactor));
  return {
    centerX: anchor.u - (cursorPx - widthPx * 0.5) / nextPpm,
    centerV: anchor.v + (cursorPy - heightPx * 0.5) / nextPpm,
    pixelsPerMeter: nextPpm,
  };
}

/** Picks a clean human-readable metric grid step (0.5, 1, 2, 5, 10, 20 m) given `pixelsPerMeter`. */
export function chooseMetricGridStepM(pixelsPerMeter: number): number {
  const minPixelSpacing = 48;
  const rawStep = minPixelSpacing / Math.max(1e-3, pixelsPerMeter);
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 20, 50];
  for (const step of candidates) {
    if (step >= rawStep) return step;
  }
  return 100;
}

/** Bilinearly samples a scalar SPL grid `[rows * cols]` at world `(u, v)`. */
export function sampleScalarGridBilinear(
  splDb: Float32Array,
  cols: number,
  rows: number,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  u: number,
  v: number
): number | null {
  if (u < uMin || u > uMax || v < vMin || v > vMax || cols < 2 || rows < 2) {
    return null;
  }
  const fx = ((u - uMin) / Math.max(1e-6, uMax - uMin)) * (cols - 1);
  const fy = ((v - vMin) / Math.max(1e-6, vMax - vMin)) * (rows - 1);

  const c0 = Math.min(cols - 2, Math.max(0, Math.floor(fx)));
  const r0 = Math.min(rows - 2, Math.max(0, Math.floor(fy)));
  const tx = fx - c0;
  const ty = fy - r0;

  const v00 = splDb[r0 * cols + c0];
  const v10 = splDb[r0 * cols + c0 + 1];
  const v01 = splDb[(r0 + 1) * cols + c0];
  const v11 = splDb[(r0 + 1) * cols + c0 + 1];

  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

