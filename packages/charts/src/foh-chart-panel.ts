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
import {
  LitElement,
  html,
  nothing,
  type CSSResultGroup,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  computeAdjustedEqQ,
  computeDraggedEqBand,
  findHitEqBandIndex,
  getEqBandParams,
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
  getChartPlotBox,
  normXToValue,
} from './coord-math.js';
import { fohChartPanelStyles } from './foh-chart-panel.css.js';
import { GlTraceRenderer } from './gl-trace-renderer.js';
import { paintChartScene } from './paint-chart-scene.js';

export { fohChartPanelStyles, paintChartScene };

export abstract class FohChartPanelBase extends LitElement {
  static styles: CSSResultGroup = fohChartPanelStyles;

  @state()
  protected cursorDomainX: number | null = null;

  protected draggingEqBandIndex: number | null = null;
  protected touchScrubbing = false;
  protected chartPadding: ChartPadding = DEFAULT_CHART_PADDING;

  private dragAnchorRelY = 0;
  private dragAnchorFreq = 1000;
  private dragAnchorGainDb = 0;
  private dragAnchorQ = 2.0;
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
    this.dispatchEvent(
      new CustomEvent('eq-band-drag-end', {
        bubbles: true,
        composed: true,
      })
    );
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
    this.touchScrubbing = false;
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

  protected handleStagePointerDown(e: PointerEvent): void {
    const coords = this.getPointerRelativeCoords(e);
    if (!coords) return;
    const scene = this.lastScene ?? this.buildChartScene();

    if (scene.eqOverlay && scene.eqOverlay.bands.length > 0) {
      const hitRadius = e.pointerType === 'touch' ? 22 : 12;
      const hitIdx = findHitEqBandIndex(
        coords.relX,
        coords.relY,
        coords.box.width,
        coords.box.height,
        scene.eqOverlay.bands,
        scene.axis.bounds,
        scene.eqOverlay.referenceZeroDbY,
        hitRadius
      );
      if (hitIdx !== null) {
        const band = scene.eqOverlay.bands[hitIdx];
        const params = getEqBandParams(band);
        this.draggingEqBandIndex = hitIdx;
        this.touchScrubbing = false;
        this.dragAnchorRelY = coords.relY;
        this.dragAnchorFreq = params.frequency;
        this.dragAnchorGainDb = params.gainDb;
        this.dragAnchorQ = params.q;
        (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
        return;
      }
    }

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const insideBox =
        coords.relX >= 0 &&
        coords.relX <= coords.box.width &&
        coords.relY >= 0 &&
        coords.relY <= coords.box.height;
      if (!insideBox) {
        this.touchScrubbing = false;
        if (this.cursorDomainX !== null) {
          this.cursorDomainX = null;
          this.canvasController.requestRepaint();
        }
        return;
      }
      this.touchScrubbing = true;
      (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
      const normX = coords.relX / Math.max(1, coords.box.width);
      const isLogX = scene.axis.xScale === 'log';
      this.cursorDomainX = normXToValue(
        normX,
        scene.axis.bounds.xMin,
        scene.axis.bounds.xMax,
        isLogX
      );
      this.canvasController.requestRepaint();
    }
  }

  protected handleStagePointerMove(e: PointerEvent): void {
    const coords = this.getPointerRelativeCoords(e);
    if (!coords) return;
    const scene = this.lastScene ?? this.buildChartScene();

    if (this.draggingEqBandIndex !== null && scene.eqOverlay) {
      if (e.shiftKey) {
        const octavesDelta = (this.dragAnchorRelY - coords.relY) / 70;
        const q = computeAdjustedEqQ(this.dragAnchorQ, octavesDelta);
        this.onEqBandDrag({
          bandIndex: this.draggingEqBandIndex,
          frequency: this.dragAnchorFreq,
          gainDb: this.dragAnchorGainDb,
          q,
        });
        return;
      }

      const { frequency, gainDb } = computeDraggedEqBand(
        coords.relX,
        coords.relY,
        coords.box.width,
        coords.box.height,
        scene.axis.bounds,
        scene.eqOverlay.referenceZeroDbY
      );
      const band = scene.eqOverlay.bands[this.draggingEqBandIndex];
      this.dragAnchorRelY = coords.relY;
      this.dragAnchorFreq = frequency;
      this.dragAnchorGainDb = gainDb;
      if (band) {
        this.dragAnchorQ = getEqBandParams(band).q;
      }
      this.onEqBandDrag({
        bandIndex: this.draggingEqBandIndex,
        frequency,
        gainDb,
      });
      return;
    }

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (!this.touchScrubbing) return;
      const clampedRelX = Math.max(0, Math.min(coords.box.width, coords.relX));
      const normX = clampedRelX / Math.max(1, coords.box.width);
      const isLogX = scene.axis.xScale === 'log';
      this.cursorDomainX = normXToValue(
        normX,
        scene.axis.bounds.xMin,
        scene.axis.bounds.xMax,
        isLogX
      );
      this.canvasController.requestRepaint();
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
  }

  protected handleStagePointerUp(e: PointerEvent): void {
    if (this.draggingEqBandIndex !== null) {
      this.draggingEqBandIndex = null;
      (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
      this.onEqBandDragEnd();
    }
    if (this.touchScrubbing) {
      this.touchScrubbing = false;
      (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
    }
  }

  protected handleStagePointerCancel(e: PointerEvent): void {
    this.handleStagePointerUp(e);
  }

  protected handleStagePointerLeave(e: PointerEvent): void {
    if (this.draggingEqBandIndex !== null) {
      this.draggingEqBandIndex = null;
      this.onEqBandDragEnd();
    }
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.touchScrubbing = false;
      return;
    }
    if (this.cursorDomainX !== null) {
      this.cursorDomainX = null;
      this.canvasController.requestRepaint();
    }
  }

  private handleStageWheel = (e: WheelEvent): void => {
    if (!e.shiftKey) return;
    const scene = this.lastScene ?? this.buildChartScene();
    if (!scene.eqOverlay || scene.eqOverlay.bands.length === 0) return;
    const coords = this.getPointerRelativeCoords(e);
    if (!coords) return;

    const hitIdx =
      this.draggingEqBandIndex ??
      findHitEqBandIndex(
        coords.relX,
        coords.relY,
        coords.box.width,
        coords.box.height,
        scene.eqOverlay.bands,
        scene.axis.bounds,
        scene.eqOverlay.referenceZeroDbY,
        16
      );
    if (hitIdx === null) return;
    const band = scene.eqOverlay.bands[hitIdx];
    if (!band) return;

    e.preventDefault();
    const params = getEqBandParams(band);
    const step = e.deltaY < 0 ? 0.25 : -0.25;
    const q = computeAdjustedEqQ(params.q, step);
    this.dragAnchorQ = q;
    this.onEqBandDrag({
      bandIndex: hitIdx,
      frequency: params.frequency,
      gainDb: params.gainDb,
      q,
    });
    if (this.draggingEqBandIndex === null) {
      this.onEqBandDragEnd();
    }
  };

  public render() {
    return html`
      ${this.renderHeader()}
      <div
        class="stage"
        @pointerdown=${(e: PointerEvent) => this.handleStagePointerDown(e)}
        @pointermove=${(e: PointerEvent) => this.handleStagePointerMove(e)}
        @pointerup=${(e: PointerEvent) => this.handleStagePointerUp(e)}
        @pointercancel=${(e: PointerEvent) => this.handleStagePointerCancel(e)}
        @pointerleave=${(e: PointerEvent) => this.handleStagePointerLeave(e)}
        @wheel=${this.handleStageWheel}
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
