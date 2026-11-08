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
} from '../../dsp/analyzer-pipeline.js';
import { OctaveSmoothingType } from '../../dsp/smoothing.js';
import { AveragingType, TransferEstimatorType } from '../../dsp/transfer-function.js';
import {
  WINDOW_FUNCTION_LABELS,
  WindowFunctionType,
} from '../../dsp/window-functions.js';

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
