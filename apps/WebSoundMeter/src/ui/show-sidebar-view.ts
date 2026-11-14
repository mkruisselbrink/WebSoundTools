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
import { REFERENCE_CHANNEL_GLOBAL } from '../dsp/analyzer-pipeline.js';
import {
  InputSourceMode,
  LiveMeasurementSlotConfig,
} from '../dsp/dsp.worker.js';
import {
  DetectedFeedbackTrack,
  FeedbackSensitivityMode,
} from '../dsp/feedback-detector.js';
import {
  SplAlertMetric,
  SplAlertThresholds,
} from '../dsp/spl-history.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
} from '../dsp/synthetic-rig.js';
import { SourceData } from '../sources/source-data.js';

export interface ShowSidebarViewProps {
  readonly audioInputMode?: InputSourceMode;
  readonly availableChannels?: number;
  readonly globalReferenceChannel?: number;
  readonly selectedSourceId?: string;
  readonly liveSlots: readonly LiveMeasurementSlotConfig[];
  readonly liveSources: readonly SourceData[];
  readonly feedbackRingLog: readonly DetectedFeedbackTrack[];
  readonly splAlertThresholds: SplAlertThresholds;
  readonly onAddLiveSource?: () => void;
  readonly onSelectSlot?: (slotId: string) => void;
  readonly onDeleteSlot?: (slotId: string) => void;
  readonly onToggleSlotVisibility: (slotId: string, visible: boolean) => void;
  readonly onUpdateSlotMeta?: (
    slotId: string,
    partial: Partial<
      Pick<
        LiveMeasurementSlotConfig,
        'name' | 'simulatorPreset' | 'measurementChannel' | 'referenceChannel'
      >
    >
  ) => void;
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
  const inputMode = props.audioInputMode ?? 'simulator';
  const availCh = Math.max(2, props.availableChannels ?? 2);
  const channelOptions = Array.from({ length: availCh }, (_, i) => i);
  const globalRefCh = props.globalReferenceChannel ?? 1;
  const globalRefLabel =
    globalRefCh < 0 ? 'Internal Gen' : `In Ch ${globalRefCh + 1}`;
  const canDeleteSlot = props.liveSlots.length > 1;

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
            const isSelected = props.selectedSourceId === slot.id;

            return html`
              <div
                class="show-mic-row ${isSelected ? 'selected' : ''}"
                data-testid="show-mic-${slot.id}"
                @click=${() => props.onSelectSlot?.(slot.id)}
              >
                <div class="show-mic-top">
                  <div class="source-row-left">
                    <input
                      type="checkbox"
                      aria-label="Toggle visibility for ${slot.name}"
                      .checked=${src?.visible ?? slot.visible}
                      @click=${(e: Event) => e.stopPropagation()}
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
                  <div style="display:flex;align-items:center;gap:4px;">
                    <span class="show-mic-spl-badge">
                      ${laeq15.toFixed(1)} Aeq15
                      <small style="color:#94a3b8;">(${laf.toFixed(0)}F)</small>
                    </span>
                    ${canDeleteSlot && props.onDeleteSlot
                      ? html`
                          <button
                            style="padding:1px 5px;color:#f43f5e;font-size:10px;"
                            title="Remove ${slot.name}"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              props.onDeleteSlot?.(slot.id);
                            }}
                          >
                            ×
                          </button>
                        `
                      : nothing}
                  </div>
                </div>

                ${inputMode === 'simulator'
                  ? html`
                      <div class="show-mic-bottom" @click=${(e: Event) => e.stopPropagation()}>
                        <span class="label-muted">Sim Rig:</span>
                        <select
                          aria-label="Simulator Rig Preset for ${slot.name}"
                          data-testid="select-show-sim-preset-${slot.id}"
                          style="flex:1;min-width:0;"
                          .value=${slot.simulatorPreset}
                          @change=${(e: Event) =>
                            props.onUpdateSlotMeta?.(slot.id, {
                              simulatorPreset: (e.target as HTMLSelectElement)
                                .value as SimulatorPresetId,
                            })}
                        >
                          ${Object.values(SIMULATOR_PRESETS).map(
                            (preset) =>
                              html`<option
                                value=${preset.id}
                                ?selected=${preset.id === slot.simulatorPreset}
                              >
                                ${preset.name}
                              </option>`
                          )}
                        </select>
                      </div>
                    `
                  : html`
                      <div class="show-mic-bottom" @click=${(e: Event) => e.stopPropagation()}>
                        <span class="label-muted">In M / R:</span>
                        <div style="display:flex;gap:4px;flex:1;justify-content:flex-end;">
                          <select
                            aria-label="Measurement Channel for ${slot.name}"
                            data-testid="select-show-meas-ch-${slot.id}"
                            title="Measurement Input Channel (M)"
                            .value=${String(slot.measurementChannel)}
                            @change=${(e: Event) =>
                              props.onUpdateSlotMeta?.(slot.id, {
                                measurementChannel: Number(
                                  (e.target as HTMLSelectElement).value
                                ),
                              })}
                          >
                            ${channelOptions.map(
                              (ch) =>
                                html`<option
                                  value=${String(ch)}
                                  ?selected=${ch === slot.measurementChannel}
                                >
                                  M: Ch ${ch + 1}
                                </option>`
                            )}
                          </select>
                          <select
                            aria-label="Reference Channel for ${slot.name}"
                            data-testid="select-show-ref-ch-${slot.id}"
                            title="Reference Input Channel (R)"
                            .value=${String(slot.referenceChannel)}
                            @change=${(e: Event) =>
                              props.onUpdateSlotMeta?.(slot.id, {
                                referenceChannel: Number(
                                  (e.target as HTMLSelectElement).value
                                ),
                              })}
                          >
                            <option
                              value=${String(REFERENCE_CHANNEL_GLOBAL)}
                              ?selected=${slot.referenceChannel === REFERENCE_CHANNEL_GLOBAL}
                            >
                              R: Global (${globalRefLabel})
                            </option>
                            <option value="-1" ?selected=${slot.referenceChannel === -1}>
                              R: Loopback
                            </option>
                            ${channelOptions.map(
                              (ch) =>
                                html`<option
                                  value=${String(ch)}
                                  ?selected=${ch === slot.referenceChannel}
                                >
                                  R: Ch ${ch + 1}
                                </option>`
                            )}
                          </select>
                        </div>
                      </div>
                    `}

                <div class="show-mic-bottom" @click=${(e: Event) => e.stopPropagation()}>
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

