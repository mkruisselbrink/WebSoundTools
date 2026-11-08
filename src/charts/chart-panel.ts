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

/**
 * Interactive Acoustic Chart Panel (`<chart-panel>` Lit 3 Web Component).
 *
 * Coordinates `<canvas>` lifecycle, `ResizeObserver`, and `requestAnimationFrame` scheduling,
 * delegating 2D rendering to `canvas-chart-painter.ts`, WebGL2 trace drawing to `gl-trace-renderer.ts`,
 * header UI to `chart-header-view.ts`, and mouse hit-testing/zoom math to `chart-interaction.ts`.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { BiquadSpec } from '../dsp/biquad.js';
import { SourceData } from '../sources/source-data.js';
import {
  ChartPlotBox,
  drawCanvasTrace,
  drawCursorCrosshair,
  drawEqHandles,
  drawGridAndAxes,
  drawRtaOctaveBars,
  drawRtaPeakLine,
} from './canvas-chart-painter.js';
import { RtaDisplayMode, renderChartHeader } from './chart-header-view.js';
import {
  ChartAxisBounds,
  computeDraggedEqBand,
  computeZoomedYRange,
  findHitEqBandIndex,
} from './chart-interaction.js';
import { GlTraceRenderer } from './gl-trace-renderer.js';
import {
  CursorAcousticReadout,
  PLOT_METADATA,
  PlotType,
  buildTraceVertices,
  computeCursorReadout,
  normXToValue,
} from './plot-types.js';

export type { RtaDisplayMode };

@customElement('chart-panel')
export class ChartPanelElement extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      user-select: none;
      min-height: 190px;
      flex: 1 1 0;
    }

    .chart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 10px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      font-size: 12px;
      color: #e2e8f0;
      flex-wrap: wrap;
    }

    .header-left,
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    select,
    button {
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #475569;
      border-radius: 4px;
      padding: 3px 7px;
      font-size: 11px;
      cursor: pointer;
    }

    select:hover,
    button:hover {
      border-color: #38bdf8;
    }

    .cursor-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 2px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #cbd5e1;
    }

    .cursor-source-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
    }

    .swatch {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .viewport {
      position: relative;
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 150px;
    }

    canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: block;
    }

    .label-muted {
      color: #94a3b8;
      font-size: 11px;
    }
  `;

  @property({ type: String })
  plotType: PlotType = 'magnitude';

  @property({ attribute: false })
  sources: SourceData[] = [];

  @property({ attribute: false })
  eqBands: BiquadSpec[] | null = null;

  @property({ type: Boolean })
  coherenceAlpha: boolean = true;

  @property({ type: Number })
  coherenceThreshold: number = 0.35;

  @state()
  private rtaMode: RtaDisplayMode = 'bars-3';

  @state()
  private showPeakHold: boolean = true;

  @state()
  private xMin: number = 20;

  @state()
  private xMax: number = 20000;

  @state()
  private yMin: number = -24;

  @state()
  private yMax: number = 24;

  @state()
  private cursorDomainX: number | null = null;

  @state()
  private cursorReadout: CursorAcousticReadout | null = null;

  @query('#glCanvas')
  private glCanvas!: HTMLCanvasElement;

  @query('#overlayCanvas')
  private overlayCanvas!: HTMLCanvasElement;

  @query('.viewport')
  private viewportEl!: HTMLDivElement;

  private glRenderer: GlTraceRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private draggingEqBandIndex: number | null = null;
  private rafId: number | null = null;

  private readonly padLeft = 52;
  private readonly padRight = 16;
  private readonly padTop = 12;
  private readonly padBottom = 24;

  connectedCallback(): void {
    super.connectedCallback();
    this.applyDefaultBoundsForPlot(this.plotType);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  protected firstUpdated(): void {
    this.glRenderer = new GlTraceRenderer(this.glCanvas);
    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasDimensions();
      this.drawFrame();
    });
    this.resizeObserver.observe(this.viewportEl);
    this.syncCanvasDimensions();
    this.drawFrame();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('plotType')) {
      this.applyDefaultBoundsForPlot(this.plotType);
    }
    this.scheduleDrawFrame();
  }

  private scheduleDrawFrame(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.drawFrame();
      });
    } else {
      this.drawFrame();
    }
  }

  private getAxisBounds(): ChartAxisBounds {
    return {
      xMin: this.xMin,
      xMax: this.xMax,
      yMin: this.yMin,
      yMax: this.yMax,
    };
  }

  private applyDefaultBoundsForPlot(type: PlotType): void {
    const meta = PLOT_METADATA[type];
    this.xMin = meta.defaultXMin;
    this.xMax = meta.defaultXMax;
    this.yMin = meta.defaultYMin;
    this.yMax = meta.defaultYMax;
    this.cursorDomainX = null;
    this.cursorReadout = null;
  }

  private syncCanvasDimensions(): void {
    if (!this.viewportEl || !this.glCanvas || !this.overlayCanvas) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(100, Math.floor(rect.width * dpr));
    const h = Math.max(80, Math.floor(rect.height * dpr));

    if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
      this.glCanvas.width = w;
      this.glCanvas.height = h;
      this.overlayCanvas.width = w;
      this.overlayCanvas.height = h;
    }
  }

  private onPlotTypeChange = (e: Event): void => {
    const nextType = (e.target as HTMLSelectElement).value as PlotType;
    this.plotType = nextType;
    this.dispatchEvent(
      new CustomEvent('plot-type-change', {
        detail: { plotType: nextType },
        bubbles: true,
        composed: true,
      })
    );
  };

  private resetZoom = (): void => {
    this.applyDefaultBoundsForPlot(this.plotType);
    this.drawFrame();
  };

  private zoomY = (factor: number): void => {
    const next = computeZoomedYRange(this.yMin, this.yMax, factor);
    this.yMin = next.yMin;
    this.yMax = next.yMax;
  };

  private handleMouseMove(e: MouseEvent): void {
    if (!this.overlayCanvas) return;
    const rect = this.overlayCanvas.getBoundingClientRect();
    const plotW = Math.max(10, rect.width - this.padLeft - this.padRight);
    const plotH = Math.max(10, rect.height - this.padTop - this.padBottom);
    const relX = e.clientX - rect.left - this.padLeft;
    const relY = e.clientY - rect.top - this.padTop;

    if (this.draggingEqBandIndex !== null && this.eqBands && this.plotType === 'magnitude') {
      const { frequency, gainDb } = computeDraggedEqBand(
        relX,
        relY,
        plotW,
        plotH,
        this.getAxisBounds()
      );
      this.dispatchEvent(
        new CustomEvent('eq-band-drag', {
          detail: {
            bandIndex: this.draggingEqBandIndex,
            frequency,
            gainDb,
          },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    if (relX < 0 || relX > plotW || relY < 0 || relY > plotH) {
      this.cursorDomainX = null;
      this.cursorReadout = null;
      return;
    }

    const meta = PLOT_METADATA[this.plotType];
    const normX = relX / plotW;
    const domainX = normXToValue(normX, this.xMin, this.xMax, meta.isLogX);
    this.cursorDomainX = domainX;
    this.cursorReadout = computeCursorReadout(this.plotType, domainX, this.sources);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.plotType !== 'magnitude' || !this.eqBands || this.eqBands.length === 0) return;
    const rect = this.overlayCanvas.getBoundingClientRect();
    const plotW = Math.max(10, rect.width - this.padLeft - this.padRight);
    const plotH = Math.max(10, rect.height - this.padTop - this.padBottom);
    const mouseX = e.clientX - rect.left - this.padLeft;
    const mouseY = e.clientY - rect.top - this.padTop;

    this.draggingEqBandIndex = findHitEqBandIndex(
      mouseX,
      mouseY,
      plotW,
      plotH,
      this.eqBands,
      this.getAxisBounds()
    );
  }

  private handleMouseUp(): void {
    this.draggingEqBandIndex = null;
  }

  private handleMouseLeave(): void {
    this.draggingEqBandIndex = null;
    this.cursorDomainX = null;
    this.cursorReadout = null;
  }

  drawFrame(): void {
    if (!this.overlayCanvas || !this.viewportEl) return;
    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const widthCss = this.overlayCanvas.width / dpr;
    const heightCss = this.overlayCanvas.height / dpr;

    const box: ChartPlotBox = {
      plotLeft: this.padLeft,
      plotTop: this.padTop,
      plotW: Math.max(10, widthCss - this.padLeft - this.padRight),
      plotH: Math.max(10, heightCss - this.padTop - this.padBottom),
    };
    const bounds = this.getAxisBounds();

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);

    if (this.glRenderer && this.glRenderer.isWebGlAvailable()) {
      this.glRenderer.clear(
        box.plotLeft * dpr,
        box.plotTop * dpr,
        box.plotW * dpr,
        box.plotH * dpr,
        this.overlayCanvas.height
      );
    }

    drawGridAndAxes(ctx, this.plotType, bounds, box);

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.plotLeft, box.plotTop, box.plotW, box.plotH);
    ctx.clip();

    const visibleSources = this.sources.filter((s) => s.visible && s.active);

    if (this.plotType === 'rta' && this.rtaMode !== 'line') {
      const bpo = this.rtaMode === 'bars-3' ? 3 : this.rtaMode === 'bars-6' ? 6 : 12;
      drawRtaOctaveBars(ctx, visibleSources, bpo, this.showPeakHold, bounds, box);
    } else {
      for (const src of visibleSources) {
        const vBuf = buildTraceVertices(
          src,
          this.plotType,
          this.xMin,
          this.xMax,
          this.yMin,
          this.yMax,
          this.coherenceAlpha,
          this.coherenceThreshold
        );

        if (this.glRenderer && this.glRenderer.isWebGlAvailable()) {
          this.glRenderer.drawTrace(vBuf.vertices, vBuf.vertexCount, src.color, 0.9);
        }

        drawCanvasTrace(ctx, vBuf.vertices, vBuf.vertexCount, src.color, box);

        if (this.plotType === 'rta' && this.showPeakHold) {
          drawRtaPeakLine(ctx, src, bounds, box);
        }
      }
    }

    if (this.plotType === 'magnitude' && this.eqBands && this.eqBands.length > 0) {
      drawEqHandles(ctx, this.eqBands, bounds, box);
    }

    if (this.cursorDomainX !== null) {
      const meta = PLOT_METADATA[this.plotType];
      drawCursorCrosshair(ctx, this.cursorDomainX, meta.isLogX, bounds, box);
    }

    ctx.restore();
    ctx.restore();
  }

  render() {
    return html`
      ${renderChartHeader({
        plotType: this.plotType,
        rtaMode: this.rtaMode,
        showPeakHold: this.showPeakHold,
        coherenceAlpha: this.coherenceAlpha,
        cursorReadout: this.cursorReadout,
        onPlotTypeChange: this.onPlotTypeChange,
        onRtaModeChange: (mode) => {
          this.rtaMode = mode;
        },
        onTogglePeakHold: (enabled) => {
          this.showPeakHold = enabled;
        },
        onToggleCoherenceAlpha: (enabled) => {
          this.coherenceAlpha = enabled;
        },
        onZoomY: this.zoomY,
        onResetZoom: this.resetZoom,
      })}

      <div
        class="viewport"
        @mousemove=${this.handleMouseMove}
        @mousedown=${this.handleMouseDown}
        @mouseup=${this.handleMouseUp}
        @mouseleave=${this.handleMouseLeave}
      >
        <canvas id="glCanvas"></canvas>
        <canvas id="overlayCanvas"></canvas>
      </div>
    `;
  }
}
