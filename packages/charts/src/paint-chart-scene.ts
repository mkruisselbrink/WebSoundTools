// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DualCanvasDimensions } from '@foh/canvas';
import {
  drawCanvasTrace,
  drawChartGridAndAxes,
  drawHistogramSeries,
  drawRtaBarSeries,
  drawStemPoints,
  drawThresholdGuide,
} from './canvas-grid-painter.js';
import {
  drawCalloutFlags,
  drawEqHandles,
  drawFloatingCursorHud,
} from './canvas-overlays.js';
import type {
  ChartPadding,
  ChartPlotBox,
  ChartScene,
  CursorReadoutModel,
} from './chart-scene-types.js';
import {
  DEFAULT_CHART_PADDING,
  buildTraceNdcVertices,
  getChartPlotBox,
} from './coord-math.js';
import type { GlTraceRenderer } from './gl-trace-renderer.js';

/**
 * Stateless dual-canvas compositor rendering WebGL2 line traces alongside 2D grid axes,
 * fractional-octave RTA bars, histogram/stem series, feedback callout flags, parametric EQ
 * handles, and the floating cursor HUD pill.
 */
export function paintChartScene(
  ctx: CanvasRenderingContext2D,
  glRenderer: GlTraceRenderer | null,
  dims: DualCanvasDimensions,
  scene: ChartScene,
  cursorReadout: CursorReadoutModel | null,
  padding: ChartPadding = DEFAULT_CHART_PADDING,
  vertexScratch?: Float32Array
): void {
  const { cssWidth, cssHeight, dpr, deviceHeight } = dims;
  const box: ChartPlotBox = getChartPlotBox(cssWidth, cssHeight, padding);
  const { bounds } = scene.axis;
  const isLogX = scene.axis.xScale === 'log';

  const glActive =
    glRenderer !== null &&
    glRenderer.isWebGlAvailable() &&
    Boolean(
      scene.traces &&
        scene.traces.some((t) => t.preferWebGl && !t.force2d && !t.lineDash?.length)
    );

  if (glRenderer && glRenderer.isWebGlAvailable()) {
    glRenderer.clear(
      box.left * dpr,
      box.top * dpr,
      box.width * dpr,
      box.height * dpr,
      deviceHeight
    );
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  drawChartGridAndAxes(ctx, scene.axis, box, !glActive);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();

  if (scene.thresholdGuide) {
    drawThresholdGuide(ctx, scene.thresholdGuide, bounds, box);
  }

  if (scene.rtaBars && scene.rtaBars.length > 0) {
    drawRtaBarSeries(ctx, scene.rtaBars, bounds, box);
  }

  if (scene.stems && scene.stems.length > 0) {
    drawStemPoints(ctx, scene.stems, bounds, box);
  }

  if (scene.histogram) {
    drawHistogramSeries(ctx, scene.histogram, bounds, box);
  }

  if (scene.traces) {
    for (const trace of scene.traces) {
      let verts: Float32Array;
      let vertCount: number;

      if (trace.ndcVertices && trace.ndcVertexCount !== undefined) {
        verts = trace.ndcVertices;
        vertCount = trace.ndcVertexCount;
      } else if (trace.x && trace.y) {
        const built = buildTraceNdcVertices({
          x: trace.x,
          y: trace.y,
          bounds,
          isLogX,
          alpha: trace.alpha,
          unwrapPhaseBreaks: trace.unwrapPhaseBreaks,
          phaseBreakThresholdDeg: trace.phaseBreakThresholdDeg,
          outScratch: vertexScratch,
        });
        verts = built.vertices;
        vertCount = built.vertexCount;
      } else {
        continue;
      }

      const canUseGl =
        glActive &&
        Boolean(trace.preferWebGl) &&
        !trace.force2d &&
        (!trace.lineDash || trace.lineDash.length === 0);

      if (canUseGl && glRenderer) {
        glRenderer.drawTrace(
          verts,
          vertCount,
          trace.color,
          trace.opacity ?? 1.0,
          (trace.lineWidth ?? 2.0) * dpr
        );
      } else {
        drawCanvasTrace(ctx, verts, vertCount, trace.color, box, {
          lineDash: trace.lineDash,
          lineWidth: trace.lineWidth,
          opacity: trace.opacity,
        });
      }
    }
  }

  if (scene.calloutFlags && scene.calloutFlags.length > 0) {
    drawCalloutFlags(ctx, scene.calloutFlags, isLogX, bounds, box);
  }

  if (scene.eqOverlay && scene.eqOverlay.bands.length > 0) {
    drawEqHandles(ctx, scene.eqOverlay, bounds, box);
  }

  ctx.restore();

  if (cursorReadout) {
    drawFloatingCursorHud(ctx, cursorReadout, isLogX, bounds, box);
  }

  ctx.restore();
}
