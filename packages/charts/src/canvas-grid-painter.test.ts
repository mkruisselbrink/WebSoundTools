// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  drawCanvasTrace,
  drawChartGridAndAxes,
  drawHistogramSeries,
  drawRtaBarSeries,
  drawStemPoints,
  drawThresholdGuide,
} from './canvas-grid-painter.js';
import type { ChartPlotBox } from './chart-scene-types.js';

function createMock2dContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 48 })),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const box: ChartPlotBox = { left: 50, top: 10, width: 600, height: 300 };

describe('canvas-grid-painter', () => {
  it('draws log, linear, and relative-time grids and axes', () => {
    const ctx = createMock2dContext();
    drawChartGridAndAxes(
      ctx,
      {
        xScale: 'log',
        xUnit: 'Hz',
        yUnit: 'dB',
        bounds: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24, yStep: 6 },
      },
      box
    );
    expect(ctx.fillRect).toHaveBeenCalledWith(50, 10, 600, 300);
    expect(ctx.strokeRect).toHaveBeenCalledWith(50, 10, 600, 300);

    drawChartGridAndAxes(
      ctx,
      {
        xScale: 'relative-time',
        xUnit: 's',
        yUnit: 'dB',
        bounds: { xMin: -900, xMax: 0, yMin: 50, yMax: 115, yStep: 10 },
      },
      box
    );
    drawChartGridAndAxes(
      ctx,
      {
        xScale: 'linear',
        xUnit: 'ms',
        yUnit: 'amp',
        bounds: { xMin: -10, xMax: 30, yMin: -1, yMax: 1, yStep: 0.25 },
      },
      box
    );
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('draws coherence-bucketed 2D traces, RTA bars, stems, histograms, and threshold guides', () => {
    const ctx = createMock2dContext();
    const verts = new Float32Array([
      -0.5, 0.0, 1.0,
      0.0, 0.2, 1.0,
      0.2, 0.1, 0.0,
      0.5, -0.2, 0.5,
      0.8, -0.1, 0.5,
    ]);
    drawCanvasTrace(ctx, verts, 5, '#38bdf8', box, { lineDash: [4, 2] });
    expect(ctx.stroke).toHaveBeenCalled();

    // Isolated valid point surrounded by hard-cutoff zero-alpha bins emits a degenerate segment so round cap renders
    const isolatedCtx = createMock2dContext();
    const isolatedVerts = new Float32Array([
      -0.4, 0.0, 0.0,
      0.0, 0.25, 1.0,
      0.4, 0.0, 0.0,
    ]);
    drawCanvasTrace(isolatedCtx, isolatedVerts, 3, '#10b981', box);
    expect(isolatedCtx.moveTo).toHaveBeenCalledTimes(1);
    expect(isolatedCtx.lineTo).toHaveBeenCalledTimes(1);
    expect(isolatedCtx.stroke).toHaveBeenCalledTimes(1);

    drawRtaBarSeries(
      ctx,
      [
        {
          id: 's1',
          color: '#38bdf8',
          centerFrequencies: new Float32Array([100, 1000]),
          magnitudesDb: new Float32Array([-18, -12]),
          peaksDb: new Float32Array([-12, -6]),
          showPeakHold: true,
        },
      ],
      { xMin: 20, xMax: 20000, yMin: -90, yMax: 0 },
      box
    );

    drawStemPoints(
      ctx,
      [{ x: 12.5, y: 98, color: '#10b981', dashed: true }],
      { xMin: 0, xMax: 60, yMin: 50, yMax: 115 },
      box
    );

    drawHistogramSeries(
      ctx,
      {
        bins: [{ binCenter: 95, binMin: 94, binMax: 96, value: 32, highlighted: true }],
        meanMarkerX: 95,
      },
      { xMin: 70, xMax: 114, yMin: 0, yMax: 50 },
      box
    );

    drawThresholdGuide(
      ctx,
      {
        warningY: 95,
        limitY: 102,
        warningLabel: '▲ WARN 95 dB',
        limitLabel: '◆ LIMIT 102 dB',
      },
      { xMin: -60, xMax: 0, yMin: 50, yMax: 115 },
      box
    );
    expect(ctx.fillText).toHaveBeenCalledWith('▲ WARN 95 dB', expect.any(Number), expect.any(Number));
  });
});
