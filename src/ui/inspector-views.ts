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

import { html, TemplateResult } from 'lit';
import {
  InputPreFilterType,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { BiquadFilterType, BiquadSpec } from '../dsp/biquad.js';
import { OctaveSmoothingType } from '../dsp/smoothing.js';
import { AveragingType, TransferEstimatorType } from '../dsp/transfer-function.js';
import {
  WINDOW_FUNCTION_LABELS,
  WindowFunctionType,
} from '../dsp/window-functions.js';
import { EqualizerSourceConfig } from '../sources/eq-source.js';
import { SourceData } from '../sources/source-data.js';
import {
  UNION_OPERATION_LABELS,
  UnionOperation,
  UnionSourceConfig,
} from '../sources/union-source.js';

export interface LiveMeasurementInspectorHandlers {
  readonly onResetAveraging: () => void;
  readonly onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) => void;
  readonly onCalibrationUpload: (e: Event) => void;
}

export function renderLiveMeasurementInspector(
  cfg: MeasurementPipelineConfig,
  handlers: LiveMeasurementInspectorHandlers
): TemplateResult {
  return html`
    <div class="section-card" data-testid="inspector-live-measurement">
      <div class="section-header">
        <span>Live Measurement Settings</span>
        <button @click=${handlers.onResetAveraging}>Reset Avg</button>
      </div>

      <div class="prop-grid">
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
          <label>Mic Calibration (.cal / .txt)</label>
          <input
            type="file"
            aria-label="Mic Calibration File"
            accept=".cal,.txt,.frd"
            @change=${handlers.onCalibrationUpload}
          />
        </div>
      </div>
    </div>
  `;
}

export interface StoredInspectorHandlers {
  readonly onDelete: (id: string) => void;
  readonly onUpdateStored: (
    id: string,
    partial: Partial<Pick<SourceData, 'name' | 'gainOffsetDb' | 'delayOffsetMs'>>
  ) => void;
}

export function renderStoredInspector(
  stored: SourceData,
  handlers: StoredInspectorHandlers
): TemplateResult {
  return html`
    <div class="section-card" data-testid="inspector-stored-source">
      <div class="section-header">
        <span>Stored Trace</span>
        <button style="color:#f43f5e;" @click=${() => handlers.onDelete(stored.id)}>
          Delete
        </button>
      </div>

      <div class="prop-grid">
        <div class="prop-field full-width">
          <label>Trace Name</label>
          <input
            type="text"
            aria-label="Stored Trace Name"
            .value=${stored.name}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                name: (e.target as HTMLInputElement).value,
              })}
          />
        </div>

        <div class="prop-field">
          <label>Gain Offset (dB)</label>
          <input
            type="number"
            step="0.5"
            aria-label="Stored Gain Offset (dB)"
            .value=${String(stored.gainOffsetDb)}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                gainOffsetDb: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>

        <div class="prop-field">
          <label>Delay Offset (ms)</label>
          <input
            type="number"
            step="0.1"
            aria-label="Stored Delay Offset (ms)"
            .value=${String(stored.delayOffsetMs)}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                delayOffsetMs: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>
      </div>
      <div style="font-size:11px;color:#94a3b8;">${stored.notes}</div>
    </div>
  `;
}

export interface EqInspectorHandlers {
  readonly onAutoFlatten: (eqId: string) => void;
  readonly onTargetSourceChange: (eqId: string, targetSourceId: string | null) => void;
  readonly onUpdateEqBand: (
    eqId: string,
    bandIdx: number,
    partial: Partial<BiquadSpec>
  ) => void;
}

export function renderEqInspector(
  eq: EqualizerSourceConfig,
  allSources: readonly SourceData[],
  handlers: EqInspectorHandlers
): TemplateResult {
  const candidateTargets = allSources.filter(
    (s) => s.kind === 'measurement' || s.kind === 'stored'
  );
  return html`
    <div class="section-card" data-testid="inspector-eq-source">
      <div class="section-header">
        <span>${eq.name}</span>
        <button
          class="btn-accent"
          data-testid="btn-auto-flatten-eq"
          title="Load corrective inverse EQ matching the PA Room Modes simulator preset"
          @click=${() => handlers.onAutoFlatten(eq.id)}
        >
          Auto-Match Room
        </button>
      </div>

      <div class="prop-field full-width">
        <label>Apply Virtual EQ To Source</label>
        <select
          aria-label="Apply Virtual EQ To Source"
          .value=${eq.targetSourceId ?? ''}
          @change=${(e: Event) => {
            const targetSourceId = (e.target as HTMLSelectElement).value || null;
            handlers.onTargetSourceChange(eq.id, targetSourceId);
          }}
        >
          <option value="">None (Show Filter Curve Only)</option>
          ${candidateTargets.map(
            (s) =>
              html`<option value=${s.id} ?selected=${s.id === eq.targetSourceId}>
                ${s.name}
              </option>`
          )}
        </select>
      </div>

      <div style="font-size:10px;color:#94a3b8;">
        Tip: Drag green EQ handles directly on the Magnitude chart!
      </div>

      ${eq.bands.map(
        (b, idx) => html`
          <div class="eq-band-row">
            <input
              type="checkbox"
              aria-label="Enable EQ Band ${idx + 1}"
              .checked=${b.enabled !== false}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  enabled: (e.target as HTMLInputElement).checked,
                })}
            />
            <select
              aria-label="EQ Band ${idx + 1} Type"
              .value=${b.type}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  type: (e.target as HTMLSelectElement).value as BiquadFilterType,
                })}
            >
              <option value="peaking">Bell</option>
              <option value="lowshelf">LShelf</option>
              <option value="highshelf">HShelf</option>
              <option value="highpass">HPF</option>
              <option value="lowpass">LPF</option>
              <option value="allpass">AllPass</option>
            </select>
            <input
              type="number"
              aria-label="EQ Band ${idx + 1} Frequency (Hz)"
              title="Frequency (Hz)"
              .value=${String(b.frequency)}
              @input=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  frequency: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              type="number"
              step="0.5"
              aria-label="EQ Band ${idx + 1} Gain (dB)"
              title="Gain (dB)"
              .value=${String(b.gainDb ?? 0)}
              @input=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  gainDb: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              type="number"
              step="0.1"
              aria-label="EQ Band ${idx + 1} Q Factor"
              title="Q Factor"
              .value=${String(b.q ?? 0.7)}
              @input=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  q: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>
        `
      )}
    </div>
  `;
}

export interface UnionInspectorHandlers {
  readonly onUpdateUnion: (
    unionId: string,
    partial: Partial<Pick<UnionSourceConfig, 'operation' | 'sourceIds'>>
  ) => void;
}

export function renderUnionInspector(
  union: UnionSourceConfig,
  allSources: readonly SourceData[],
  handlers: UnionInspectorHandlers
): TemplateResult {
  const candidates = allSources.filter((s) => s.id !== union.id);
  return html`
    <div class="section-card" data-testid="inspector-union-source">
      <div class="section-header">
        <span>${union.name}</span>
      </div>

      <div class="prop-grid">
        <div class="prop-field full-width">
          <label>Math Operation</label>
          <select
            aria-label="Union Math Operation"
            .value=${union.operation}
            @change=${(e: Event) =>
              handlers.onUpdateUnion(union.id, {
                operation: (e.target as HTMLSelectElement).value as UnionOperation,
              })}
          >
            ${Object.entries(UNION_OPERATION_LABELS).map(
              ([k, label]) => html`<option value=${k}>${label}</option>`
            )}
          </select>
        </div>

        <div class="prop-field">
          <label>Source A</label>
          <select
            aria-label="Union Source A"
            .value=${union.sourceIds[0] ?? ''}
            @change=${(e: Event) => {
              const srcA = (e.target as HTMLSelectElement).value;
              handlers.onUpdateUnion(union.id, {
                sourceIds: [srcA, union.sourceIds[1] ?? srcA],
              });
            }}
          >
            ${candidates.map(
              (s) =>
                html`<option value=${s.id} ?selected=${s.id === union.sourceIds[0]}>
                  ${s.name}
                </option>`
            )}
          </select>
        </div>

        <div class="prop-field">
          <label>Source B</label>
          <select
            aria-label="Union Source B"
            .value=${union.sourceIds[1] ?? ''}
            @change=${(e: Event) => {
              const srcB = (e.target as HTMLSelectElement).value;
              handlers.onUpdateUnion(union.id, {
                sourceIds: [union.sourceIds[0] ?? srcB, srcB],
              });
            }}
          >
            ${candidates.map(
              (s) =>
                html`<option value=${s.id} ?selected=${s.id === union.sourceIds[1]}>
                  ${s.name}
                </option>`
            )}
          </select>
        </div>
      </div>
    </div>
  `;
}

