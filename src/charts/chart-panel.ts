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
 * Supports:
 *  - All 8 plot types: Magnitude, Phase, RTA (Line & 1/3..1/12 Oct Bars + Peak Hold),
 *    Coherence, Impulse (Linear), Impulse (ETC dB), Step Response, and Group Delay
 *  - Coherence-weighted trace opacity (fades noisy frequency regions automatically)
 *  - Artifact-free Phase wrap-around handling at +/-180 deg
 *  - Interactive hover cursor showing Frequency (Hz), Period (ms), Wavelength (m & ft),
 *    and per-source dB / Phase / Coherence readouts
 *  - Interactive Virtual EQ band handles directly draggable on the Magnitude plot!
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { BiquadSpec } from '../dsp/biquad.js';
import { aggregateFractionalOctaveBands } from '../dsp/smoothing.js';
import { SourceData } from '../sources/source-data.js';
import { GlTraceRenderer } from './gl-trace-renderer.js';
import {
  CursorAcousticReadout,
  ISO_FREQUENCY_GRID_LINES,
  ISO_MAJOR_FREQUENCIES,
  PLOT_METADATA,
  PlotType,
  buildTraceVertices,
  computeCursorReadout,
  formatFrequencyLabel,
  normXToValue,
  valueToNormX,
  valueToNormY,
} from './plot-types.js';

export type RtaDisplayMode = 'line' | 'bars-3' | 'bars-6' | 'bars-12';

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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
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

  private onPlotTypeChange(e: Event): void {
    const nextType = (e.target as HTMLSelectElement).value as PlotType;
    this.plotType = nextType;
    this.dispatchEvent(
      new CustomEvent('plot-type-change', {
        detail: { plotType: nextType },
        bubbles: true,
        composed: true,
      })
    );
  }

  private resetZoom(): void {
    this.applyDefaultBoundsForPlot(this.plotType);
    this.drawFrame();
  }

  private zoomY(factor: number): void {
    const center = 0.5 * (this.yMin + this.yMax);
    const halfSpan = Math.max(1, 0.5 * (this.yMax - this.yMin) * factor);
    this.yMin = Math.round((center - halfSpan) * 10) / 10;
    this.yMax = Math.round((center + halfSpan) * 10) / 10;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.overlayCanvas) return;
    const rect = this.overlayCanvas.getBoundingClientRect();
    const plotW = Math.max(10, rect.width - this.padLeft - this.padRight);
    const plotH = Math.max(10, rect.height - this.padTop - this.padBottom);
    const relX = e.clientX - rect.left - this.padLeft;
    const relY = e.clientY - rect.top - this.padTop;

    if (this.draggingEqBandIndex !== null && this.eqBands && this.plotType === 'magnitude') {
      const normX = Math.max(0.01, Math.min(0.99, relX / plotW));
      const normY = Math.max(0.0, Math.min(1.0, 1.0 - relY / plotH));
      const newFreq = Math.round(normXToValue(normX, this.xMin, this.xMax, true));
      const newGainDb =
        Math.round(Math.max(-18, Math.min(18, this.yMin + normY * (this.yMax - this.yMin))) * 2) /
        2;

      this.dispatchEvent(
        new CustomEvent('eq-band-drag', {
          detail: {
            bandIndex: this.draggingEqBandIndex,
            frequency: newFreq,
            gainDb: newGainDb,
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

    // Check if mouse is near an EQ band handle (within 12px)
    for (let i = 0; i < this.eqBands.length; i++) {
      const b = this.eqBands[i];
      if (b.enabled === false) continue;
      const bx = valueToNormX(b.frequency, this.xMin, this.xMax, true) * plotW;
      const by = (1.0 - valueToNormY(b.gainDb ?? 0, this.yMin, this.yMax)) * plotH;
      if (Math.hypot(mouseX - bx, mouseY - by) <= 12) {
        this.draggingEqBandIndex = i;
        return;
      }
    }
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

    const plotLeft = this.padLeft;
    const plotTop = this.padTop;
    const plotW = Math.max(10, widthCss - this.padLeft - this.padRight);
    const plotH = Math.max(10, heightCss - this.padTop - this.padBottom);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);

    if (this.glRenderer && this.glRenderer.isWebGlAvailable()) {
      this.glRenderer.clear(
        plotLeft * dpr,
        plotTop * dpr,
        plotW * dpr,
        plotH * dpr,
        this.overlayCanvas.height
      );
    }

    this.drawGridAndAxes(ctx, plotLeft, plotTop, plotW, plotH);

    // Clip to plot area for traces & bars
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, plotTop, plotW, plotH);
    ctx.clip();

    const visibleSources = this.sources.filter((s) => s.visible && s.active);

    if (this.plotType === 'rta' && this.rtaMode !== 'line') {
      const bpo = this.rtaMode === 'bars-3' ? 3 : this.rtaMode === 'bars-6' ? 6 : 12;
      this.drawRtaOctaveBars(ctx, visibleSources, bpo, plotLeft, plotTop, plotW, plotH);
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

        // Draw on WebGL2 layer
        if (this.glRenderer && this.glRenderer.isWebGlAvailable()) {
          this.glRenderer.drawTrace(vBuf.vertices, vBuf.vertexCount, src.color, 0.9);
        }

        // Also draw anti-aliased 2px stroke on HiDPI canvas (since WebGL2 gl.lineWidth is capped at 1px on Metal/ANGLE)
        this.drawCanvasTrace(ctx, vBuf.vertices, vBuf.vertexCount, src.color, plotLeft, plotTop, plotW, plotH);

        // Optional RTA Peak Hold trace
        if (this.plotType === 'rta' && this.showPeakHold) {
          this.drawRtaPeakLine(ctx, src, plotLeft, plotTop, plotW, plotH);
        }
      }
    }

    // Draw interactive EQ band handles if on Magnitude plot
    if (this.plotType === 'magnitude' && this.eqBands && this.eqBands.length > 0) {
      this.drawEqHandles(ctx, this.eqBands, plotLeft, plotTop, plotW, plotH);
    }

    // Draw hover cursor crosshair
    if (this.cursorDomainX !== null) {
      const meta = PLOT_METADATA[this.plotType];
      const normX = valueToNormX(this.cursorDomainX, this.xMin, this.xMax, meta.isLogX);
      if (normX >= 0 && normX <= 1) {
        const cx = plotLeft + normX * plotW;
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, plotTop);
        ctx.lineTo(cx, plotTop + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
    ctx.restore();
  }

  private drawGridAndAxes(
    ctx: CanvasRenderingContext2D,
    plotLeft: number,
    plotTop: number,
    plotW: number,
    plotH: number
  ): void {
    const meta = PLOT_METADATA[this.plotType];

    // Plot background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(plotLeft, plotTop, plotW, plotH);

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

    // Horizontal Y grid lines & labels
    const ySpan = this.yMax - this.yMin;
    let yStep = meta.yStep;
    if (ySpan / yStep > 10) yStep *= 2;
    else if (ySpan / yStep < 3) yStep /= 2;

    const firstY = Math.ceil(this.yMin / yStep) * yStep;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let yVal = firstY; yVal <= this.yMax + 1e-6; yVal += yStep) {
      const normY = valueToNormY(yVal, this.yMin, this.yMax);
      const py = plotTop + (1.0 - normY) * plotH;

      const isZero = Math.abs(yVal) < 1e-5;
      ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
      ctx.lineWidth = isZero ? 1.25 : 1.0;
      ctx.beginPath();
      ctx.moveTo(plotLeft, py);
      ctx.lineTo(plotLeft + plotW, py);
      ctx.stroke();

      ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
      const decimals = yStep < 1 ? 2 : 0;
      ctx.fillText(`${yVal.toFixed(decimals)}${meta.yUnit === 'deg' ? '°' : ''}`, plotLeft - 6, py);
    }

    // Vertical X grid lines & labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    if (meta.isLogX) {
      for (const f of ISO_FREQUENCY_GRID_LINES) {
        if (f < this.xMin || f > this.xMax) continue;
        const normX = valueToNormX(f, this.xMin, this.xMax, true);
        const px = plotLeft + normX * plotW;
        const isMajor = ISO_MAJOR_FREQUENCIES.includes(f);

        ctx.strokeStyle = isMajor ? '#26334d' : '#151e30';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(px, plotTop);
        ctx.lineTo(px, plotTop + plotH);
        ctx.stroke();

        if (isMajor) {
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(formatFrequencyLabel(f), px, plotTop + plotH + 5);
        }
      }
    } else {
      const xSpan = this.xMax - this.xMin;
      const xStep = xSpan <= 20 ? 2 : xSpan <= 50 ? 5 : 10;
      const firstX = Math.ceil(this.xMin / xStep) * xStep;
      for (let xVal = firstX; xVal <= this.xMax + 1e-6; xVal += xStep) {
        const normX = valueToNormX(xVal, this.xMin, this.xMax, false);
        const px = plotLeft + normX * plotW;
        const isZero = Math.abs(xVal) < 1e-5;

        ctx.strokeStyle = isZero ? '#475569' : '#1e293b';
        ctx.lineWidth = isZero ? 1.25 : 1.0;
        ctx.beginPath();
        ctx.moveTo(px, plotTop);
        ctx.lineTo(px, plotTop + plotH);
        ctx.stroke();

        ctx.fillStyle = isZero ? '#f8fafc' : '#94a3b8';
        ctx.fillText(`${xVal}ms`, px, plotTop + plotH + 5);
      }
    }

    // Plot border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft, plotTop, plotW, plotH);
  }

  private drawCanvasTrace(
    ctx: CanvasRenderingContext2D,
    vertices: Float32Array,
    vertexCount: number,
    color: string,
    plotLeft: number,
    plotTop: number,
    plotW: number,
    plotH: number
  ): void {
    if (vertexCount < 2) return;
    ctx.lineWidth = 1.85;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;

    // Group adjacent vertices with similar quantized alpha into batches for fast drawing
    let currentAlphaBucket = -1;
    let pathOpen = false;

    for (let i = 0; i < vertexCount; i++) {
      const ndcX = vertices[i * 3];
      const ndcY = vertices[i * 3 + 1];
      const alpha = vertices[i * 3 + 2];

      const px = plotLeft + (ndcX + 1.0) * 0.5 * plotW;
      const py = plotTop + (1.0 - (ndcY + 1.0) * 0.5) * plotH;

      if (alpha <= 0.01) {
        if (pathOpen) {
          ctx.stroke();
          pathOpen = false;
        }
        currentAlphaBucket = -1;
        continue;
      }

      // Quantize alpha into 8 levels so coherence fading is smooth yet fast
      const bucket = Math.max(1, Math.min(8, Math.round(alpha * 8)));
      if (bucket !== currentAlphaBucket) {
        if (pathOpen) {
          ctx.lineTo(px, py);
          ctx.stroke();
        }
        currentAlphaBucket = bucket;
        ctx.globalAlpha = bucket / 8.0;
        ctx.beginPath();
        ctx.moveTo(px, py);
        pathOpen = true;
      } else {
        ctx.lineTo(px, py);
      }
    }

    if (pathOpen) {
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  }

  private drawRtaOctaveBars(
    ctx: CanvasRenderingContext2D,
    sources: readonly SourceData[],
    bandsPerOctave: 3 | 6 | 12,
    plotLeft: number,
    plotTop: number,
    plotW: number,
    plotH: number
  ): void {
    const numSources = sources.length;
    if (numSources === 0) return;

    sources.forEach((src, sIdx) => {
      const bands = aggregateFractionalOctaveBands(
        src.freqData.frequency,
        src.freqData.module,
        src.freqData.peakSquared,
        bandsPerOctave
      );
      const count = bands.centerFrequencies.length;
      const totalBarSlotW = (plotW / Math.max(10, count)) * 0.78;
      const singleBarW = Math.max(2, totalBarSlotW / numSources);

      ctx.fillStyle = src.color;
      ctx.strokeStyle = src.color;

      for (let b = 0; b < count; b++) {
        const fc = bands.centerFrequencies[b];
        if (fc < this.xMin || fc > this.xMax) continue;

        const normX = valueToNormX(fc, this.xMin, this.xMax, true);
        const centerX = plotLeft + normX * plotW;
        const barX = centerX - totalBarSlotW * 0.5 + sIdx * singleBarW;

        const db =
          bands.magnitudes[b] > 1e-10
            ? 20 * Math.log10(bands.magnitudes[b]) + src.gainOffsetDb
            : -140;
        const normY = Math.max(0, Math.min(1, valueToNormY(db, this.yMin, this.yMax)));
        const barTop = plotTop + (1.0 - normY) * plotH;
        const barH = plotTop + plotH - barTop;

        ctx.globalAlpha = 0.72;
        ctx.fillRect(barX, barTop, Math.max(1.5, singleBarW - 1), barH);

        if (this.showPeakHold) {
          const peakDb =
            bands.peaks[b] > 1e-10
              ? 20 * Math.log10(bands.peaks[b]) + src.gainOffsetDb
              : -140;
          const peakNormY = Math.max(0, Math.min(1, valueToNormY(peakDb, this.yMin, this.yMax)));
          const peakY = plotTop + (1.0 - peakNormY) * plotH;
          ctx.globalAlpha = 1.0;
          ctx.fillRect(barX, peakY - 1.5, Math.max(1.5, singleBarW - 1), 2);
        }
      }
    });
    ctx.globalAlpha = 1.0;
  }

  private drawRtaPeakLine(
    ctx: CanvasRenderingContext2D,
    src: SourceData,
    plotLeft: number,
    plotTop: number,
    plotW: number,
    plotH: number
  ): void {
    const fd = src.freqData;
    ctx.strokeStyle = src.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    let started = false;
    for (let i = 1; i < fd.length; i++) {
      const f = fd.frequency[i];
      if (f < this.xMin || f > this.xMax) continue;
      const pkDb =
        fd.peakSquared[i] > 1e-20
          ? 10 * Math.log10(fd.peakSquared[i]) + src.gainOffsetDb
          : -140;
      const px = plotLeft + valueToNormX(f, this.xMin, this.xMax, true) * plotW;
      const py = plotTop + (1.0 - valueToNormY(pkDb, this.yMin, this.yMax)) * plotH;
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  private drawEqHandles(
    ctx: CanvasRenderingContext2D,
    bands: readonly BiquadSpec[],
    plotLeft: number,
    plotTop: number,
    plotW: number,
    plotH: number
  ): void {
    bands.forEach((b, idx) => {
      if (b.enabled === false) return;
      const px = plotLeft + valueToNormX(b.frequency, this.xMin, this.xMax, true) * plotW;
      const py = plotTop + (1.0 - valueToNormY(b.gainDb ?? 0, this.yMin, this.yMax)) * plotH;

      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#052e16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`EQ${idx + 1}`, px, py - 8);
    });
  }

  render() {
    const meta = PLOT_METADATA[this.plotType];
    const ro = this.cursorReadout;

    return html`
      <div class="chart-header">
        <div class="header-left">
          <select
            aria-label="Plot Type"
            .value=${this.plotType}
            @change=${this.onPlotTypeChange}
          >
            ${Object.values(PLOT_METADATA).map(
              (m) => html`<option value=${m.type} ?selected=${m.type === this.plotType}>${m.label}</option>`
            )}
          </select>

          ${this.plotType === 'rta'
            ? html`
                <select
                  aria-label="RTA Mode"
                  .value=${this.rtaMode}
                  @change=${(e: Event) => {
                    this.rtaMode = (e.target as HTMLSelectElement).value as RtaDisplayMode;
                  }}
                >
                  <option value="bars-3">1/3 Oct Bars</option>
                  <option value="bars-6">1/6 Oct Bars</option>
                  <option value="bars-12">1/12 Oct Bars</option>
                  <option value="line">Narrowband Line</option>
                </select>
                <label class="label-muted" style="display:flex;align-items:center;gap:3px;cursor:pointer;">
                  <input
                    type="checkbox"
                    .checked=${this.showPeakHold}
                    @change=${(e: Event) => {
                      this.showPeakHold = (e.target as HTMLInputElement).checked;
                    }}
                  />
                  Peak Hold
                </label>
              `
            : nothing}

          ${this.plotType === 'magnitude' || this.plotType === 'phase'
            ? html`
                <label
                  class="label-muted"
                  title="Fade trace opacity in frequency regions with low coherence"
                  style="display:flex;align-items:center;gap:3px;cursor:pointer;"
                >
                  <input
                    type="checkbox"
                    .checked=${this.coherenceAlpha}
                    @change=${(e: Event) => {
                      this.coherenceAlpha = (e.target as HTMLInputElement).checked;
                    }}
                  />
                  Coherence Alpha
                </label>
              `
            : nothing}
        </div>

        ${ro
          ? html`
              <div class="cursor-pill" data-testid="cursor-readout">
                ${ro.isFrequencyDomain
                  ? html`
                      <span><strong>${ro.frequencyHz!.toFixed(0)} Hz</strong></span>
                      <span class="label-muted">${ro.periodMs!.toFixed(2)} ms</span>
                      <span class="label-muted">λ ${ro.wavelengthMeters!.toFixed(2)} m (${ro.wavelengthFeet!.toFixed(1)} ft)</span>
                    `
                  : html`<span><strong>${ro.xValue.toFixed(2)} ms</strong></span>`}
                ${ro.sourceValues.map(
                  (sv) => html`
                    <span class="cursor-source-badge" style="color:${sv.color}">
                      <span class="swatch" style="background:${sv.color}"></span>
                      ${sv.formattedValue}
                      ${sv.coherencePct !== undefined && this.plotType !== 'coherence'
                        ? html`<span class="label-muted">(γ² ${sv.coherencePct}%)</span>`
                        : nothing}
                    </span>
                  `
                )}
              </div>
            `
          : html`<span class="label-muted">Hover chart for acoustic cursor (${meta.xUnit} / ${meta.yUnit})</span>`}

        <div class="header-right">
          <button title="Zoom In Y Axis" @click=${() => this.zoomY(0.75)}>Y+</button>
          <button title="Zoom Out Y Axis" @click=${() => this.zoomY(1.333)}>Y−</button>
          <button title="Reset Axis Range" @click=${this.resetZoom}>Reset</button>
        </div>
      </div>

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

