// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { html, nothing, type TemplateResult } from 'lit';
import type { SplHistoryTraceMode, SplHistoryWindowSec } from '../dsp/spl-history.js';
import { PLOT_METADATA, type PlotType } from './plot-types.js';
import type { RtaDisplayMode } from './wsm-chart-adapter.js';

export interface WsmChartHeaderProps {
  readonly plotType: PlotType;
  readonly rtaMode: RtaDisplayMode;
  readonly showPeakHold: boolean;
  readonly coherenceAlpha: boolean;
  readonly showFeedbackWatch: boolean;
  readonly splWindowSec: SplHistoryWindowSec;
  readonly splTraceMode: SplHistoryTraceMode;
  readonly showSplThresholds: boolean;
  readonly onPlotTypeChange: (e: Event) => void;
  readonly onRtaModeChange: (mode: RtaDisplayMode) => void;
  readonly onTogglePeakHold: (enabled: boolean) => void;
  readonly onToggleCoherenceAlpha: (enabled: boolean) => void;
  readonly onToggleFeedbackWatch: (enabled: boolean) => void;
  readonly onSplWindowChange: (windowSec: SplHistoryWindowSec) => void;
  readonly onSplTraceModeChange: (mode: SplHistoryTraceMode) => void;
  readonly onToggleSplThresholds: (enabled: boolean) => void;
  readonly onZoomY: (factor: number) => void;
  readonly onResetZoom: () => void;
}

export function renderWsmChartHeader(props: WsmChartHeaderProps): TemplateResult {
  const meta = PLOT_METADATA[props.plotType];

  return html`
    <div class="chart-header">
      <div class="header-left">
        <select
          aria-label="Plot Type"
          .value=${props.plotType}
          @change=${props.onPlotTypeChange}
        >
          ${Object.values(PLOT_METADATA).map(
            (m) => html`<option value=${m.type}>${m.label}</option>`
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

        ${props.plotType === 'magnitude' ||
        props.plotType === 'phase' ||
        props.plotType === 'group-delay'
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

        ${props.plotType === 'rta' || props.plotType === 'magnitude'
          ? html`
              <label
                class="label-muted"
                title="Overlay detected acoustic feedback and ringing callout flags"
                style="display:flex;align-items:center;gap:3px;cursor:pointer;"
              >
                <input
                  type="checkbox"
                  data-testid="toggle-feedback-watch"
                  .checked=${props.showFeedbackWatch}
                  @change=${(e: Event) =>
                    props.onToggleFeedbackWatch(
                      (e.target as HTMLInputElement).checked
                    )}
                />
                FB Watch
              </label>
            `
          : nothing}

        ${props.plotType === 'spl-history'
          ? html`
              <select
                aria-label="SPL History Window"
                data-testid="select-spl-window"
                .value=${String(props.splWindowSec)}
                @change=${(e: Event) =>
                  props.onSplWindowChange(
                    Number((e.target as HTMLSelectElement).value) as SplHistoryWindowSec
                  )}
              >
                <option value="60">1 min (4 Hz)</option>
                <option value="300">5 min (4 Hz)</option>
                <option value="900">15 min</option>
                <option value="3600">60 min</option>
                <option value="14400">4 hours</option>
              </select>

              <select
                aria-label="SPL Trace Mode"
                data-testid="select-spl-trace-mode"
                .value=${props.splTraceMode}
                @change=${(e: Event) =>
                  props.onSplTraceModeChange(
                    (e.target as HTMLSelectElement).value as SplHistoryTraceMode
                  )}
              >
                <option value="compliance-15m">Compliance (LAeq15m + LAeq1m + Pk)</option>
                <option value="dba-fast-leq1m">dBA (Fast + LAeq1m)</option>
                <option value="dba-dbc-leq1m">dBA vs dBC (Leq1m)</option>
                <option value="multi-slot">Multi-Mic Comparison (LAeq15m)</option>
              </select>

              <label
                class="label-muted"
                style="display:flex;align-items:center;gap:3px;cursor:pointer;"
              >
                <input
                  type="checkbox"
                  data-testid="toggle-spl-thresholds"
                  .checked=${props.showSplThresholds}
                  @change=${(e: Event) =>
                    props.onToggleSplThresholds(
                      (e.target as HTMLInputElement).checked
                    )}
                />
                Limits
              </label>
            `
          : nothing}
      </div>

      <div class="header-center">
        <span class="label-muted">Hover chart for cursor (${meta.xUnit} / ${meta.yUnit})</span>
      </div>

      <div class="header-right">
        <button title="Zoom In Y Axis" @click=${() => props.onZoomY(0.75)}>Y+</button>
        <button title="Zoom Out Y Axis" @click=${() => props.onZoomY(1.333)}>Y−</button>
        <button title="Reset Axis Range" @click=${props.onResetZoom}>Reset</button>
      </div>
    </div>
  `;
}
