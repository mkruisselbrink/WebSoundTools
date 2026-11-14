// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BiquadSpec } from '@foh/dsp';
import { describe, expect, it, vi } from 'vitest';
import {
  computeDraggedEqBand,
  drawCalloutFlags,
  drawEqHandles,
  drawFloatingCursorHud,
  findHitEqBandIndex,
} from './canvas-overlays.js';
import type { ChartAxisBounds, ChartPlotBox } from './chart-scene-types.js';
import { valueToNormX, valueToNormY } from './coord-math.js';

function createMock2dContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(),
    rect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 64 })),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const box: ChartPlotBox = { left: 50, top: 10, width: 600, height: 300 };

describe('canvas-overlays', () => {
  it('hit-tests and drags EQ handles around both 0 dB TF and absolute SPL reference baselines', () => {
    const plotW = 800;
    const plotH = 400;
    const tfBounds: ChartAxisBounds = { xMin: 20, xMax: 20000, yMin: -24, yMax: 24 };
    const bands: BiquadSpec[] = [
      { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
      { type: 'peaking', frequency: 1000, q: 2.0, gainDb: 6, enabled: true },
    ];

    const b1x = valueToNormX(1000, 20, 20000, true) * plotW;
    const b1y = (1 - valueToNormY(6, -24, 24)) * plotH;
    expect(findHitEqBandIndex(b1x + 3, b1y - 3, plotW, plotH, bands, tfBounds, 0)).toBe(1);

    const draggedTf = computeDraggedEqBand(b1x, 0.25 * plotH, plotW, plotH, tfBounds, 0);
    expect(draggedTf.frequency).toBeCloseTo(1000, -1);
    expect(draggedTf.gainDb).toBe(12);

    // Absolute SPL mode (e.g. WebSpeakerSim with referenceZeroDbY = 90 dB SPL on [60..120])
    const splBounds: ChartAxisBounds = { xMin: 20, xMax: 20000, yMin: 60, yMax: 120 };
    const splHandleY = (1 - valueToNormY(96, 60, 120)) * plotH;
    expect(findHitEqBandIndex(b1x, splHandleY, plotW, plotH, bands, splBounds, 90)).toBe(1);

    const draggedSpl = computeDraggedEqBand(
      b1x,
      (1 - valueToNormY(85.5, 60, 120)) * plotH,
      plotW,
      plotH,
      splBounds,
      90
    );
    expect(draggedSpl.gainDb).toBe(-4.5);
  });

  it('paints EQ handles, collision-avoiding callout flags, and floating cursor HUD', () => {
    const ctx = createMock2dContext();
    const splBounds: ChartAxisBounds = { xMin: 20, xMax: 20000, yMin: 60, yMax: 120 };

    drawEqHandles(
      ctx,
      {
        referenceZeroDbY: 90,
        bands: [{ type: 'peaking', frequency: 1000, q: 2, gainDb: 3, enabled: true }],
      },
      splBounds,
      box
    );
    expect(ctx.arc).toHaveBeenCalled();

    drawCalloutFlags(
      ctx,
      [
        {
          id: 'fb1',
          x: 2500,
          state: 'feedback',
          line1: '◆ 2.50 kHz (ISO 2.5 kHz)',
          line2: '+15.0dB • Q≈40',
          accentColor: '#ef4444',
          badgeColor: '#38bdf8',
          opacity: 0.95,
        },
        {
          id: 'fb2',
          x: 2520,
          state: 'ringing',
          line1: '▲ 2.52 kHz',
          line2: '+9.0dB',
          accentColor: '#f59e0b',
          badgeColor: '#10b981',
          opacity: 0.95,
        },
      ],
      true,
      splBounds,
      box
    );

    drawFloatingCursorHud(
      ctx,
      {
        domainX: 15000,
        headerText: '15.00 kHz',
        subHeaderText: 'T 0.07 ms · λ 0.02 m',
        rows: [{ color: '#38bdf8', text: 'FOH: 94.2 dB', highlightDomainY: 94.2 }],
      },
      true,
      splBounds,
      box
    );
    expect(ctx.fillText).toHaveBeenCalledWith('15.00 kHz', expect.any(Number), expect.any(Number));
  });
});
