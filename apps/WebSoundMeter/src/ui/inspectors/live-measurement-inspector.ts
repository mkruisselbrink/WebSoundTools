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

import {
  OctaveSmoothingType,
  WINDOW_FUNCTION_LABELS,
  WindowFunctionType,
} from '@foh/dsp';
import { html, nothing, TemplateResult } from 'lit';
import {
  InputPreFilterType,
  MeasurementPipelineConfig,
  REFERENCE_CHANNEL_GLOBAL,
} from '../../dsp/analyzer-pipeline.js';
import { DelayEstimate } from '../../dsp/deconvolution.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
} from '../../dsp/dsp.worker.js';
import { FeedbackSensitivityMode } from '../../dsp/feedback-detector.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
} from '../../dsp/synthetic-rig.js';
import { AveragingType, TransferEstimatorType } from '../../dsp/transfer-function.js';
import { StoredCalibrationFile } from '../../sources/session-storage.js';

export interface LiveMeasurementInspectorHandlers {
  readonly slot?: LiveMeasurementSlotConfig;
  readonly delayEstimate?: DelayEstimate;
  readonly audioInputMode?: InputSourceMode;
  readonly availableChannels?: number;
  readonly globalReferenceChannel?: number;
  readonly showAdvanced?: boolean;
  readonly onToggleAdvanced?: () => void;
  readonly canDeleteSlot?: boolean;
  readonly onUpdateSlotMeta?: (
    partial: Partial<
      Pick<
        LiveMeasurementSlotConfig,
        'name' | 'simulatorPreset' | 'measurementChannel' | 'referenceChannel'
      >
    >
  ) => void;
  readonly onDeleteSlot?: () => void;
  readonly onFindAndApplyDelay?: () => void;
  readonly onCaptureTrace?: () => void;
  readonly savedCalibrations?: readonly StoredCalibrationFile[];
  readonly activeCalibrationId?: string | null;
  readonly onSelectCalibration?: (calibrationId: string | null) => void;
  readonly onDeleteCalibration?: (calibrationId: string) => void;
  readonly onResetAveraging: () => void;
  readonly onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) => void;
  readonly onCalibrationUpload: (e: Event) => void;
}

export function renderLiveMeasurementInspector(
  cfg: MeasurementPipelineConfig,
  handlers: LiveMeasurementInspectorHandlers
): TemplateResult {
  const savedCals = handlers.savedCalibrations ?? [];
  const activeCalId = handlers.activeCalibrationId ?? '';
  const slot = handlers.slot;
  const delayEst = handlers.delayEstimate;
  const inputMode = handlers.audioInputMode ?? 'simulator';
  const availCh = Math.max(2, handlers.availableChannels ?? 2);
  const channelOptions = Array.from({ length: availCh }, (_, i) => i);
  const globalRefCh = handlers.globalReferenceChannel ?? 1;
  const globalRefLabel =
    globalRefCh < 0 ? 'Internal Gen' : `In Ch ${globalRefCh + 1}`;
  const showAdvanced = handlers.showAdvanced ?? false;

  return html`
    <div class="section-card" data-testid="inspector-live-measurement">
      <div class="section-header">
        <span>${slot ? `${slot.name} Settings` : 'Live Measurement Settings'}</span>
        <div style="display:flex;gap:4px;">
          ${handlers.onCaptureTrace
            ? html`
                <button
                  data-testid="btn-capture-trace"
                  title="Capture current trace into Stored Sources (Shortcut: C)"
                  @click=${handlers.onCaptureTrace}
                >
                  Capture
                </button>
              `
            : nothing}
          <button @click=${handlers.onResetAveraging}>Reset Avg</button>
          ${handlers.canDeleteSlot
            ? html`
                <button
                  style="color:#f43f5e;"
                  data-testid="btn-delete-live-slot"
                  title="Remove this Live Measurement source"
                  @click=${handlers.onDeleteSlot}
                >
                  Delete
                </button>
              `
            : nothing}
        </div>
      </div>

      <div class="prop-grid">
        ${slot
          ? html`
              <div class="prop-field full-width">
                <label>Measurement Name</label>
                <input
                  type="text"
                  aria-label="Live Measurement Name"
                  data-testid="input-live-slot-name"
                  .value=${slot.name}
                  @input=${(e: Event) =>
                    handlers.onUpdateSlotMeta?.({
                      name: (e.target as HTMLInputElement).value,
                    })}
                />
              </div>

              ${inputMode === 'simulator'
                ? html`
                    <div class="prop-field full-width">
                      <label>Simulator Rig Preset</label>
                      <select
                        aria-label="Slot Simulator Preset"
                        data-testid="select-live-slot-preset"
                        .value=${slot.simulatorPreset}
                        @change=${(e: Event) =>
                          handlers.onUpdateSlotMeta?.({
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
                    <div class="prop-field full-width">
                      <label>Meas Channel (M)</label>
                      <select
                        aria-label="Slot Measurement Channel"
                        data-testid="select-live-slot-meas-channel"
                        .value=${String(slot.measurementChannel)}
                        @change=${(e: Event) =>
                          handlers.onUpdateSlotMeta?.({
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
                              Ch ${ch + 1}
                            </option>`
                        )}
                      </select>
                    </div>
                  `}
            `
          : nothing}

        <div class="prop-field">
          <label>Ref Delay (ms)</label>
          <input
            type="number"
            step="0.1"
            aria-label="Reference Delay (ms)"
            data-testid="input-ref-delay-ms"
            .value=${String(cfg.delayMs)}
            @change=${(e: Event) =>
              handlers.onUpdateConfig({
                delayMs: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>

        <div class="prop-field">
          <label
            data-testid="delay-estimate-readout"
            style="font-variant-numeric:tabular-nums;white-space:nowrap;"
          >
            Est Delay:
            <strong style="color:#e2e8f0;" data-testid="estimated-delay-ms"
              >${delayEst ? `${delayEst.delayMs.toFixed(2)} ms` : '—'}</strong
            >
            ${delayEst && delayEst.polarity < 0
              ? html`<span style="color:#f43f5e;font-weight:700;">(−POL)</span>`
              : nothing}
          </label>
          <button
            class="btn-primary"
            data-testid="btn-apply-delay"
            title="Find propagation delay via cross-correlation and apply to Reference channel (Shortcut: D)"
            @click=${handlers.onFindAndApplyDelay}
          >
            Find & Apply Delay
          </button>
        </div>

        <div class="prop-field">
          <label>Input Gain (dB)</label>
          <input
            type="number"
            step="0.5"
            aria-label="Input Gain (dB)"
            .value=${String(cfg.gainDb)}
            @change=${(e: Event) =>
              handlers.onUpdateConfig({
                gainDb: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>

        <div class="prop-field">
          <label>Polarity</label>
          <button
            class=${cfg.invertPolarity ? 'btn-active' : ''}
            @click=${() => handlers.onUpdateConfig({ invertPolarity: !cfg.invertPolarity })}
          >
            ${cfg.invertPolarity ? 'Inverted (−180°)' : 'Normal (+)'}
          </button>
        </div>

        <div class="prop-field full-width">
          <label>Feedback Watch Mode</label>
          <select
            aria-label="Feedback Watch Mode"
            data-testid="select-feedback-mode"
            .value=${cfg.feedbackMode ?? 'foh-normal'}
            @change=${(e: Event) =>
              handlers.onUpdateConfig({
                feedbackMode: (e.target as HTMLSelectElement)
                  .value as FeedbackSensitivityMode,
              })}
          >
            <option value="foh-normal">FOH Normal (Balanced)</option>
            <option value="monitor-sensitive">Monitor Sensitive (Fast)</option>
            <option value="custom">Custom Thresholds</option>
            <option value="off">Off</option>
          </select>
        </div>

        <div class="prop-field full-width">
          <label>Mic Calibration Curve</label>
          <div style="display:flex;gap:4px;align-items:center;">
            <select
              style="flex:1;"
              aria-label="Saved Mic Calibration Curve"
              data-testid="select-calibration-curve"
              .value=${activeCalId}
              @change=${(e: Event) => {
                const val = (e.target as HTMLSelectElement).value || null;
                handlers.onSelectCalibration?.(val);
              }}
            >
              <option value="">None (Flat / Uncalibrated)</option>
              ${savedCals.map(
                (cal) =>
                  html`<option value=${cal.id} ?selected=${cal.id === activeCalId}>
                    ${cal.name} (${cal.pointCount} pts)
                  </option>`
              )}
            </select>
            ${activeCalId
              ? html`
                  <button
                    style="color:#f43f5e;"
                    title="Delete selected calibration curve"
                    @click=${() => handlers.onDeleteCalibration?.(activeCalId)}
                  >
                    Remove
                  </button>
                `
              : nothing}
          </div>
        </div>

        <div class="prop-field full-width" style="margin-top:4px;">
          <button
            data-testid="btn-toggle-advanced-meas"
            aria-expanded=${String(showAdvanced)}
            style="width:100%;display:flex;align-items:center;justify-content:space-between;"
            @click=${handlers.onToggleAdvanced}
          >
            <span>Advanced Settings</span>
            <span>${showAdvanced ? '▴' : '▾'}</span>
          </button>
        </div>

        ${showAdvanced
          ? renderAdvancedMeasurementSettings(
              cfg,
              handlers,
              slot,
              inputMode,
              channelOptions,
              globalRefLabel
            )
          : nothing}
      </div>
    </div>
  `;
}

function renderAdvancedMeasurementSettings(
  cfg: MeasurementPipelineConfig,
  handlers: LiveMeasurementInspectorHandlers,
  slot: LiveMeasurementSlotConfig | undefined,
  inputMode: InputSourceMode,
  channelOptions: number[],
  globalRefLabel: string
): TemplateResult {
  return html`
    ${slot && inputMode === 'hardware'
      ? html`
          <div class="prop-field full-width">
            <label>Ref Channel (R) Override</label>
            <select
              aria-label="Slot Reference Channel"
              data-testid="select-live-slot-ref-channel"
              .value=${String(slot.referenceChannel)}
              @change=${(e: Event) =>
                handlers.onUpdateSlotMeta?.({
                  referenceChannel: Number((e.target as HTMLSelectElement).value),
                })}
            >
              <option
                value=${String(REFERENCE_CHANNEL_GLOBAL)}
                ?selected=${slot.referenceChannel === REFERENCE_CHANNEL_GLOBAL}
              >
                Follow Global Ref (${globalRefLabel})
              </option>
              <option value="-1" ?selected=${slot.referenceChannel === -1}>
                Internal Gen Loopback
              </option>
              ${channelOptions.map(
                (ch) =>
                  html`<option
                    value=${String(ch)}
                    ?selected=${ch === slot.referenceChannel}
                  >
                    Ch ${ch + 1}
                  </option>`
              )}
            </select>
          </div>
        `
      : nothing}

    <div
      class="prop-field full-width"
      style="margin-top:4px;padding-top:6px;border-top:1px solid #263554;"
    >
      <label style="color:#38bdf8;font-weight:600;text-transform:uppercase;">
        Shared Transform & Averaging (All Live Measurements)
      </label>
    </div>

    <div class="prop-field">
      <label>FFT Size</label>
      <select
        aria-label="FFT Size"
        data-testid="select-fft-size"
        .value=${String(cfg.fftSize)}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            fftSize: Number((e.target as HTMLSelectElement).value),
          })}
      >
        <option value="1024">1024 (21 ms)</option>
        <option value="2048">2048 (43 ms)</option>
        <option value="4096">4096 (85 ms)</option>
        <option value="8192">8192 (171 ms)</option>
        <option value="16384">16384 (341 ms)</option>
        <option value="32768">32768 (683 ms)</option>
      </select>
    </div>

    <div class="prop-field">
      <label>Window Function</label>
      <select
        aria-label="Window Function"
        .value=${cfg.windowType}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            windowType: (e.target as HTMLSelectElement).value as WindowFunctionType,
          })}
      >
        ${Object.entries(WINDOW_FUNCTION_LABELS).map(
          ([k, label]) => html`<option value=${k}>${label}</option>`
        )}
      </select>
    </div>

    <div class="prop-field">
      <label>Averaging Mode</label>
      <select
        aria-label="Averaging Mode"
        .value=${cfg.averagingType}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            averagingType: (e.target as HTMLSelectElement).value as AveragingType,
          })}
      >
        <option value="fifo">FIFO Window</option>
        <option value="lpf">LPF / Exponential</option>
        <option value="off">Off (Instant)</option>
      </select>
    </div>

    <div class="prop-field">
      <label>FIFO Averages</label>
      <select
        aria-label="FIFO Averages"
        .value=${String(cfg.fifoDepth)}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            fifoDepth: Number((e.target as HTMLSelectElement).value),
          })}
      >
        <option value="4">4 Frames</option>
        <option value="8">8 Frames</option>
        <option value="16">16 Frames</option>
        <option value="32">32 Frames</option>
        <option value="64">64 Frames</option>
      </select>
    </div>

    <div class="prop-field">
      <label>Octave Smoothing</label>
      <select
        aria-label="Octave Smoothing"
        data-testid="select-smoothing"
        .value=${cfg.octaveSmoothing}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            octaveSmoothing: (e.target as HTMLSelectElement).value as OctaveSmoothingType,
          })}
      >
        <option value="off">None (Narrowband)</option>
        <option value="1/48">1/48 Octave</option>
        <option value="1/24">1/24 Octave</option>
        <option value="1/12">1/12 Octave</option>
        <option value="1/6">1/6 Octave</option>
        <option value="1/3">1/3 Octave</option>
        <option value="1/1">1 Octave</option>
      </select>
    </div>

    <div class="prop-field">
      <label>TF Estimator</label>
      <select
        aria-label="TF Estimator"
        .value=${cfg.estimator}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            estimator: (e.target as HTMLSelectElement).value as TransferEstimatorType,
          })}
      >
        <option value="h1">H1 Cross-Spectrum</option>
        <option value="ratio">|M| / |R| Ratio</option>
      </select>
    </div>

    <div
      class="prop-field full-width"
      style="margin-top:4px;padding-top:6px;border-top:1px solid #263554;"
    >
      <label style="color:#94a3b8;font-weight:600;text-transform:uppercase;">
        Channel Pre-Filter & Calibration Upload
      </label>
    </div>

    <div class="prop-field full-width">
      <label>Input Filter</label>
      <select
        aria-label="Input Filter"
        .value=${cfg.inputFilter}
        @change=${(e: Event) =>
          handlers.onUpdateConfig({
            inputFilter: (e.target as HTMLSelectElement).value as InputPreFilterType,
          })}
      >
        <option value="Z">Z (Flat / None)</option>
        <option value="A">A-Weighting</option>
        <option value="C">C-Weighting</option>
        <option value="notch-1k">1 kHz Notch</option>
      </select>
    </div>

    <div class="prop-field full-width">
      <label>Upload New Calibration (.cal / .txt / .frd)</label>
      <input
        type="file"
        aria-label="Mic Calibration File"
        accept=".cal,.txt,.frd"
        @change=${handlers.onCalibrationUpload}
      />
    </div>
  `;
}
