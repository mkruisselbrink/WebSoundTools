// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { FohChartPanel, fohChartPanelStyles, paintChartScene } from './foh-chart-panel.js';

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
    const cssText = fohChartPanelStyles.toString();
    expect(cssText).toContain('appearance: none');
    expect(cssText).toContain('padding-inline-end: 24px');
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

  it('scrubs and pins cursorDomainX on touch pointerdown/pointermove while dismissing on axis-margin tap', () => {
    const panel = Object.create(FohChartPanel.prototype) as unknown as {
      scene: FohChartPanel['scene'];
      cursorDomainX: number | null;
      draggingEqBandIndex: number | null;
      touchScrubbing: boolean;
      chartPadding: { left: number; right: number; top: number; bottom: number };
      canvasController: {
        overlayCanvas: { getBoundingClientRect: () => DOMRect };
        requestRepaint: ReturnType<typeof vi.fn>;
      };
      handleStagePointerDown: (e: Partial<PointerEvent>) => void;
      handleStagePointerMove: (e: Partial<PointerEvent>) => void;
      handleStagePointerUp: (e: Partial<PointerEvent>) => void;
      handleStagePointerLeave: (e: Partial<PointerEvent>) => void;
    };

    const repaintSpy = vi.fn();
    Object.defineProperty(panel, 'cursorDomainX', {
      value: null,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(panel, 'scene', {
      value: {
        axis: {
          xScale: 'log',
          xUnit: 'Hz',
          yUnit: 'dB',
          bounds: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24, yStep: 6 },
        },
      },
      writable: true,
      configurable: true,
    });
    panel.draggingEqBandIndex = null;
    panel.touchScrubbing = false;
    panel.chartPadding = { left: 52, right: 18, top: 12, bottom: 24 };
    panel.canvasController = {
      overlayCanvas: {
        getBoundingClientRect: () =>
          ({ left: 0, top: 0, width: 640, height: 320 }) as DOMRect,
      },
      requestRepaint: repaintSpy,
    };

    // Bind instance arrow handlers from constructor via temporary super-less init check:
    // invoke prototype pointer methods directly.
    const captureTarget = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement;

    // 1. Touch tap inside plot box (x = 52 + 570/2 = 337 => log midpoint sqrt(20*20000) = ~632.45 Hz)
    panel.handleStagePointerDown({
      pointerId: 1,
      pointerType: 'touch',
      clientX: 337,
      clientY: 120,
      currentTarget: captureTarget,
    });
    expect(panel.cursorDomainX).not.toBeNull();
    expect(panel.cursorDomainX!).toBeCloseTo(632.46, 0);

    // 2. Touch drag right (x = 52 + 570 = 622 => 20000 Hz)
    panel.handleStagePointerMove({
      pointerId: 1,
      pointerType: 'touch',
      clientX: 622,
      clientY: 120,
      currentTarget: captureTarget,
    });
    expect(panel.cursorDomainX!).toBeCloseTo(20000, 0);

    // 3. Finger lift triggers pointerup + pointerleave('touch') — cursor readout stays pinned!
    panel.handleStagePointerUp({
      pointerId: 1,
      pointerType: 'touch',
      currentTarget: captureTarget,
    });
    panel.handleStagePointerLeave({ pointerType: 'touch' });
    expect(panel.cursorDomainX!).toBeCloseTo(20000, 0);

    // 4. Touch tap outside plot box (left axis margin x = 16) dismisses pinned readout
    panel.handleStagePointerDown({
      pointerId: 2,
      pointerType: 'touch',
      clientX: 16,
      clientY: 120,
      currentTarget: captureTarget,
    });
    expect(panel.cursorDomainX).toBeNull();

    // 5. Mouse hover still clears on pointerleave('mouse')
    panel.handleStagePointerMove({
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 337,
      clientY: 120,
    });
    expect(panel.cursorDomainX!).toBeCloseTo(632.46, 0);
    panel.handleStagePointerLeave({ pointerType: 'mouse' });
    expect(panel.cursorDomainX).toBeNull();
  });
});
