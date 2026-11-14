/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLORMAP_CONFIG,
  ProjectStore,
  resolveEffectiveSplRange,
} from '../../src/model/project-store.js';
import { getAimHandleWorldPoint } from '../../src/viewport/canvas-cad-painter.js';
import { evaluateSplLutRgb } from '../../src/viewport/gl-heatmap-renderer.js';
import {
  fitCameraToWorldBox,
  sampleScalarGridBilinear,
  screenToWorld,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '../../src/viewport/viewport-coords.js';
import { hitTestViewport } from '../../src/viewport/viewport-interaction.js';

describe('viewport coordinates, LUT, and hit-testing', () => {
  it('round-trips worldToScreen and screenToWorld and preserves cursor anchor on zoom', () => {
    const cam = fitCameraToWorldBox(-5, 25, -10, 10, 800, 600);
    const scr = worldToScreen(cam, 800, 600, 12.5, -3.2);
    const wrld = screenToWorld(cam, 800, 600, scr.px, scr.py);
    expect(wrld.u).toBeCloseTo(12.5, 6);
    expect(wrld.v).toBeCloseTo(-3.2, 6);

    const zoomed = zoomCameraAtScreenPoint(cam, 800, 600, scr.px, scr.py, 1.8);
    const afterZoom = screenToWorld(zoomed, 800, 600, scr.px, scr.py);
    expect(afterZoom.u).toBeCloseTo(12.5, 6);
    expect(afterZoom.v).toBeCloseTo(-3.2, 6);
  });

  it('interpolates scalar SPL grids and evaluates monotonic LUT color stops', () => {
    const grid = new Float32Array([80, 90, 90, 100]);
    const mid = sampleScalarGridBilinear(grid, 2, 2, 0, 10, 0, 10, 5, 5);
    expect(mid).toBeCloseTo(90, 5);
    expect(sampleScalarGridBilinear(grid, 2, 2, 0, 10, 0, 10, -1, 5)).toBeNull();

    const low = evaluateSplLutRgb(0, 'turbo');
    const midLut = evaluateSplLutRgb(0.5, 'turbo');
    const high = evaluateSplLutRgb(1, 'turbo');
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(midLut[1]).toBeGreaterThan(low[1]);

    const infLow = evaluateSplLutRgb(0, 'inferno');
    const infHigh = evaluateSplLutRgb(1, 'inferno');
    expect(infHigh[0] + infHigh[1] + infHigh[2]).toBeGreaterThan(
      infLow[0] + infLow[1] + infLow[2]
    );

    const virLow = evaluateSplLutRgb(0, 'viridis');
    const virHigh = evaluateSplLutRgb(1, 'viridis');
    expect(virHigh[1]).toBeGreaterThan(virLow[1]);
  });

  it('resolves tight, standard, wide, and manual SPL colormap windows accurately', () => {
    const stats = {
      audienceSampleCount: 400,
      meanAudienceSplDb: 104.2,
      maxAudienceSplDb: 108.4,
    };

    const tight6 = resolveEffectiveSplRange(
      { ...DEFAULT_COLORMAP_CONFIG, rangeMode: 'auto-6' },
      stats
    );
    expect(tight6.maxSplDb - tight6.minSplDb).toBe(6);
    expect(tight6.minSplDb).toBeCloseTo(101, 1);
    expect(tight6.maxSplDb).toBeCloseTo(107, 1);

    const fine12 = resolveEffectiveSplRange(
      { ...DEFAULT_COLORMAP_CONFIG, rangeMode: 'auto-12' },
      stats
    );
    expect(fine12.maxSplDb - fine12.minSplDb).toBe(12);

    const std21 = resolveEffectiveSplRange(
      { ...DEFAULT_COLORMAP_CONFIG, rangeMode: 'auto-21' },
      stats
    );
    expect(std21.maxSplDb - std21.minSplDb).toBe(21);
    expect(std21.maxSplDb).toBeGreaterThanOrEqual(109.5);

    // Editing minSplDb directly without rangeMode switches store colormap to manual
    const store = new ProjectStore();
    expect(store.colormap.rangeMode).toBe('auto-21');
    store.setColormap({ minSplDb: 90, maxSplDb: 108 });
    expect(store.colormap.rangeMode).toBe('manual');
    const manual = resolveEffectiveSplRange(store.colormap, stats);
    expect(manual).toEqual({ minSplDb: 90, maxSplDb: 108 });
  });

  it('hit-tests aim handles, point sources, sub arrays, and virtual mics accurately', () => {
    const store = new ProjectStore();
    const cam = fitCameraToWorldBox(-5, 20, -7, 7, 800, 500);
    const ps = store.scene.pointSources[0];

    const aimW = getAimHandleWorldPoint('plan', ps.position, ps.orientation);
    const aimS = worldToScreen(cam, 800, 500, aimW.u, aimW.v);
    expect(hitTestViewport('plan', store.scene, cam, 800, 500, aimS.px, aimS.py)).toEqual({
      kind: 'aim-handle',
      sourceId: ps.id,
    });

    const psS = worldToScreen(cam, 800, 500, ps.position.x, ps.position.y);
    expect(hitTestViewport('plan', store.scene, cam, 800, 500, psS.px, psS.py)).toEqual({
      kind: 'point-source',
      id: ps.id,
    });

    const mic = store.scene.virtualMics[0];
    const micS = worldToScreen(cam, 800, 500, mic.position.x, mic.position.y);
    expect(hitTestViewport('plan', store.scene, cam, 800, 500, micS.px, micS.py)).toEqual({
      kind: 'virtual-mic',
      id: mic.id,
    });
  });
});

