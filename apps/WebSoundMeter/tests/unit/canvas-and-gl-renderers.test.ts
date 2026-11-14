/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
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

import { describe, expect, it, vi } from 'vitest';
import {
  ChartPlotBox,
  drawCanvasTrace,
  drawCursorCrosshair,
  drawEqHandles,
  drawFeedbackCalloutFlags,
  drawGridAndAxes,
  drawRtaOctaveBars,
  drawRtaPeakLine,
  drawSplHistoryPlot,
} from '../../src/charts/canvas-chart-painter.js';
import { ChartAxisBounds } from '../../src/charts/chart-interaction.js';
import {
  GlTraceRenderer,
  parseCssColorToRgba,
} from '../../src/charts/gl-trace-renderer.js';
import { BiquadSpec } from '../../src/dsp/biquad.js';
import { DEFAULT_SPL_ALERT_THRESHOLDS } from '../../src/dsp/spl-history.js';
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../../src/sources/source-data.js';

function createMock2dContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
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
    measureText: vi.fn(() => ({ width: 52 })),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const box: ChartPlotBox = {
  plotLeft: 50,
  plotTop: 10,
  plotW: 600,
  plotH: 300,
};

const freqBounds: ChartAxisBounds = {
  xMin: 20,
  xMax: 20000,
  yMin: -24,
  yMax: 24,
};

const timeBounds: ChartAxisBounds = {
  xMin: -10,
  xMax: 30,
  yMin: -1,
  yMax: 1,
};

describe('canvas-chart-painter and gl-trace-renderer', () => {
  it('draws log-frequency and linear-time grids and axes', () => {
    const ctx = createMock2dContext();
    drawGridAndAxes(ctx, 'magnitude', freqBounds, box);
    expect(ctx.fillRect).toHaveBeenCalledWith(50, 10, 600, 300);
    expect(ctx.strokeRect).toHaveBeenCalledWith(50, 10, 600, 300);
    expect(ctx.fillText).toHaveBeenCalled();

    const timeCtx = createMock2dContext();
    drawGridAndAxes(timeCtx, 'impulse', timeBounds, box);
    expect(timeCtx.fillText).toHaveBeenCalled();
  });

  it('draws coherence-bucketed 2D canvas traces and breaks on zero alpha', () => {
    const ctx = createMock2dContext();
    const vertices = new Float32Array([
      -0.5, 0.0, 1.0,
      0.0, 0.2, 1.0,
      0.2, 0.1, 0.0, // zero alpha gap
      0.5, -0.2, 0.5,
      0.8, -0.1, 0.5,
    ]);
    drawCanvasTrace(ctx, vertices, 5, '#38bdf8', box);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(1.0);
  });

  it('draws RTA fractional-octave bars, RTA peak line, EQ handles, and cursor crosshair', () => {
    const ctx = createMock2dContext();
    const freqData = createEmptyFrequencyDomainData(257, 48000);
    freqData.module.fill(0.5);
    freqData.peakSquared.fill(0.8);
    const src: SourceData = {
      id: 'live-measurement',
      name: 'Live',
      kind: 'measurement',
      color: '#38bdf8',
      visible: true,
      active: true,
      sampleRate: 48000,
      gainOffsetDb: 0,
      delayOffsetMs: 0,
      invertPolarity: false,
      createdAt: new Date().toISOString(),
      notes: '',
      freqData,
      timeData: createEmptyTimeDomainData(512, 48000),
    };

    const src2: SourceData = {
      ...src,
      id: 'stored-1',
      name: 'Stored',
      color: '#f43f5e',
      freqData: createEmptyFrequencyDomainData(257, 48000),
    };
    src2.freqData.module.fill(0.25);
    src2.freqData.peakSquared.fill(0.4);

    drawRtaOctaveBars(
      ctx,
      [src, src2],
      3,
      true,
      { xMin: 20, xMax: 20000, yMin: -90, yMax: 0 },
      box
    );
    expect(ctx.fillRect).toHaveBeenCalled();

    drawRtaPeakLine(ctx, src, { xMin: 20, xMax: 20000, yMin: -90, yMax: 0 }, box);
    expect(ctx.stroke).toHaveBeenCalled();

    const bands: BiquadSpec[] = [
      { type: 'peaking', frequency: 1000, q: 2, gainDb: 3, enabled: true },
      { type: 'highpass', frequency: 40, q: 0.7, gainDb: 0, enabled: false },
    ];
    drawEqHandles(ctx, bands, freqBounds, box);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('EQ1', expect.any(Number), expect.any(Number));

    drawCursorCrosshair(ctx, 1000, true, freqBounds, box);
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);

    // Draw SPL History plot & Feedback Callout Flags
    const splSrc: SourceData = {
      ...src,
      splHistory: {
        epochSeq: 3,
        length: 3,
        stepSec: 1.0,
        timeSec: new Float32Array([-2, -1, 0]),
        shortTermDbA: new Float32Array([88, 91, 94]),
        shortTermDbC: new Float32Array([95, 98, 101]),
        peakDb: new Float32Array([102, 105, 108]),
        leq1mDbA: new Float32Array([87, 89, 92]),
        leq1mDbC: new Float32Array([94, 96, 99]),
        leq15mDbA: new Float32Array([86, 88, 90]),
        leq60mDbA: new Float32Array([85, 87, 89]),
      },
      feedbackTracks: [
        {
          id: 'live-measurement:2500',
          slotId: 'live-measurement',
          slotName: 'FOH Mic',
          slotColor: '#38bdf8',
          state: 'feedback',
          frequencyHz: 2480,
          isoBandHz: 2500,
          isoBandLabel: '2.5 kHz',
          musicalNote: 'D#7 (-23c)',
          prominenceDb: 15.2,
          peakLevelDb: -4.0,
          estimatedQ: 42,
          durationMs: 480,
          firstDetectedAt: new Date().toISOString(),
          latchRemainingRatio: 1.0,
        },
      ],
    };

    drawGridAndAxes(ctx, 'spl-history', { xMin: -60, xMax: 0, yMin: 40, yMax: 125 }, box);
    drawSplHistoryPlot(
      ctx,
      [splSrc],
      'dba-fast-leq1m',
      true,
      DEFAULT_SPL_ALERT_THRESHOLDS,
      { xMin: -60, xMax: 0, yMin: 40, yMax: 125 },
      box
    );
    drawFeedbackCalloutFlags(
      ctx,
      [splSrc],
      { xMin: 20, xMax: 20000, yMin: -90, yMax: 0 },
      box
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('2.48 kHz'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('parses CSS hex colors and handles WebGL2 availability and drawing', () => {
    expect(parseCssColorToRgba('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(parseCssColorToRgba('invalid')).toEqual([0.22, 0.74, 0.97, 1.0]);

    // Fallback when WebGL2 is unavailable
    const nullCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    const fallbackRenderer = new GlTraceRenderer(nullCanvas);
    expect(fallbackRenderer.isWebGlAvailable()).toBe(false);
    fallbackRenderer.clear(0, 0, 100, 100, 100);
    fallbackRenderer.drawTrace(new Float32Array([0, 0, 1, 1, 1, 1]), 2, '#10b981');

    // Mock WebGL2 context
    const mockGl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      FLOAT: 5126,
      BLEND: 3042,
      SCISSOR_TEST: 3089,
      SRC_ALPHA: 770,
      ONE_MINUS_SRC_ALPHA: 771,
      COLOR_BUFFER_BIT: 16384,
      STREAM_DRAW: 35040,
      LINE_STRIP: 3,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      deleteProgram: vi.fn(),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      getUniformLocation: vi.fn(() => ({})),
      createVertexArray: vi.fn(() => ({})),
      deleteVertexArray: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      deleteBuffer: vi.fn(),
      bindVertexArray: vi.fn(),
      bindBuffer: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      enable: vi.fn(),
      blendFunc: vi.fn(),
      viewport: vi.fn(),
      scissor: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      useProgram: vi.fn(),
      uniform4f: vi.fn(),
      bufferData: vi.fn(),
      drawArrays: vi.fn(),
    };
    const glCanvas = {
      getContext: () => mockGl,
    } as unknown as HTMLCanvasElement;

    const renderer = new GlTraceRenderer(glCanvas);
    expect(renderer.isWebGlAvailable()).toBe(true);
    // Asymmetric plotTopPx (12) vs bottom margin (300 - 12 - 200 = 88) verifies Y-flip formula
    renderer.clear(52, 12, 400, 200, 300);
    expect(mockGl.viewport).toHaveBeenCalledWith(52, 88, 400, 200);
    expect(mockGl.scissor).toHaveBeenCalledWith(52, 88, 400, 200);

    const verts = new Float32Array([-1, 0, 1, 1, 0, 1]);
    renderer.drawTrace(verts, 2, '#10b981', 0.8);
    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.LINE_STRIP, 0, 2);

    renderer.dispose();
    expect(mockGl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(renderer.isWebGlAvailable()).toBe(false);
  });
});

