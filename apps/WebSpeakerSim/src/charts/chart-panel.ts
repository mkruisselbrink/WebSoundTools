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
 * `<wss-chart-panel>` Lit 3 Web Component (`src/charts/chart-panel.ts`) rendering
 * Virtual Microphone Magnitude, Phase, Group Delay, Impulse Arrivals, and Audience SPL Histogram.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ProjectStore } from '../model/project-store.js';
import type { SimulationSnapshot } from '../physics/sim-controller.js';
import { getChartPlotBox, paintChartCanvas } from './canvas-chart-painter.js';
import { GlTraceRenderer } from './gl-trace-renderer.js';
import {
  computeAdaptivePlotBounds,
  valueToNormX,
  valueToNormY,
  type MagnitudeSpanMode,
  type SimPlotType,
} from './plot-types.js';

const PLOT_TABS: readonly { readonly id: SimPlotType; readonly shortLabel: string }[] = [
  { id: 'magnitude', shortLabel: 'Magnitude (dB)' },
  { id: 'phase', shortLabel: 'Phase (°)' },
  { id: 'group-delay', shortLabel: 'Group Delay' },
  { id: 'arrivals', shortLabel: 'Arrivals' },
  { id: 'histogram', shortLabel: 'SPL Histogram' },
];

@customElement('wss-chart-panel')
export class WssChartPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 150px;
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 6px;
      overflow: hidden;
      user-select: none;
    }

    .chart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 10px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      font-size: 11px;
      flex-wrap: nowrap;
      overflow: hidden;
      min-height: 29px;
    }

    .tab-group {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .tab-btn {
      background: #162033;
      color: #cbd5e1;
      border: 1px solid #263554;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10.5px;
      cursor: pointer;
    }

    .tab-btn:hover {
      background: #1e293b;
    }

    .tab-btn[data-active='true'] {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
      font-weight: 600;
    }

    .span-select {
      background: #090d16;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10.5px;
      margin-left: 4px;
    }

    .span-label {
      color: #94a3b8;
      font-size: 10px;
      margin-left: 6px;
    }

    .legend-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 10.5px;
      color: #cbd5e1;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      min-width: 0;
      overflow-x: auto;
      white-space: nowrap;
      scrollbar-width: none;
    }

    .legend-bar::-webkit-scrollbar {
      display: none;
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
    }

    .dot {
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
      background: #090d16;
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

  @property({ attribute: false })
  public store!: ProjectStore;

  @property({ attribute: false })
  public snapshot: SimulationSnapshot | null = null;

  @property({ type: Number })
  public revision = 0;

  @state()
  public plotType: SimPlotType = 'magnitude';

  @state()
  private magSpanMode: MagnitudeSpanMode = 'auto-60';

  private glCanvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private glRenderer: GlTraceRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private subscribedStore: ProjectStore | null = null;
  private unsubscribeStore: (() => void) | null = null;

  private cssWidth = 0;
  private cssHeight = 0;
  private hoverPx: number | null = null;
  private rafPending = false;
  private readonly vertexScratch = new Float32Array(2048 * 3);

  protected firstUpdated(): void {
    this.glCanvas = this.renderRoot.querySelector('.gl-canvas');
    this.overlayCanvas = this.renderRoot.querySelector('.overlay-canvas');
    const stage = this.renderRoot.querySelector('.stage');

    if (this.glCanvas) {
      this.glRenderer = new GlTraceRenderer(this.glCanvas);
    }

    if (stage) {
      this.resizeObserver = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) this.syncSize(r.width, r.height);
      });
      this.resizeObserver.observe(stage);
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
      this.subscribedStore = null;
    }
    this.resizeObserver?.disconnect();
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
          this.requestRepaint();
        });
      }
    }
    this.requestRepaint();
  }

  private syncSize(w: number, h: number): void {
    this.cssWidth = Math.max(1, Math.floor(w));
    this.cssHeight = Math.max(1, Math.floor(h));
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const devW = Math.max(1, Math.round(this.cssWidth * dpr));
    const devH = Math.max(1, Math.round(this.cssHeight * dpr));

    if (this.glCanvas && (this.glCanvas.width !== devW || this.glCanvas.height !== devH)) {
      this.glCanvas.width = devW;
      this.glCanvas.height = devH;
    }
    if (
      this.overlayCanvas &&
      (this.overlayCanvas.width !== devW || this.overlayCanvas.height !== devH)
    ) {
      this.overlayCanvas.width = devW;
      this.overlayCanvas.height = devH;
    }
    this.requestRepaint();
  }

  private requestRepaint(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.paintNow();
    });
  }

  private paintNow(): void {
    if (!this.store || this.cssWidth <= 0 || this.cssHeight <= 0) return;

    const box = getChartPlotBox(this.cssWidth, this.cssHeight);
    const responses = this.snapshot?.virtualMics ?? [];
    const bounds = computeAdaptivePlotBounds(
      this.plotType,
      responses,
      this.snapshot?.planGrid ?? null,
      this.magSpanMode
    );
    const { xMin, xMax, yMin, yMax, yStep } = bounds;
    const mics = this.store.scene.virtualMics;
    const useGlTraces =
      Boolean(this.glRenderer?.isAvailable) &&
      (this.plotType === 'magnitude' ||
        this.plotType === 'phase' ||
        this.plotType === 'group-delay');

    if (this.glRenderer?.isAvailable && this.glCanvas) {
      const dpr = this.glCanvas.width / this.cssWidth;
      const scLeft = Math.round(box.left * dpr);
      const scBot = Math.round((this.cssHeight - (box.top + box.height)) * dpr);
      const scW = Math.round(box.width * dpr);
      const scH = Math.round(box.height * dpr);
      this.glRenderer.clear(scLeft, scBot, scW, scH);

      if (useGlTraces) {
        const micColorMap = new Map<string, string>();
        for (const m of mics) micColorMap.set(m.id, m.color);

        for (const resp of responses) {
          const freqs = resp.frequenciesHz;
          const ys =
            this.plotType === 'magnitude'
              ? resp.magnitudeDbSpl
              : this.plotType === 'phase'
                ? resp.phaseDeg
                : resp.groupDelayMs;

          let vCount = 0;
          for (let i = 0; i < freqs.length && vCount + 3 < 2048; i++) {
            const nx = valueToNormX(freqs[i], xMin, xMax, true);
            const ny = valueToNormY(ys[i], yMin, yMax);
            const ndcX = ((box.left + nx * box.width) / this.cssWidth) * 2 - 1;
            const ndcY = 1 - ((box.top + (1 - ny) * box.height) / this.cssHeight) * 2;

            if (this.plotType === 'phase' && i > 0 && Math.abs(ys[i] - ys[i - 1]) > 165) {
              // Break across +/-180 deg wrap
              this.vertexScratch[vCount * 3] = this.vertexScratch[(vCount - 1) * 3];
              this.vertexScratch[vCount * 3 + 1] = this.vertexScratch[(vCount - 1) * 3 + 1];
              this.vertexScratch[vCount * 3 + 2] = 0;
              vCount++;
              this.vertexScratch[vCount * 3] = ndcX;
              this.vertexScratch[vCount * 3 + 1] = ndcY;
              this.vertexScratch[vCount * 3 + 2] = 0;
              vCount++;
            }

            this.vertexScratch[vCount * 3] = ndcX;
            this.vertexScratch[vCount * 3 + 1] = ndcY;
            this.vertexScratch[vCount * 3 + 2] = 1.0;
            vCount++;
          }

          this.glRenderer.drawTraceVertices(
            this.vertexScratch,
            vCount,
            micColorMap.get(resp.micId) ?? '#38bdf8'
          );
        }
      }
    }

    if (this.overlayCanvas) {
      const ctx = this.overlayCanvas.getContext('2d');
      if (ctx) {
        const dpr = this.overlayCanvas.width / this.cssWidth;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintChartCanvas(ctx, this.cssWidth, this.cssHeight, {
          plotType: this.plotType,
          box,
          xMin,
          xMax,
          yMin,
          yMax,
          yStep,
          mics,
          responses,
          planGrid: this.snapshot?.planGrid ?? null,
          drawFallbackTraces: !useGlTraces,
          hoverPx: this.hoverPx,
        });
        ctx.restore();
      }
    }
  }

  private handlePointerMove(ev: PointerEvent): void {
    if (!this.overlayCanvas) return;
    const rect = this.overlayCanvas.getBoundingClientRect();
    this.hoverPx = ev.clientX - rect.left;
    this.requestRepaint();
  }

  private handlePointerLeave(): void {
    this.hoverPx = null;
    this.requestRepaint();
  }

  render() {
    const responses = this.snapshot?.virtualMics ?? [];
    const mics = this.store?.scene.virtualMics ?? [];
    const colorMap = new Map(mics.map((m) => [m.id, m.color]));

    return html`
      <div class="chart-header">
        <div class="tab-group">
          ${PLOT_TABS.map(
            (tab) => html`
              <button
                class="tab-btn"
                data-active=${String(this.plotType === tab.id)}
                @click=${() => {
                  this.plotType = tab.id;
                }}
              >
                ${tab.shortLabel}
              </button>
            `
          )}
          ${this.plotType === 'magnitude'
            ? html`
                <span class="span-label">Span:</span>
                <select
                  class="span-select"
                  data-testid="chart-mag-span-select"
                  title="Vertical dB span for Magnitude plot"
                  .value=${this.magSpanMode}
                  @change=${(ev: Event) => {
                    this.magSpanMode = (ev.target as HTMLSelectElement).value as MagnitudeSpanMode;
                  }}
                >
                  <option value="auto-30" ?selected=${this.magSpanMode === 'auto-30'}>
                    30 dB (Zoom)
                  </option>
                  <option value="auto-60" ?selected=${this.magSpanMode === 'auto-60'}>
                    60 dB (Std)
                  </option>
                  <option value="auto-80" ?selected=${this.magSpanMode === 'auto-80'}>
                    80 dB (Wide)
                  </option>
                </select>
              `
            : ''}
        </div>
        <div class="legend-bar">
          ${responses.map(
            (r) => html`
              <span class="legend-item">
                <span class="dot" style="background:${colorMap.get(r.micId) ?? '#38bdf8'}"></span>
                ${r.micName} (${r.broadbandSplADb.toFixed(1)} dBA · t₀ ${r.referenceDelayMs.toFixed(1)} ms)
              </span>
            `
          )}
        </div>
      </div>
      <div
        class="stage"
        @pointermove=${this.handlePointerMove}
        @pointerleave=${this.handlePointerLeave}
      >
        <canvas class="gl-canvas"></canvas>
        <canvas class="overlay-canvas"></canvas>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-chart-panel': WssChartPanel;
  }
}

