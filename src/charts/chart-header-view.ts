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

import { html, nothing, TemplateResult } from 'lit';
import {
  CursorAcousticReadout,
  PLOT_METADATA,
  PlotType,
} from './plot-types.js';

export type RtaDisplayMode = 'line' | 'bars-3' | 'bars-6' | 'bars-12';

export interface ChartHeaderViewProps {
  readonly plotType: PlotType;
  readonly rtaMode: RtaDisplayMode;
  readonly showPeakHold: boolean;
  readonly coherenceAlpha: boolean;
  readonly cursorReadout: CursorAcousticReadout | null;
  readonly onPlotTypeChange: (e: Event) => void;
  readonly onRtaModeChange: (mode: RtaDisplayMode) => void;
  readonly onTogglePeakHold: (enabled: boolean) => void;
  readonly onToggleCoherenceAlpha: (enabled: boolean) => void;
  readonly onZoomY: (factor: number) => void;
  readonly onResetZoom: () => void;
}

export function renderChartHeader(props: ChartHeaderViewProps): TemplateResult {
  const meta = PLOT_METADATA[props.plotType];
  const ro = props.cursorReadout;

  return html`
    <div class="chart-header">
      <div class="header-left">
        <select
          aria-label="Plot Type"
          .value=${props.plotType}
          @change=${props.onPlotTypeChange}
        >
          ${Object.values(PLOT_METADATA).map(
            (m) =>
              html`<option value=${m.type} ?selected=${m.type === props.plotType}>
                ${m.label}
              </option>`
          )}
        </select>

        ${props.plotType === 'rta'
          ? html`
              <select
                aria-label="RTA Mode"
                .value=${props.rtaMode}
                @change=${(e: Event) =>
                  props.onRtaModeChange(
                    (e.target as HTMLSelectElement).value as RtaDisplayMode
                  )}
              >
                <option value="bars-3">1/3 Oct Bars</option>
                <option value="bars-6">1/6 Oct Bars</option>
                <option value="bars-12">1/12 Oct Bars</option>
                <option value="line">Narrowband Line</option>
              </select>
              <label
                class="label-muted"
                style="display:flex;align-items:center;gap:3px;cursor:pointer;"
              >
                <input
                  type="checkbox"
                  .checked=${props.showPeakHold}
                  @change=${(e: Event) =>
                    props.onTogglePeakHold((e.target as HTMLInputElement).checked)}
                />
                Peak Hold
              </label>
            `
          : nothing}

        ${props.plotType === 'magnitude' || props.plotType === 'phase'
          ? html`
              <label
                class="label-muted"
                title="Fade trace opacity in frequency regions with low coherence"
                style="display:flex;align-items:center;gap:3px;cursor:pointer;"
              >
                <input
                  type="checkbox"
                  .checked=${props.coherenceAlpha}
                  @change=${(e: Event) =>
                    props.onToggleCoherenceAlpha(
                      (e.target as HTMLInputElement).checked
                    )}
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
                    <span class="label-muted"
                      >λ ${ro.wavelengthMeters!.toFixed(2)} m
                      (${ro.wavelengthFeet!.toFixed(1)} ft)</span
                    >
                  `
                : html`<span><strong>${ro.xValue.toFixed(2)} ms</strong></span>`}
              ${ro.sourceValues.map(
                (sv) => html`
                  <span class="cursor-source-badge" style="color:${sv.color}">
                    <span class="swatch" style="background:${sv.color}"></span>
                    ${sv.formattedValue}
                    ${sv.coherencePct !== undefined && props.plotType !== 'coherence'
                      ? html`<span class="label-muted">(γ² ${sv.coherencePct}%)</span>`
                      : nothing}
                  </span>
                `
              )}
            </div>
          `
        : html`<span class="label-muted"
            >Hover chart for acoustic cursor (${meta.xUnit} / ${meta.yUnit})</span
          >`}

      <div class="header-right">
        <button title="Zoom In Y Axis" @click=${() => props.onZoomY(0.75)}>Y+</button>
        <button title="Zoom Out Y Axis" @click=${() => props.onZoomY(1.333)}>
          Y−
        </button>
        <button title="Reset Axis Range" @click=${props.onResetZoom}>Reset</button>
      </div>
    </div>
  `;
}

