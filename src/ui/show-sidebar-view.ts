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
import { LiveMeasurementSlotConfig } from '../dsp/dsp.worker.js';
import {
  DetectedFeedbackTrack,
  FeedbackSensitivityMode,
} from '../dsp/feedback-detector.js';
import {
  SplAlertMetric,
  SplAlertThresholds,
} from '../dsp/spl-history.js';
import { SourceData } from '../sources/source-data.js';

export interface ShowSidebarViewProps {
  readonly liveSlots: readonly LiveMeasurementSlotConfig[];
  readonly liveSources: readonly SourceData[];
  readonly feedbackRingLog: readonly DetectedFeedbackTrack[];
  readonly splAlertThresholds: SplAlertThresholds;
  readonly onAddLiveSource?: () => void;
  readonly onToggleSlotVisibility: (slotId: string, visible: boolean) => void;
  readonly onSlotFeedbackModeChange: (
    slotId: string,
    mode: FeedbackSensitivityMode
  ) => void;
  readonly onApplyFeedbackNotch: (track: DetectedFeedbackTrack) => void;
  readonly onClearFeedbackRingLog: () => void;
  readonly onUpdateSplThresholds: (partial: Partial<SplAlertThresholds>) => void;
  readonly onResetShowLog: () => void;
  readonly onExportSplCsv: () => void;
}

export function renderShowSidebar(props: ShowSidebarViewProps): TemplateResult {
  const sourceById = new Map<string, SourceData>();
  for (const src of props.liveSources) {
    sourceById.set(src.id, src);
  }

  return html`
    <aside class="sidebar show-sidebar" data-testid="show-sidebar">
      <!-- 1. Live Mics & SPL Watch Card -->
      <div class="section-card" data-testid="card-live-mics-watch">
        <div class="section-header">
          <span>Live Mics & SPL Watch (${props.liveSlots.length})</span>
          ${props.onAddLiveSource
            ? html`
                <button
                  data-testid="btn-show-add-meas"
                  title="Add Live Measurement Microphone"
                  @click=${props.onAddLiveSource}
                >
                  + Mic
                </button>
              `
            : nothing}
        </div>

        <div class="show-mic-list">
          ${props.liveSlots.map((slot) => {
            const src = sourceById.get(slot.id);
            const levels = src?.levels;
            const laeq15 =
              levels?.rollingLeq?.leq15m.A ?? levels?.levelsDb.A.Leq ?? -40.0;
            const laf = levels?.levelsDb.A.Fast ?? -40.0;
            const fbMode = slot.config.feedbackMode ?? 'foh-normal';

            return html`
              <div class="show-mic-row" data-testid="show-mic-${slot.id}">
                <div class="show-mic-top">
                  <div class="source-row-left">
                    <input
                      type="checkbox"
                      aria-label="Toggle visibility for ${slot.name}"
                      .checked=${src?.visible ?? slot.visible}
                      @change=${(e: Event) =>
                        props.onToggleSlotVisibility(
                          slot.id,
                          (e.target as HTMLInputElement).checked
                        )}
                    />
                    <span
                      class="source-color-dot"
                      style="background:${slot.color}"
                    ></span>
                    <strong class="source-name">${slot.name}</strong>
                  </div>
                  <span class="show-mic-spl-badge">
                    ${laeq15.toFixed(1)} Aeq15
                    <small style="color:#94a3b8;">(${laf.toFixed(0)}F)</small>
                  </span>
                </div>

                <div class="show-mic-bottom">
                  <span class="label-muted">FB Watch:</span>
                  <select
                    aria-label="Feedback Watch Sensitivity for ${slot.name}"
                    data-testid="select-fb-mode-${slot.id}"
                    .value=${fbMode}
                    @change=${(e: Event) =>
                      props.onSlotFeedbackModeChange(
                        slot.id,
                        (e.target as HTMLSelectElement).value as FeedbackSensitivityMode
                      )}
                  >
                    <option value="foh-normal">FOH Normal</option>
                    <option value="monitor-sensitive">Monitor / Wedge Sensitive</option>
                    <option value="custom">Custom</option>
                    <option value="off">Off</option>
                  </select>
                </div>
              </div>
            `;
          })}
        </div>
      </div>

      <!-- 2. Feedback Ring Log Card -->
      <div class="section-card" data-testid="card-feedback-ring-log">
        <div class="section-header">
          <span>Feedback Ring Log (${props.feedbackRingLog.length})</span>
          <button
            data-testid="btn-clear-ring-log"
            ?disabled=${props.feedbackRingLog.length === 0}
            @click=${props.onClearFeedbackRingLog}
          >
            Clear
          </button>
        </div>

        ${props.feedbackRingLog.length === 0
          ? html`
              <div class="empty-ring-log" data-testid="empty-ring-log">
                No acoustic feedback or narrowband ringing detected.
              </div>
            `
          : html`
              <div class="ring-log-list" data-testid="ring-log-list">
                ${props.feedbackRingLog.map((track) => {
                  const icon =
                    track.state === 'feedback'
                      ? '◆'
                      : track.state === 'ringing'
                        ? '▲'
                        : '●';
                  const badgeClass =
                    track.state === 'feedback'
                      ? 'crit'
                      : track.state === 'ringing'
                        ? 'warn'
                        : 'hold';
                  const freqLabel =
                    track.frequencyHz >= 1000
                      ? `${(track.frequencyHz / 1000).toFixed(2)} kHz`
                      : `${Math.round(track.frequencyHz)} Hz`;

                  return html`
                    <div class="ring-log-row" data-testid="ring-log-item-${track.id}">
                      <div class="ring-log-main">
                        <span class="ring-severity-badge ${badgeClass}">${icon}</span>
                        <div>
                          <div class="ring-freq-title">
                            <strong>${freqLabel}</strong>
                            <span class="ring-iso-tag">ISO ${track.isoBandLabel}</span>
                          </div>
                          <div class="ring-meta-line">
                            <span>${track.musicalNote}</span>
                            <span>• +${track.prominenceDb.toFixed(1)} dB</span>
                            <span>• Q≈${Math.round(track.estimatedQ)}</span>
                            <span style="color:${track.slotColor}">• ${track.slotName}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        class="btn-notch-eq"
                        data-testid="btn-notch-eq-${track.id}"
                        title="Insert or deepen surgical peaking notch in Virtual EQ for ${track.slotName}"
                        @click=${() => props.onApplyFeedbackNotch(track)}
                      >
                        Notch EQ
                      </button>
                    </div>
                  `;
                })}
              </div>
            `}
      </div>

      <!-- 3. Show Limits & Log Export Card -->
      <div class="section-card" data-testid="card-show-limits-export">
        <div class="section-header">
          <span>Show Limits & Log</span>
          <div style="display:flex;gap:4px;">
            <button
              data-testid="btn-reset-show-log"
              title="Clear 4-hour SPL history and IndexedDB show checkpoint"
              @click=${props.onResetShowLog}
            >
              Reset Log
            </button>
            <button
              class="btn-primary-action"
              data-testid="btn-export-spl-csv"
              title="Download 1-second SPL & Rolling Leq CSV log"
              @click=${props.onExportSplCsv}
            >
              CSV ⬇
            </button>
          </div>
        </div>

        <div class="prop-grid">
          <div class="prop-field full-width">
            <label>Compliance Alert Metric</label>
            <select
              aria-label="Compliance Alert Metric"
              data-testid="select-spl-alert-metric"
              .value=${props.splAlertThresholds.metric}
              @change=${(e: Event) =>
                props.onUpdateSplThresholds({
                  metric: (e.target as HTMLSelectElement).value as SplAlertMetric,
                })}
            >
              <option value="LAeq15m">LAeq,15m (15-Minute Equivalent)</option>
              <option value="LAeq60m">LAeq,60m (1-Hour Statutory)</option>
              <option value="LAeq5m">LAeq,5m (5-Minute Equivalent)</option>
              <option value="LAeq1m">LAeq,1m (1-Minute Short-Term)</option>
              <option value="LAF">LAF (Fast A-Weighted)</option>
              <option value="LCeq1m">LCeq,1m (Low-End C-Weighted)</option>
              <option value="LZpeak">LZpeak (Unweighted Peak)</option>
            </select>
          </div>

          <div class="prop-field">
            <label>▲ Warn Threshold (dB)</label>
            <input
              type="number"
              step="0.5"
              aria-label="SPL Warning Threshold dB"
              data-testid="input-spl-warn-db"
              .value=${String(props.splAlertThresholds.warningDb)}
              @change=${(e: Event) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                if (!Number.isNaN(val)) {
                  props.onUpdateSplThresholds({ warningDb: val });
                }
              }}
            />
          </div>

          <div class="prop-field">
            <label>◆ Limit Threshold (dB)</label>
            <input
              type="number"
              step="0.5"
              aria-label="SPL Limit Threshold dB"
              data-testid="input-spl-limit-db"
              .value=${String(props.splAlertThresholds.limitDb)}
              @change=${(e: Event) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                if (!Number.isNaN(val)) {
                  props.onUpdateSplThresholds({ limitDb: val });
                }
              }}
            />
          </div>
        </div>
      </div>
    </aside>
  `;
}
