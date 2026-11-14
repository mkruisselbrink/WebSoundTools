// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * HiDPI 2D Canvas CAD Overlay coordinator for Plan View (X-Y) and Side Section View (X-Z).
 */

import { computeSpeedOfSoundMpS } from '@foh/acoustics';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { ColormapConfig, SelectedEntity } from '../model/project-store.js';
import type { ProjectScene } from '../model/project-types.js';
import type { VirtualMicResponse } from '../physics/virtual-mic-solver.js';
import {
  drawPointSources,
  drawSubArrays,
  drawVirtualMics,
  getAimHandleWorldPoint,
} from './cad-entity-painter.js';
import {
  drawColormapLegendBar,
  drawDatumOrSliceLine,
  drawMetricGrid,
  drawRulerOverlay,
  type OccupiedPillRect,
  type RulerOverlayState,
  type ViewportMode,
} from './cad-grid-ruler.js';
import { drawSurfaces } from './cad-zone-painter.js';
import type { ViewportCamera2D } from './viewport-coords.js';

export { getAimHandleWorldPoint, type RulerOverlayState, type ViewportMode };

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

  drawMetricGrid(ctx, camera, cssWidth, cssHeight, mode);

  const occupiedPills: OccupiedPillRect[] = [];
  drawDatumOrSliceLine(ctx, scene, camera, cssWidth, cssHeight, mode, occupiedPills);

  drawSurfaces(ctx, { mode, scene, selected, camera, cssWidth, cssHeight });

  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  drawSubArrays(ctx, {
    mode,
    scene,
    speakerMap,
    selected,
    groupColors,
    speedOfSoundMpS: c,
    camera,
    cssWidth,
    cssHeight,
  });

  drawPointSources(ctx, {
    mode,
    scene,
    speakerMap,
    selected,
    groupColors,
    camera,
    cssWidth,
    cssHeight,
  });

  drawVirtualMics(ctx, {
    mode,
    scene,
    selected,
    micSplMap,
    camera,
    cssWidth,
    cssHeight,
    occupiedPills,
  });

  if (opts.ruler) {
    drawRulerOverlay(ctx, opts.ruler, camera, cssWidth, cssHeight, c);
  }

  if (opts.colormap && opts.effectiveSplRange) {
    drawColormapLegendBar(ctx, opts.colormap, opts.effectiveSplRange, cssWidth, cssHeight);
  }
}
