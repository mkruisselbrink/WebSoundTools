// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared acoustic chart panel engine (`FohChartPanelBase`, `<foh-chart-panel>`, and `paintChartScene`).
 *
 * Combines `DualCanvasController` (`@foh/canvas`), `GlTraceRenderer`, 2D grid/bar/stem/histogram
 * painters, floating canvas cursor HUD, and interactive parametric EQ band dragging.
 */

import { DualCanvasController, type DualCanvasDimensions } from '@foh/canvas';
import { LitElement, css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  drawCanvasTrace,
  drawChartGridAndAxes,
  drawHistogramSeries,
  drawRtaBarSeries,
  drawStemPoints,
  drawThresholdGuide,
} from './canvas-grid-painter.js';
import {
  computeDraggedEqBand,
  drawCalloutFlags,
  drawEqHandles,
  drawFloatingCursorHud,
  findHitEqBandIndex,
} from './canvas-overlays.js';
import type {
  ChartPadding,
  ChartPlotBox,
  ChartScene,
  CursorReadoutModel,
  EqBandDragDetail,
} from './chart-scene-types.js';
import {
  DEFAULT_CHART_PADDING,
  buildTraceNdcVertices,
  getChartPlotBox,
  normXToValue,
} from './coord-math.js';
import { GlTraceRenderer } from './gl-trace-renderer.js';

export const fohChartPanelStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 150px;
    background: var(--foh-bg-canvas, #090d16);
    border: 1px solid var(--foh-border, #1e293b);
    border-radius: 6px;
    overflow: hidden;
    position: relative;
    user-select: none;
    flex: 1 1 0;
  }

  .chart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 32px;
    min-height: 32px;
    padding: 0 10px;
    background: var(--foh-bg-elevated, #0f172a);
    border-bottom: 1px solid var(--foh-border, #1e293b);
    font-size: 11.5px;
    color: var(--foh-text-primary, #e2e8f0);
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: none;
    font-family: var(--foh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 10.5px;
    color: var(--foh-text-secondary, #cbd5e1);
  }

  .header-center::-webkit-scrollbar {
    display: none;
  }

  select,
  button {
    background: var(--foh-bg-surface, #162033);
    color: var(--foh-text-primary, #f8fafc);
    border: 1px solid var(--foh-border-strong, #334155);
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
  }

  select:hover,
  button:hover {
    border-color: var(--foh-accent, #38bdf8);
  }

  .tab-btn[data-active='true'] {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
    font-weight: 600;
  }

  .label-muted {
    color: var(--foh-text-muted, #94a3b8);
    font-size: 11px;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .dot,
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .stage {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 120px;
    background: var(--foh-bg-canvas, #090d16);
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .overlay-canvas {
    z-index: 2;
  }
`;

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
    Boolean(scene.traces && scene.traces.some((t) => !t.force2d && !t.lineDash?.length));

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
        glActive && !trace.force2d && (!trace.lineDash || trace.lineDash.length === 0);

      if (canUseGl && glRenderer) {
        glRenderer.drawTrace(verts, vertCount, trace.color, trace.opacity ?? 0.95);
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

export abstract class FohChartPanelBase extends LitElement {
  static styles: CSSResultGroup = fohChartPanelStyles;

  @state()
  protected cursorDomainX: number | null = null;

  protected draggingEqBandIndex: number | null = null;
  protected chartPadding: ChartPadding = DEFAULT_CHART_PADDING;

  private glRenderer: GlTraceRenderer | null = null;
  private readonly vertexScratch = new Float32Array(8192 * 3);
  private lastScene: ChartScene | null = null;

  protected readonly canvasController = new DualCanvasController(this, {
    maxDevicePixelRatio: 2.5,
    onPaint: (dims) => this.paintStage(dims),
    onContextLost: () => {
      this.glRenderer?.dispose();
    },
    onContextRestored: () => {
      this.glRenderer?.reinitialize();
    },
  });

  protected abstract buildChartScene(): ChartScene;

  protected abstract buildCursorReadout(
    domainX: number,
    scene: ChartScene
  ): CursorReadoutModel | null;

  protected abstract renderHeader(): TemplateResult | typeof nothing;

  protected onEqBandDrag(detail: EqBandDragDetail): void {
    this.dispatchEvent(
      new CustomEvent<EqBandDragDetail>('eq-band-drag', {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  protected onEqBandDragEnd(): void {
    // Subclasses can commit or end undo transactions when pointer drag finishes.
  }

  protected firstUpdated(): void {
    const stage = this.renderRoot.querySelector('.stage') as HTMLElement | null;
    const glCanvas = this.renderRoot.querySelector('.gl-canvas') as HTMLCanvasElement | null;
    const overlayCanvas = this.renderRoot.querySelector(
      '.overlay-canvas'
    ) as HTMLCanvasElement | null;

    if (glCanvas) {
      this.glRenderer = new GlTraceRenderer(glCanvas);
    }
    if (stage && glCanvas && overlayCanvas) {
      this.canvasController.attach(stage, glCanvas, overlayCanvas);
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.canvasController.detach();
    this.glRenderer?.dispose();
    this.glRenderer = null;
  }

  protected updated(_changed: Map<string, unknown>): void {
    this.canvasController.requestRepaint();
  }

  public requestChartRepaint(): void {
    this.canvasController.requestRepaint();
  }

  protected clearCursor(): void {
    this.cursorDomainX = null;
    this.draggingEqBandIndex = null;
  }

  private paintStage(dims: DualCanvasDimensions): void {
    const overlayCanvas = this.canvasController.overlayCanvas;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    const scene = this.buildChartScene();
    this.lastScene = scene;
    const readout =
      this.cursorDomainX !== null ? this.buildCursorReadout(this.cursorDomainX, scene) : null;

    paintChartScene(
      ctx,
      this.glRenderer,
      dims,
      scene,
      readout,
      this.chartPadding,
      this.vertexScratch
    );
  }

  private getPointerRelativeCoords(e: PointerEvent | MouseEvent): {
    readonly relX: number;
    readonly relY: number;
    readonly box: ChartPlotBox;
  } | null {
    const overlay = this.canvasController.overlayCanvas;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    const box = getChartPlotBox(rect.width, rect.height, this.chartPadding);
    return {
      relX: e.clientX - rect.left - box.left,
      relY: e.clientY - rect.top - box.top,
      box,
    };
  }

  private handleStagePointerDown = (e: PointerEvent): void => {
    const scene = this.lastScene ?? this.buildChartScene();
    if (!scene.eqOverlay || scene.eqOverlay.bands.length === 0) return;
    const coords = this.getPointerRelativeCoords(e);
    if (!coords) return;

    const hitIdx = findHitEqBandIndex(
      coords.relX,
      coords.relY,
      coords.box.width,
      coords.box.height,
      scene.eqOverlay.bands,
      scene.axis.bounds,
      scene.eqOverlay.referenceZeroDbY
    );
    if (hitIdx !== null) {
      this.draggingEqBandIndex = hitIdx;
      (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    }
  };

  private handleStagePointerMove = (e: PointerEvent): void => {
    const coords = this.getPointerRelativeCoords(e);
    if (!coords) return;
    const scene = this.lastScene ?? this.buildChartScene();

    if (this.draggingEqBandIndex !== null && scene.eqOverlay) {
      const { frequency, gainDb } = computeDraggedEqBand(
        coords.relX,
        coords.relY,
        coords.box.width,
        coords.box.height,
        scene.axis.bounds,
        scene.eqOverlay.referenceZeroDbY
      );
      this.onEqBandDrag({
        bandIndex: this.draggingEqBandIndex,
        frequency,
        gainDb,
      });
      return;
    }

    if (
      coords.relX < 0 ||
      coords.relX > coords.box.width ||
      coords.relY < 0 ||
      coords.relY > coords.box.height
    ) {
      if (this.cursorDomainX !== null) {
        this.cursorDomainX = null;
        this.canvasController.requestRepaint();
      }
      return;
    }

    const normX = coords.relX / Math.max(1, coords.box.width);
    const isLogX = scene.axis.xScale === 'log';
    this.cursorDomainX = normXToValue(
      normX,
      scene.axis.bounds.xMin,
      scene.axis.bounds.xMax,
      isLogX
    );
    this.canvasController.requestRepaint();
  };

  private handleStagePointerUp = (e: PointerEvent): void => {
    if (this.draggingEqBandIndex !== null) {
      this.draggingEqBandIndex = null;
      (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
      this.onEqBandDragEnd();
    }
  };

  private handleStagePointerLeave = (): void => {
    if (this.draggingEqBandIndex !== null) {
      this.draggingEqBandIndex = null;
      this.onEqBandDragEnd();
    }
    if (this.cursorDomainX !== null) {
      this.cursorDomainX = null;
      this.canvasController.requestRepaint();
    }
  };

  public render() {
    return html`
      ${this.renderHeader()}
      <div
        class="stage"
        @pointerdown=${this.handleStagePointerDown}
        @pointermove=${this.handleStagePointerMove}
        @pointerup=${this.handleStagePointerUp}
        @pointerleave=${this.handleStagePointerLeave}
      >
        <canvas class="gl-canvas"></canvas>
        <canvas class="overlay-canvas"></canvas>
      </div>
    `;
  }
}

@customElement('foh-chart-panel')
export class FohChartPanel extends FohChartPanelBase {
  @property({ attribute: false })
  public scene: ChartScene = {
    axis: {
      xScale: 'log',
      xUnit: 'Hz',
      yUnit: 'dB',
      bounds: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24, yStep: 6 },
    },
  };

  @property({ attribute: false })
  public cursorReadoutBuilder:
    | ((domainX: number, scene: ChartScene) => CursorReadoutModel | null)
    | null = null;

  protected buildChartScene(): ChartScene {
    return this.scene;
  }

  protected buildCursorReadout(
    domainX: number,
    scene: ChartScene
  ): CursorReadoutModel | null {
    return this.cursorReadoutBuilder ? this.cursorReadoutBuilder(domainX, scene) : null;
  }

  protected renderHeader(): TemplateResult {
    return html`
      <div class="chart-header">
        <div class="header-left"><slot name="header-left"></slot></div>
        <div class="header-center"><slot name="header-center"></slot></div>
        <div class="header-right"><slot name="header-right"></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-chart-panel': FohChartPanel;
  }
}
