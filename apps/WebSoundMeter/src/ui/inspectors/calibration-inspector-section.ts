// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Microphone calibration selector and collapsible advanced transform/averaging/calibration-upload
 * inspector sections for Live Measurement slots.
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
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
} from '../../dsp/dsp-worker-protocol.js';
import { AveragingType, TransferEstimatorType } from '../../dsp/transfer-function.js';
import { StoredCalibrationFile } from '../../sources/session-storage.js';

export function renderCalibrationSelectorSection(params: {
  readonly savedCalibrations: readonly StoredCalibrationFile[];
  readonly activeCalibrationId: string;
  readonly onSelectCalibration?: (calibrationId: string | null) => void;
  readonly onDeleteCalibration?: (calibrationId: string) => void;
}): TemplateResult {
  const {
    savedCalibrations,
    activeCalibrationId,
    onSelectCalibration,
    onDeleteCalibration,
  } = params;

  return html`
    <div class="prop-field full-width">
      <label>Mic Calibration Curve</label>
      <div style="display:flex;gap:4px;align-items:center;">
        <select
          style="flex:1;"
          aria-label="Saved Mic Calibration Curve"
          data-testid="select-calibration-curve"
          .value=${activeCalibrationId}
          @change=${(e: Event) => {
            const val = (e.target as HTMLSelectElement).value || null;
            onSelectCalibration?.(val);
          }}
        >
          <option value="">None (Flat / Uncalibrated)</option>
          ${savedCalibrations.map(
            (cal) =>
              html`<option value=${cal.id} ?selected=${cal.id === activeCalibrationId}>
                ${cal.name} (${cal.pointCount} pts)
              </option>`
          )}
        </select>
        ${activeCalibrationId
          ? html`
              <button
                style="color:#f43f5e;"
                title="Delete selected calibration curve"
                @click=${() => onDeleteCalibration?.(activeCalibrationId)}
              >
                Remove
              </button>
            `
          : nothing}
      </div>
    </div>
  `;
}

export function renderAdvancedMeasurementSettings(params: {
  readonly cfg: MeasurementPipelineConfig;
  readonly slot: LiveMeasurementSlotConfig | undefined;
  readonly inputMode: InputSourceMode;
  readonly channelOptions: readonly number[];
  readonly globalRefLabel: string;
  readonly onUpdateSlotMeta?: (
    partial: Partial<
      Pick<
        LiveMeasurementSlotConfig,
        'name' | 'simulatorPreset' | 'measurementChannel' | 'referenceChannel'
      >
    >
  ) => void;
  readonly onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) => void;
  readonly onCalibrationUpload: (e: Event) => void;
}): TemplateResult {
  const {
    cfg,
    slot,
    inputMode,
    channelOptions,
    globalRefLabel,
    onUpdateSlotMeta,
    onUpdateConfig,
    onCalibrationUpload,
  } = params;

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
                onUpdateSlotMeta?.({
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
          onUpdateConfig({
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
          onUpdateConfig({
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
          onUpdateConfig({
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
          onUpdateConfig({
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
          onUpdateConfig({
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
          onUpdateConfig({
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
          onUpdateConfig({
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
        @change=${onCalibrationUpload}
      />
    </div>
  `;
}
