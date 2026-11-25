// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for Live Measurement slots (routing, delay finder, gain/polarity,
 * feedback watch mode, mic calibration, and collapsible FFT/averaging settings).
 */

import type { PopoverParentRootLike } from '@foh/ui';
import { html, nothing, TemplateResult } from 'lit';
import { MeasurementPipelineConfig } from '../../dsp/analyzer-pipeline.js';
import { DelayEstimate } from '../../dsp/deconvolution.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
} from '../../dsp/dsp-worker-protocol.js';
import {
  FeedbackReferenceMode,
  FeedbackSensitivityMode,
} from '../../dsp/feedback-detector.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
} from '../../dsp/synthetic-rig.js';
import type {
  BroadbandLevelsSnapshot,
  WeightingCurve,
} from '../../dsp/weighting-meters.js';
import { StoredCalibrationFile } from '../../sources/session-storage.js';
import {
  renderAdvancedMeasurementSettings,
  renderCalibrationSelectorSection,
  renderSplCalibratorPopover,
} from './calibration-inspector-section.js';

export interface LiveMeasurementInspectorHandlers {
  readonly slot?: LiveMeasurementSlotConfig;
  readonly delayEstimate?: DelayEstimate;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly splWeighting?: WeightingCurve;
  readonly popoverRoot?: PopoverParentRootLike;
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
  readonly mixerWatchEnabled?: boolean;
  readonly mixerWatchChannelCount?: number;
  readonly onOpenMixerWatch?: () => void;
}

function renderDbfsMeterRow(
  label: string,
  rmsDbFs: number | undefined,
  peakDbFs: number | undefined,
  testIdPrefix: string
): TemplateResult {
  const rms = rmsDbFs !== undefined && Number.isFinite(rmsDbFs) ? rmsDbFs : -140;
  const peak = peakDbFs !== undefined && Number.isFinite(peakDbFs) ? peakDbFs : -140;
  const toPct = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const rmsPct = toPct(rms);
  const peakPct = toPct(peak);
  const isClip = peak >= -0.5;
  const fillColor =
    rms >= -3 ? '#ef4444' : rms >= -12 ? '#f59e0b' : '#10b981';
  const displayVal = rms > -99 ? `${rms.toFixed(1)} dB` : '— dB';

  return html`
    <div class="dbfs-meter-row" data-testid="${testIdPrefix}-row">
      <span class="dbfs-meter-label">${label}</span>
      <div class="dbfs-meter-track">
        <div
          class="dbfs-meter-fill"
          style="width:${rmsPct.toFixed(1)}%;background:${fillColor};"
        ></div>
        ${peak > -60
          ? html`<div class="dbfs-meter-peak" style="left:calc(${peakPct.toFixed(1)}% - 1px);"></div>`
          : nothing}
      </div>
      <span class="dbfs-meter-val" data-testid="${testIdPrefix}-rms">${displayVal}</span>
      <span
        class="dbfs-clip-badge ${isClip ? 'clip' : ''}"
        data-testid="${testIdPrefix}-clip"
      >
        ${isClip ? 'CLIP' : 'OK'}
      </span>
    </div>
  `;
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
    <div
      class="foh-form-section"
      data-testid="inspector-live-measurement"
      data-doc-region="live-inspector"
    >
      <div class="foh-form-section-title">
        <span>${slot ? `${slot.name} Settings` : 'Live Measurement Settings'}</span>
        <div style="display:flex;gap:4px;">
          ${handlers.onCaptureTrace
            ? html`
                <button
                  type="button"
                  class="foh-btn foh-btn-xs"
                  data-testid="btn-capture-trace"
                  title="Capture current trace into Stored Sources (Shortcut: C)"
                  @click=${handlers.onCaptureTrace}
                >
                  Capture
                </button>
              `
            : nothing}
          <button
            type="button"
            class="foh-btn foh-btn-xs"
            @click=${handlers.onResetAveraging}
          >
            Reset Avg
          </button>
          ${handlers.canDeleteSlot
            ? html`
                <button
                  type="button"
                  class="foh-btn foh-btn-xs foh-btn-danger"
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

      <div class="foh-xy-grid">
        ${slot
          ? html`
              <div class="foh-mini-field full-width">
                <label for="wsm-live-slot-name">Measurement Name</label>
                <input
                  type="text"
                  id="wsm-live-slot-name"
                  name="live-measurement-name"
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
                    <div class="foh-mini-field full-width">
                      <label for="wsm-live-slot-preset">Simulator Rig Preset</label>
                      <select
                        id="wsm-live-slot-preset"
                        name="slot-simulator-preset"
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
                      <div class="sim-banner" data-testid="simulator-description">
                        ${SIMULATOR_PRESETS[slot.simulatorPreset].description}
                      </div>
                    </div>
                  `
                : html`
                    <div class="foh-mini-field full-width">
                      <label for="wsm-live-slot-meas-ch">Meas Channel (M)</label>
                      <select
                        id="wsm-live-slot-meas-ch"
                        name="slot-measurement-channel"
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

        <div class="foh-mini-field full-width">
          <span>Preamp Headroom (dBFS)</span>
          <div class="dbfs-meter-strip" data-testid="input-dbfs-meter-strip">
            ${renderDbfsMeterRow(
              'Meas M',
              handlers.levels?.inputRmsDbFs ??
                (handlers.levels
                  ? handlers.levels.levelsDb.Z.Fast -
                    handlers.levels.splOffsetDb -
                    cfg.gainDb
                  : undefined),
              handlers.levels?.inputPeakDbFs ??
                (handlers.levels
                  ? handlers.levels.peaksDb.Z -
                    handlers.levels.splOffsetDb -
                    cfg.gainDb
                  : undefined),
              'meter-meas-in'
            )}
            ${renderDbfsMeterRow(
              'Ref R',
              handlers.levels?.referenceRmsDb,
              handlers.levels?.referencePeakDb,
              'meter-ref-in'
            )}
          </div>
        </div>

        <div class="foh-mini-field">
          <label for="wsm-ref-delay-ms">Ref Delay (ms)</label>
          <input
            type="number"
            id="wsm-ref-delay-ms"
            name="reference-delay-ms"
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

        <div class="foh-mini-field">
          <span
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
          </span>
          <button
            type="button"
            class="foh-btn foh-btn-primary"
            data-testid="btn-apply-delay"
            title="Find propagation delay via cross-correlation and apply to Reference channel (Shortcut: D)"
            @click=${handlers.onFindAndApplyDelay}
          >
            Find & Apply Delay
          </button>
        </div>

        <div class="foh-mini-field">
          <label for="wsm-input-gain-db">Input Gain (dB)</label>
          <input
            type="number"
            id="wsm-input-gain-db"
            name="input-gain-db"
            step="0.5"
            aria-label="Input Gain (dB)"
            .value=${String(cfg.gainDb)}
            @change=${(e: Event) =>
              handlers.onUpdateConfig({
                gainDb: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>

        <div class="foh-mini-field">
          <span>Polarity</span>
          <button
            type="button"
            class="foh-btn ${cfg.invertPolarity ? 'foh-btn-active' : ''}"
            @click=${() => handlers.onUpdateConfig({ invertPolarity: !cfg.invertPolarity })}
          >
            ${cfg.invertPolarity ? 'Inverted (−180°)' : 'Normal (+)'}
          </button>
        </div>

        <div class="foh-mini-field">
          <label
            for="wsm-spl-offset-db"
            title="Acoustic SPL corresponding to 0 dBFS — shifts SPL & Show Leq readouts without moving Transfer Function or RTA dBFS traces"
          >
            SPL Offset (0 dBFS)
          </label>
          <input
            type="number"
            id="wsm-spl-offset-db"
            name="spl-offset-db"
            step="0.5"
            aria-label="SPL Offset (dB at 0 dBFS)"
            data-testid="input-spl-offset-db"
            .value=${String(cfg.splOffsetDb)}
            @change=${(e: Event) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              if (Number.isFinite(v)) handlers.onUpdateConfig({ splOffsetDb: v });
            }}
          />
        </div>

        <div class="foh-mini-field">
          <span>Acoustic SPL Cal</span>
          <button
            type="button"
            class="foh-btn"
            data-testid="btn-calibrate-spl"
            data-popover-trigger="wsm-inspector-cal-pop"
            popovertarget="wsm-inspector-cal-pop"
            aria-expanded="false"
            title="Match SPL Offset against a 94 / 114 dB pistonphone calibrator or reference SPL meter"
          >
            Calibrate SPL…
          </button>
          ${renderSplCalibratorPopover({
            popoverId: 'wsm-inspector-cal-pop',
            slotName: slot?.name ?? cfg.name,
            cfg,
            levels: handlers.levels,
            splWeighting: handlers.splWeighting,
            popoverRoot: handlers.popoverRoot,
            onUpdateConfig: handlers.onUpdateConfig,
          })}
        </div>

        <div class="foh-mini-field">
          <label for="wsm-feedback-mode">Feedback Watch Mode</label>
          <select
            id="wsm-feedback-mode"
            name="feedback-watch-mode"
            aria-label="Feedback Watch Mode"
            data-testid="select-feedback-mode"
            .value=${cfg.feedbackMode ?? 'foh-normal'}
            @change=${(e: Event) =>
              handlers.onUpdateConfig({
                feedbackMode: (e.target as HTMLSelectElement)
                  .value as FeedbackSensitivityMode,
              })}
          >
            <option value="foh-normal">FOH Concert Strict</option>
            <option value="monitor-sensitive">Soundcheck / Wedge Ring-Out</option>
            <option value="custom">Custom Thresholds</option>
            <option value="off">Off</option>
          </select>
        </div>

        <div class="foh-mini-field">
          <label
            for="wsm-feedback-ref-mode"
            title="How Reference (R) relates to single-mic Feedback Watch"
          >
            Feedback Ref (R) Role
          </label>
          <select
            id="wsm-feedback-ref-mode"
            name="feedback-ref-mode"
            aria-label="Feedback Reference Role"
            data-testid="select-feedback-ref-mode"
            .value=${cfg.feedbackRefMode ?? 'closed-loop-mix'}
            @change=${(e: Event) =>
              handlers.onUpdateConfig({
                feedbackRefMode: (e.target as HTMLSelectElement)
                  .value as FeedbackReferenceMode,
              })}
          >
            <option value="closed-loop-mix">Console Mix (Tag In-Mix vs Stage)</option>
            <option value="playback-veto">Playback / Stem Veto (Suppress R)</option>
            <option value="ignore">Ignore Reference</option>
          </select>
        </div>

        ${handlers.onOpenMixerWatch
          ? html`
              <div class="foh-mini-field full-width">
                <button
                  type="button"
                  class="foh-btn ${handlers.mixerWatchEnabled ? 'foh-btn-accent' : ''}"
                  data-testid="btn-tuning-mixer-watch"
                  style="width:100%;justify-content:space-between;"
                  title="Watch up to 32 mixer USB inputs to pinpoint which channel is feeding back"
                  @click=${handlers.onOpenMixerWatch}
                >
                  <span>Mixer Input Watch (Culprit Attribution)</span>
                  <span>
                    ${handlers.mixerWatchEnabled
                      ? `ON · ${handlers.mixerWatchChannelCount ?? 0} ch`
                      : 'Configure…'}
                  </span>
                </button>
              </div>
            `
          : nothing}

        ${renderCalibrationSelectorSection({
          savedCalibrations: savedCals,
          activeCalibrationId: activeCalId,
          onSelectCalibration: handlers.onSelectCalibration,
          onDeleteCalibration: handlers.onDeleteCalibration,
        })}

        <div class="foh-mini-field full-width" style="margin-top:4px;">
          <button
            type="button"
            class="foh-btn"
            data-testid="btn-toggle-advanced-meas"
            aria-expanded=${String(showAdvanced)}
            style="width:100%;justify-content:space-between;"
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
