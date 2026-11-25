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
import {
  type PopoverParentRootLike,
  closePopoverById,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
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
import {
  type BroadbandLevelsSnapshot,
  type WeightingCurve,
  computeCalibratedSplOffsetDb,
} from '../../dsp/weighting-meters.js';
import { StoredCalibrationFile } from '../../sources/session-storage.js';

export function renderSplCalibratorPopover(params: {
  readonly popoverId: string;
  readonly slotName: string;
  readonly cfg: MeasurementPipelineConfig;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly splWeighting?: WeightingCurve;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) => void;
}): TemplateResult {
  const { popoverId, slotName, cfg, levels, popoverRoot, onUpdateConfig } = params;
  const curve: WeightingCurve = params.splWeighting ?? 'A';
  const currentFastDb = levels ? levels.levelsDb[curve].Fast : -40.0;
  const uncalDb = levels ? currentFastDb - levels.splOffsetDb : -140.0;
  const hasSignal = Number.isFinite(uncalDb) && uncalDb >= -110;
  const refInputId = `${popoverId}-ref-spl`;

  const applyMatch = (refDb: number) => {
    const nextOffset = computeCalibratedSplOffsetDb(levels, refDb, curve);
    if (nextOffset !== null) {
      onUpdateConfig({ splOffsetDb: nextOffset });
      closePopoverById(popoverRoot, popoverId);
    }
  };

  return html`
    <div
      id=${popoverId}
      popover="auto"
      class="foh-popover"
      data-doc-region="cal-popover"
      @click=${(e: Event) => e.stopPropagation()}
      @toggle=${(ev: Event) => {
        if (popoverRoot) syncAnchoredPopoverToggle(ev, popoverRoot);
      }}
    >
      <div class="foh-popover-title">SPL Calibration · ${slotName}</div>
      <div class="foh-popover-grid">
        <div
          style="display:flex;justify-content:space-between;padding:4px 7px;background:#050811;border:1px solid #1e293b;border-radius:4px;font-family:var(--_foh-font-mono,monospace);font-size:10.5px;"
        >
          <span style="color:#94a3b8;">Live (${curve}·Fast)</span>
          <strong style="color:${hasSignal ? '#38bdf8' : '#64748b'};">
            ${hasSignal
              ? `${currentFastDb.toFixed(1)} dB${curve} (${uncalDb.toFixed(1)} dBFS)`
              : 'No live signal'}
          </strong>
        </div>

        <div class="foh-popover-row">
          <label for="${popoverId}-offset">
            0 dBFS Full-Scale SPL (dB) — shifts SPL &amp; Leq only
          </label>
          <input
            type="number"
            id="${popoverId}-offset"
            name="${popoverId}-offset"
            step="0.5"
            aria-label="0 dBFS SPL Offset for ${slotName}"
            .value=${String(cfg.splOffsetDb)}
            @change=${(e: Event) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              if (Number.isFinite(v)) onUpdateConfig({ splOffsetDb: v });
            }}
          />
        </div>

        <div class="foh-popover-row">
          <label for=${refInputId}>
            Match Calibrator / Reference Meter (dB${curve})
          </label>
          <div style="display:flex;gap:5px;">
            <input
              type="number"
              id=${refInputId}
              name=${refInputId}
              step="0.5"
              value="94"
              aria-label="Reference SPL Level dB"
              style="flex:1;min-width:0;"
            />
            <button
              type="button"
              class="foh-btn foh-btn-primary"
              ?disabled=${!hasSignal}
              title="Set SPL Offset so current live signal reads this exact dB SPL"
              @click=${(e: Event) => {
                const container = (e.currentTarget as HTMLElement).parentElement;
                const inp = container?.querySelector('input') as HTMLInputElement | null;
                const refVal = parseFloat(inp?.value ?? '94');
                if (Number.isFinite(refVal)) applyMatch(refVal);
              }}
            >
              Match Live
            </button>
          </div>
        </div>

        <div class="foh-popover-actions" style="grid-template-columns:1fr 1fr 1fr;">
          <button
            type="button"
            class="foh-btn"
            ?disabled=${!hasSignal}
            title="Calibrate to 94.0 dB SPL pistonphone"
            @click=${() => applyMatch(94.0)}
          >
            94 dB Cal
          </button>
          <button
            type="button"
            class="foh-btn"
            ?disabled=${!hasSignal}
            title="Calibrate to 114.0 dB SPL high-level pistonphone"
            @click=${() => applyMatch(114.0)}
          >
            114 dB Cal
          </button>
          <button
            type="button"
            class="foh-btn"
            title="Reset SPL Offset to default (0 dBFS = 100 dB SPL)"
            @click=${() => {
              onUpdateConfig({ splOffsetDb: 100.0 });
              closePopoverById(popoverRoot, popoverId);
            }}
          >
            Reset 100
          </button>
        </div>
      </div>
    </div>
  `;
}

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
    <div class="foh-mini-field full-width">
      <label for="wsm-calibration-curve">Mic Calibration Curve</label>
      <div style="display:flex;gap:4px;align-items:center;">
        <select
          id="wsm-calibration-curve"
          name="mic-calibration-curve"
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
                type="button"
                class="foh-btn foh-btn-xs foh-btn-danger"
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
          <div class="foh-mini-field full-width">
            <label for="wsm-live-slot-ref-ch">Ref Channel (R) Override</label>
            <select
              id="wsm-live-slot-ref-ch"
              name="slot-reference-channel"
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
      class="foh-mini-field full-width"
      style="margin-top:4px;padding-top:6px;border-top:1px solid #1e293b;"
    >
      <span style="color:#38bdf8;font-weight:600;text-transform:uppercase;">
        Shared Transform & Averaging (All Live Measurements)
      </span>
    </div>

    <div class="foh-mini-field">
      <label for="wsm-fft-size">FFT Size</label>
      <select
        id="wsm-fft-size"
        name="fft-size"
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

    <div class="foh-mini-field">
      <label for="wsm-window-type">Window Function</label>
      <select
        id="wsm-window-type"
        name="window-function"
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

    <div class="foh-mini-field">
      <label for="wsm-averaging-mode">Averaging Mode</label>
      <select
        id="wsm-averaging-mode"
        name="averaging-mode"
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

    <div class="foh-mini-field">
      <label for="wsm-fifo-depth">FIFO Averages</label>
      <select
        id="wsm-fifo-depth"
        name="fifo-averages"
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

    <div class="foh-mini-field">
      <label for="wsm-octave-smoothing">Octave Smoothing</label>
      <select
        id="wsm-octave-smoothing"
        name="octave-smoothing"
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

    <div class="foh-mini-field">
      <label for="wsm-tf-estimator">TF Estimator</label>
      <select
        id="wsm-tf-estimator"
        name="tf-estimator"
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
      class="foh-mini-field full-width"
      style="margin-top:4px;padding-top:6px;border-top:1px solid #1e293b;"
    >
      <span style="color:#94a3b8;font-weight:600;text-transform:uppercase;">
        Channel Pre-Filter & Calibration Upload
      </span>
    </div>

    <div class="foh-mini-field full-width">
      <label for="wsm-input-filter">Input Filter</label>
      <select
        id="wsm-input-filter"
        name="input-filter"
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

    <div class="foh-mini-field full-width">
      <label for="wsm-calibration-upload">Upload New Calibration (.cal / .txt / .frd)</label>
      <input
        type="file"
        id="wsm-calibration-upload"
        name="mic-calibration-file"
        aria-label="Mic Calibration File"
        accept=".cal,.txt,.frd"
        @change=${onCalibrationUpload}
      />
    </div>
  `;
}
