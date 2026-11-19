// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { FohChartPanel, paintChartScene } from './foh-chart-panel.js';

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
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 54 })),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('paintChartScene & FohChartPanel', () => {
  it('paints a complete ChartScene with 2D fallback traces and cursor readout', () => {
    expect(FohChartPanel).toBeDefined();
    const ctx = createMock2dContext();
    paintChartScene(
      ctx,
      null,
      { cssWidth: 640, cssHeight: 320, dpr: 2, deviceWidth: 1280, deviceHeight: 640 },
      {
        axis: {
          xScale: 'log',
          xUnit: 'Hz',
          yUnit: 'dB',
          bounds: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24, yStep: 6 },
        },
        traces: [
          {
            id: 'main',
            color: '#38bdf8',
            x: new Float32Array([100, 1000, 10000]),
            y: new Float32Array([-3, 0, -2]),
          },
        ],
        eqOverlay: {
          referenceZeroDbY: 0,
          bands: [{ type: 'peaking', frequency: 1000, q: 2, gainDb: 3, enabled: true }],
        },
      },
      {
        domainX: 1000,
        headerText: '1000 Hz',
        rows: [{ color: '#38bdf8', text: 'Main: +0.0 dB', highlightDomainY: 0 }],
      }
    );

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 640, 320);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('1000 Hz', expect.any(Number), expect.any(Number));
  });

  it('paints traces on the 2D HiDPI canvas above grid lines even when GlTraceRenderer is present', () => {
    const ctx = createMock2dContext();
    const mockGlRenderer = {
      isWebGlAvailable: () => true,
      clear: vi.fn(),
      drawTrace: vi.fn(),
      dispose: vi.fn(),
      reinitialize: vi.fn(),
    };
    const strokeWidths: number[] = [];
    ctx.stroke = vi.fn(() => {
      strokeWidths.push(ctx.lineWidth);
    });

    paintChartScene(
      ctx,
      mockGlRenderer as never,
      { cssWidth: 640, cssHeight: 320, dpr: 2, deviceWidth: 1280, deviceHeight: 640 },
      {
        axis: {
          xScale: 'log',
          xUnit: 'Hz',
          yUnit: 'dB',
          bounds: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24, yStep: 6 },
        },
        traces: [
          {
            id: 'tf',
            color: '#38bdf8',
            x: new Float32Array([100, 1000, 10000]),
            y: new Float32Array([0, 0, 0]),
          },
        ],
      },
      null
    );

    expect(mockGlRenderer.clear).toHaveBeenCalledTimes(1);
    expect(mockGlRenderer.drawTrace).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledWith(52, 12, 570, 284);
    expect(strokeWidths).toContain(2);
  });
});
