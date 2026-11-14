// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `<wss-viewport-panel>` Lit 3 Web Component stacking WebGL2 SPL Heatmap + HiDPI 2D CAD overlay
 * for Plan and Section views.
 */

import { DualCanvasController } from '@foh/canvas';
import { fohTokensCss } from '@foh/ui';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { resolveEffectiveSplRange, type ProjectStore } from '../model/project-store.js';
import type { SimulationSnapshot } from '../physics/sim-controller.js';
import { paintViewportCadOverlay, type ViewportMode } from './canvas-cad-painter.js';
import { GlHeatmapRenderer, type HeatmapGridInput } from './gl-heatmap-renderer.js';
import {
  fitCameraToWorldBox,
  sampleScalarGridBilinear,
  screenToWorld,
  zoomCameraAtScreenPoint,
  type ViewportCamera2D,
} from './viewport-coords.js';
import { ViewportGestureController } from './viewport-interaction.js';

@customElement('wss-viewport-panel')
export class WssViewportPanel extends LitElement {
  static styles = [
    fohTokensCss,
    css`
      :host {
        display: flex;
        flex-direction: column;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 140px;
        background: var(--foh-bg-app);
        border: 1px solid var(--foh-border-subtle);
        border-radius: var(--foh-radius-md);
        overflow: hidden;
        user-select: none;
      }

      .vp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 10px;
        background: var(--foh-bg-header);
        border-bottom: 1px solid var(--foh-border-subtle);
        font-size: 11px;
        color: var(--foh-text-secondary);
        z-index: 3;
      }

      .vp-title {
        font-weight: 600;
        color: var(--foh-text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .vp-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .cursor-readout {
        font-family: var(--foh-font-mono);
        font-size: 10.5px;
        color: var(--foh-text-muted);
      }

      .cursor-spl {
        color: var(--foh-accent-bright);
        font-weight: 600;
      }

      .vp-btn {
        background: #1e293b;
        color: #e2e8f0;
        border: 1px solid var(--foh-border-strong);
        border-radius: var(--foh-radius-sm);
        padding: 2px 7px;
        font-size: 10.5px;
        cursor: pointer;
      }

      .vp-btn:hover {
        background: #334155;
      }

      .vp-btn[data-active='true'] {
        background: var(--foh-accent);
        border-color: var(--foh-accent-bright);
        color: #ffffff;
      }

      .canvas-stage {
        position: relative;
        flex: 1;
        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: crosshair;
      }

      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }

      .cad-canvas {
        z-index: 2;
      }
    `,
  ];

  @property({ type: String })
  public mode: ViewportMode = 'plan';

  @property({ attribute: false })
  public store!: ProjectStore;

  @property({ attribute: false })
  public snapshot: SimulationSnapshot | null = null;

  @property({ type: Number })
  public revision = 0;

  @state()
  private hoverText = '';

  @state()
  private hoverSplText = '';

  @state()
  private rulerActive = false;

  private glRenderer: GlHeatmapRenderer | null = null;
  private gestures: ViewportGestureController | null = null;
  private subscribedStore: ProjectStore | null = null;
  private unsubscribeStore: (() => void) | null = null;

  private camera: ViewportCamera2D | null = null;
  private lastFittedSceneId: string | null = null;

  private readonly stageController = new DualCanvasController(this, {
    maxDevicePixelRatio: 2,
    onResize: () => {
      if (!this.camera && this.store) {
        this.fitView();
        this.lastFittedSceneId = this.store.scene.id;
      }
    },
    onPaint: () => this.paintNow(),
    onContextRestored: () => {
      const glCanvas = this.stageController.underlayCanvas;
      if (glCanvas) {
        this.glRenderer?.dispose();
        this.glRenderer = new GlHeatmapRenderer(glCanvas);
      }
    },
  });

  protected firstUpdated(): void {
    const glCanvas = this.renderRoot.querySelector('.gl-canvas') as HTMLCanvasElement | null;
    const cadCanvas = this.renderRoot.querySelector('.cad-canvas') as HTMLCanvasElement | null;
    const stage = this.renderRoot.querySelector('.canvas-stage') as HTMLElement | null;

    if (glCanvas) {
      this.glRenderer = new GlHeatmapRenderer(glCanvas);
    }

    if (this.store) {
      this.gestures = new ViewportGestureController(
        this.mode,
        this.store,
        (nextCam) => {
          this.camera = nextCam;
          this.stageController.requestRepaint();
        },
        () => this.stageController.requestRepaint()
      );
    }

    if (stage && glCanvas && cadCanvas) {
      this.stageController.attach(stage, glCanvas, cadCanvas);
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
      this.subscribedStore = null;
    }
    this.stageController.detach();
    this.glRenderer?.dispose();
  }

  protected updated(): void {
    if (this.store !== this.subscribedStore) {
      if (this.unsubscribeStore) {
        this.unsubscribeStore();
        this.unsubscribeStore = null;
      }
      this.subscribedStore = this.store ?? null;
      if (this.subscribedStore) {
        this.unsubscribeStore = this.subscribedStore.subscribe(() => {
          this.requestUpdate();
          this.stageController.requestRepaint();
        });
      }
    }

    const { cssWidth, cssHeight } = this.stageController.dimensions;
    if (this.store && cssWidth > 0 && cssHeight > 0) {
      if (!this.camera || this.lastFittedSceneId !== this.store.scene.id) {
        this.fitView();
        this.lastFittedSceneId = this.store.scene.id;
      }
    }
    this.stageController.requestRepaint();
  }

  public fitView(): void {
    const { cssWidth, cssHeight } = this.stageController.dimensions;
    if (!this.store || cssWidth <= 0 || cssHeight <= 0) return;
    if (this.mode === 'plan') {
      const b = this.store.scene.planBounds;
      this.camera = fitCameraToWorldBox(
        b.xMin,
        b.xMax,
        b.yMin,
        b.yMax,
        cssWidth,
        cssHeight
      );
    } else {
      const b = this.store.scene.sectionBounds;
      this.camera = fitCameraToWorldBox(
        b.xMin,
        b.xMax,
        b.zMin,
        b.zMax,
        cssWidth,
        cssHeight
      );
    }
    this.stageController.requestRepaint();
  }

  private toggleRuler(): void {
    this.rulerActive = !this.rulerActive;
    if (this.gestures) {
      this.gestures.rulerToolActive = this.rulerActive;
      if (!this.rulerActive) {
        this.gestures.clearRuler();
      }
    }
  }

  private getActiveHeatmapInput(): HeatmapGridInput | null {
    if (!this.snapshot) return null;
    if (this.mode === 'plan' && this.snapshot.planGrid) {
      const g = this.snapshot.planGrid;
      return {
        cols: g.cols,
        rows: g.rows,
        uMin: g.bounds.xMin,
        uMax: g.bounds.xMax,
        vMin: g.bounds.yMin,
        vMax: g.bounds.yMax,
        splDb: g.splDb,
        surfaceMask: g.surfaceMask,
      };
    }
    if (this.mode === 'section' && this.snapshot.sectionGrid) {
      const g = this.snapshot.sectionGrid;
      return {
        cols: g.cols,
        rows: g.rows,
        uMin: g.bounds.xMin,
        uMax: g.bounds.xMax,
        vMin: g.bounds.zMin,
        vMax: g.bounds.zMax,
        splDb: g.splDb,
      };
    }
    return null;
  }

  private paintNow(): void {
    const { cssWidth, cssHeight, dpr } = this.stageController.dimensions;
    if (!this.store || !this.camera || cssWidth <= 0 || cssHeight <= 0) return;

    const gridInput = this.getActiveHeatmapInput();
    const effectiveRange = resolveEffectiveSplRange(
      this.store.colormap,
      this.snapshot?.planGrid?.stats
    );
    if (!this.stageController.isContextLost) {
      this.glRenderer?.render(
        gridInput,
        this.camera,
        this.store.colormap,
        effectiveRange,
        cssWidth,
        cssHeight
      );
    }

    const cadCanvas = this.stageController.overlayCanvas;
    if (cadCanvas) {
      const ctx = cadCanvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintViewportCadOverlay(ctx, {
          mode: this.mode,
          scene: this.store.scene,
          speakerMap: this.store.getSpeakerMap(),
          selected: this.store.selectedEntity,
          virtualMicResponses: this.snapshot?.virtualMics ?? [],
          camera: this.camera,
          cssWidth,
          cssHeight,
          ruler: this.gestures?.rulerOverlay ?? null,
          colormap: this.store.colormap,
          effectiveSplRange: effectiveRange,
        });
        ctx.restore();
      }
    }
  }

  private handlePointerDown(ev: PointerEvent): void {
    const cadCanvas = this.stageController.overlayCanvas;
    const { cssWidth, cssHeight } = this.stageController.dimensions;
    if (!this.camera || !this.gestures || !cadCanvas) return;
    const rect = cadCanvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    cadCanvas.setPointerCapture(ev.pointerId);
    this.gestures.onPointerDown(ev, this.camera, cssWidth, cssHeight, px, py);
  }

  private handlePointerMove(ev: PointerEvent): void {
    const cadCanvas = this.stageController.overlayCanvas;
    const { cssWidth, cssHeight } = this.stageController.dimensions;
    if (!this.camera || !cadCanvas) return;
    const rect = cadCanvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    this.gestures?.onPointerMove(this.camera, cssWidth, cssHeight, px, py);

    const wp = screenToWorld(this.camera, cssWidth, cssHeight, px, py);
    const vLabel = this.mode === 'plan' ? 'Y' : 'Z';
    this.hoverText = `X ${wp.u.toFixed(1)}m  ${vLabel} ${wp.v.toFixed(1)}m`;

    const g = this.getActiveHeatmapInput();
    if (g) {
      const spl = sampleScalarGridBilinear(
        g.splDb,
        g.cols,
        g.rows,
        g.uMin,
        g.uMax,
        g.vMin,
        g.vMax,
        wp.u,
        wp.v
      );
      this.hoverSplText = spl !== null && spl > -105 ? `${spl.toFixed(1)} dB` : '';
    }
  }

  private handlePointerUp(ev: PointerEvent): void {
    const cadCanvas = this.stageController.overlayCanvas;
    if (cadCanvas?.hasPointerCapture(ev.pointerId)) {
      cadCanvas.releasePointerCapture(ev.pointerId);
    }
    this.gestures?.onPointerUp();
  }

  private handleWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const cadCanvas = this.stageController.overlayCanvas;
    const { cssWidth, cssHeight } = this.stageController.dimensions;
    if (!this.camera || !cadCanvas) return;
    const rect = cadCanvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const factor = Math.exp(-ev.deltaY * 0.0015);
    this.camera = zoomCameraAtScreenPoint(
      this.camera,
      cssWidth,
      cssHeight,
      px,
      py,
      factor
    );
    this.stageController.requestRepaint();
  }

  render() {
    const title =
      this.mode === 'plan'
        ? 'Plan View (Top X–Y)'
        : `Side Section (X–Z @ Y = ${this.store?.scene.sectionBounds.sliceYM.toFixed(1) ?? '0.0'} m)`;

    return html`
      <div class="vp-header">
        <div class="vp-title">
          <span>${title}</span>
          ${this.hoverText
            ? html`<span class="cursor-readout"
                >${this.hoverText}
                ${this.hoverSplText
                  ? html`· <span class="cursor-spl">${this.hoverSplText}</span>`
                  : ''}</span
              >`
            : ''}
        </div>
        <div class="vp-controls">
          <button
            class="vp-btn"
            data-active=${String(this.rulerActive)}
            title="Measure distance & flight time (or Shift+Drag)"
            @click=${this.toggleRuler}
          >
            Ruler
          </button>
          <button class="vp-btn" title="Reset zoom to venue bounds" @click=${this.fitView}>
            Fit
          </button>
        </div>
      </div>
      <div
        class="canvas-stage"
        @pointerdown=${this.handlePointerDown}
        @pointermove=${this.handlePointerMove}
        @pointerup=${this.handlePointerUp}
        @pointercancel=${this.handlePointerUp}
        @dblclick=${this.fitView}
        @wheel=${this.handleWheel}
      >
        <canvas class="gl-canvas"></canvas>
        <canvas class="cad-canvas"></canvas>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-viewport-panel': WssViewportPanel;
  }
}
