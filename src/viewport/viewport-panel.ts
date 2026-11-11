/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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

/**
 * `<wss-viewport-panel>` Lit 3 Web Component (`src/viewport/viewport-panel.ts`)
 * stacking WebGL2 SPL Heatmap + HiDPI 2D CAD overlay for Plan and Section views.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ProjectStore } from '../model/project-store.js';
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
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 140px;
      background: #060911;
      border: 1px solid #1e293b;
      border-radius: 6px;
      overflow: hidden;
      user-select: none;
    }

    .vp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 10px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      font-size: 11px;
      color: #cbd5e1;
      z-index: 3;
    }

    .vp-title {
      font-weight: 600;
      color: #f8fafc;
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
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      color: #94a3b8;
    }

    .cursor-spl {
      color: #38bdf8;
      font-weight: 600;
    }

    .vp-btn {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 10.5px;
      cursor: pointer;
    }

    .vp-btn:hover {
      background: #334155;
    }

    .vp-btn[data-active='true'] {
      background: #0284c7;
      border-color: #38bdf8;
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
  `;

  @property({ type: String })
  public mode: ViewportMode = 'plan';

  @property({ attribute: false })
  public store!: ProjectStore;

  @property({ attribute: false })
  public snapshot: SimulationSnapshot | null = null;

  @state()
  private hoverText = '';

  @state()
  private hoverSplText = '';

  @state()
  private rulerActive = false;

  private glCanvas: HTMLCanvasElement | null = null;
  private cadCanvas: HTMLCanvasElement | null = null;
  private glRenderer: GlHeatmapRenderer | null = null;
  private gestures: ViewportGestureController | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private camera: ViewportCamera2D | null = null;
  private lastFittedSceneId: string | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private rafPending = false;

  protected firstUpdated(): void {
    this.glCanvas = this.renderRoot.querySelector('.gl-canvas');
    this.cadCanvas = this.renderRoot.querySelector('.cad-canvas');
    const stage = this.renderRoot.querySelector('.canvas-stage');

    if (this.glCanvas) {
      this.glRenderer = new GlHeatmapRenderer(this.glCanvas);
    }

    if (this.store) {
      this.gestures = new ViewportGestureController(
        this.mode,
        this.store,
        (nextCam) => {
          this.camera = nextCam;
          this.requestRepaint();
        },
        () => this.requestRepaint()
      );
    }

    if (stage) {
      this.resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) return;
        this.syncCanvasSize(rect.width, rect.height);
      });
      this.resizeObserver.observe(stage);
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.glRenderer?.dispose();
  }

  protected updated(): void {
    if (this.store && this.cssWidth > 0 && this.cssHeight > 0) {
      if (!this.camera || this.lastFittedSceneId !== this.store.scene.id) {
        this.fitView();
        this.lastFittedSceneId = this.store.scene.id;
      }
    }
    this.requestRepaint();
  }

  private syncCanvasSize(width: number, height: number): void {
    this.cssWidth = Math.max(1, Math.floor(width));
    this.cssHeight = Math.max(1, Math.floor(height));
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const devW = Math.max(1, Math.round(this.cssWidth * dpr));
    const devH = Math.max(1, Math.round(this.cssHeight * dpr));

    if (this.glCanvas && (this.glCanvas.width !== devW || this.glCanvas.height !== devH)) {
      this.glCanvas.width = devW;
      this.glCanvas.height = devH;
    }
    if (this.cadCanvas && (this.cadCanvas.width !== devW || this.cadCanvas.height !== devH)) {
      this.cadCanvas.width = devW;
      this.cadCanvas.height = devH;
    }

    if (!this.camera && this.store) {
      this.fitView();
      this.lastFittedSceneId = this.store.scene.id;
    }
    this.requestRepaint();
  }

  public fitView(): void {
    if (!this.store || this.cssWidth <= 0 || this.cssHeight <= 0) return;
    if (this.mode === 'plan') {
      const b = this.store.scene.planBounds;
      this.camera = fitCameraToWorldBox(
        b.xMin,
        b.xMax,
        b.yMin,
        b.yMax,
        this.cssWidth,
        this.cssHeight
      );
    } else {
      const b = this.store.scene.sectionBounds;
      this.camera = fitCameraToWorldBox(
        b.xMin,
        b.xMax,
        b.zMin,
        b.zMax,
        this.cssWidth,
        this.cssHeight
      );
    }
    this.requestRepaint();
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

  private requestRepaint(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.paintNow();
    });
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
    if (!this.store || !this.camera || this.cssWidth <= 0 || this.cssHeight <= 0) return;

    const gridInput = this.getActiveHeatmapInput();
    this.glRenderer?.render(
      gridInput,
      this.camera,
      this.store.colormap,
      this.cssWidth,
      this.cssHeight
    );

    if (this.cadCanvas) {
      const ctx = this.cadCanvas.getContext('2d');
      if (ctx) {
        const dpr = this.cadCanvas.width / this.cssWidth;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintViewportCadOverlay(ctx, {
          mode: this.mode,
          scene: this.store.scene,
          speakerMap: this.store.getSpeakerMap(),
          selected: this.store.selectedEntity,
          virtualMicResponses: this.snapshot?.virtualMics ?? [],
          camera: this.camera,
          cssWidth: this.cssWidth,
          cssHeight: this.cssHeight,
          ruler: this.gestures?.rulerOverlay ?? null,
        });
        ctx.restore();
      }
    }
  }

  private handlePointerDown(ev: PointerEvent): void {
    if (!this.camera || !this.gestures || !this.cadCanvas) return;
    const rect = this.cadCanvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    this.cadCanvas.setPointerCapture(ev.pointerId);
    this.gestures.onPointerDown(ev, this.camera, this.cssWidth, this.cssHeight, px, py);
  }

  private handlePointerMove(ev: PointerEvent): void {
    if (!this.camera || !this.cadCanvas) return;
    const rect = this.cadCanvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    this.gestures?.onPointerMove(this.camera, this.cssWidth, this.cssHeight, px, py);

    const wp = screenToWorld(this.camera, this.cssWidth, this.cssHeight, px, py);
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
    if (this.cadCanvas?.hasPointerCapture(ev.pointerId)) {
      this.cadCanvas.releasePointerCapture(ev.pointerId);
    }
    this.gestures?.onPointerUp();
  }

  private handleWheel(ev: WheelEvent): void {
    ev.preventDefault();
    if (!this.camera || !this.cadCanvas) return;
    const rect = this.cadCanvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const factor = Math.exp(-ev.deltaY * 0.0015);
    this.camera = zoomCameraAtScreenPoint(
      this.camera,
      this.cssWidth,
      this.cssHeight,
      px,
      py,
      factor
    );
    this.requestRepaint();
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
