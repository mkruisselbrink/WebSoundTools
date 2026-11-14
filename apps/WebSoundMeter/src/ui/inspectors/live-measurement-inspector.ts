// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for Live Measurement slots (routing, delay finder, gain/polarity,
 * feedback watch mode, mic calibration, and collapsible FFT/averaging settings).
 */

import { html, nothing, TemplateResult } from 'lit';
import { MeasurementPipelineConfig } from '../../dsp/analyzer-pipeline.js';
import { DelayEstimate } from '../../dsp/deconvolution.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
} from '../../dsp/dsp-worker-protocol.js';
import { FeedbackSensitivityMode } from '../../dsp/feedback-detector.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
} from '../../dsp/synthetic-rig.js';
import { StoredCalibrationFile } from '../../sources/session-storage.js';
import {
  renderAdvancedMeasurementSettings,
  renderCalibrationSelectorSection,
} from './calibration-inspector-section.js';

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

        ${renderCalibrationSelectorSection({
          savedCalibrations: savedCals,
          activeCalibrationId: activeCalId,
          onSelectCalibration: handlers.onSelectCalibration,
          onDeleteCalibration: handlers.onDeleteCalibration,
        })}

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
          ? renderAdvancedMeasurementSettings({
              cfg,
              slot,
              inputMode,
              channelOptions,
              globalRefLabel,
              onUpdateSlotMeta: handlers.onUpdateSlotMeta,
              onUpdateConfig: handlers.onUpdateConfig,
              onCalibrationUpload: handlers.onCalibrationUpload,
            })
          : nothing}
      </div>
    </div>
  `;
}
