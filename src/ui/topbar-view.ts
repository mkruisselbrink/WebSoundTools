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
import { AudioDeviceOption } from '../audio/audio-engine.js';
import { DelayEstimate } from '../dsp/deconvolution.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  GENERATOR_SIGNAL_LABELS,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import { SIMULATOR_PRESETS, SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  BroadbandLevelsSnapshot,
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import type { LayoutPreset } from './app-shell.js';

export interface TopbarViewProps {
  readonly layoutPreset: LayoutPreset;
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly audioDevices: readonly AudioDeviceOption[];
  readonly selectedDeviceId: string;
  readonly availableChannels: number;
  readonly availableOutputChannels: number;
  readonly measurementChannel: number;
  readonly referenceChannel: number;
  readonly generatorOutputChannel: number;
  readonly genConfig: SignalGeneratorConfig;
  readonly isPaused: boolean;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly delayEstimate?: DelayEstimate;
  readonly onLayoutPresetChange: (preset: LayoutPreset) => void;
  readonly onInputModeChange: (e: Event) => void;
  readonly onSimulatorPresetChange: (e: Event) => void;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly onChannelRoutingChange: (measCh: number, refCh: number) => void;
  readonly onGeneratorOutputChannelChange: (outCh: number) => void;
  readonly onToggleGenerator: () => void;
  readonly onGeneratorTypeChange: (type: GeneratorSignalType) => void;
  readonly onGeneratorLevelChange: (levelDbFs: number) => void;
  readonly onFindAndApplyDelay: () => void;
  readonly onCaptureTrace: () => void;
  readonly onTogglePause: () => void;
  readonly onSplWeightingChange: (curve: WeightingCurve) => void;
  readonly onSplTimeChange: (time: MeterIntegrationTime) => void;
}

export function renderTopbar(props: TopbarViewProps): TemplateResult {
  const { levels, delayEstimate: delayEst } = props;
  const currentSpl = levels ? levels.levelsDb[props.splWeighting][props.splTime] : -40.0;
  const currentLeq = levels ? levels.levelsDb[props.splWeighting].Leq : -40.0;
  const currentPeak = levels ? levels.peaksDb[props.splWeighting] : -40.0;

  const inputChannelIndices = Array.from({ length: props.availableChannels }, (_, i) => i);
  const outputChannelIndices = Array.from({ length: props.availableOutputChannels }, (_, i) => i);

  return html`
    <header class="topbar">
      <div class="brand">
        <span>WebSoundMeter</span>
        <select
          aria-label="Chart Layout"
          data-testid="select-layout"
          .value=${props.layoutPreset}
          @change=${(e: Event) =>
            props.onLayoutPresetChange((e.target as HTMLSelectElement).value as LayoutPreset)}
        >
          <option value="pa-triple">PA Alignment (Mag + Phase + Impulse)</option>
          <option value="tf-dual">Transfer Function (Mag + Phase)</option>
          <option value="rta-mix">Live Mixing (RTA + Magnitude)</option>
          <option value="single">Single Chart</option>
        </select>
      </div>

      <!-- Input Mode & Built-in Demo Simulator / Hardware Routing Selector -->
      <div class="toolbar-group">
        <span class="toolbar-label">Input</span>
        <select
          aria-label="Input Mode"
          data-testid="select-input-mode"
          .value=${props.audioInputMode}
          @change=${props.onInputModeChange}
        >
          <option value="simulator">Built-in Demo Simulator</option>
          <option value="hardware">Hardware Audio Input (Mic/Interface)</option>
        </select>

        ${props.audioInputMode === 'simulator'
          ? html`
              <select
                aria-label="Simulator Preset"
                data-testid="select-simulator-preset"
                .value=${props.simulatorPreset}
                @change=${props.onSimulatorPresetChange}
              >
                ${Object.values(SIMULATOR_PRESETS).map(
                  (p) => html`<option value=${p.id}>${p.name}</option>`
                )}
              </select>
            `
          : html`
              <select
                aria-label="Audio Device"
                data-testid="select-audio-device"
                .value=${props.selectedDeviceId}
                @change=${(e: Event) =>
                  props.onDeviceChange((e.target as HTMLSelectElement).value)}
              >
                <option value="">Default Input Device</option>
                ${props.audioDevices.map(
                  (d) => html`<option value=${d.deviceId}>${d.label}</option>`
                )}
              </select>
              <span class="toolbar-label" title="Measurement Microphone Input Channel">M:</span>
              <select
                aria-label="Measurement Input Channel"
                data-testid="select-meas-channel"
                .value=${String(props.measurementChannel)}
                @change=${(e: Event) =>
                  props.onChannelRoutingChange(
                    Number((e.target as HTMLSelectElement).value),
                    props.referenceChannel
                  )}
              >
                ${inputChannelIndices.map(
                  (ch) =>
                    html`<option value=${String(ch)} ?selected=${ch === props.measurementChannel}>
                      In Ch ${ch + 1}
                    </option>`
                )}
              </select>
              <span
                class="toolbar-label"
                title="Reference Timing Channel (Physical Loopback Input or Internal Signal Generator)"
                >Ref:</span
              >
              <select
                aria-label="Reference Channel"
                data-testid="select-ref-channel"
                .value=${String(props.referenceChannel)}
                @change=${(e: Event) =>
                  props.onChannelRoutingChange(
                    props.measurementChannel,
                    Number((e.target as HTMLSelectElement).value)
                  )}
              >
                <option value="-1" ?selected=${props.referenceChannel === -1}>
                  Internal Gen
                </option>
                ${inputChannelIndices.map(
                  (ch) =>
                    html`<option value=${String(ch)} ?selected=${ch === props.referenceChannel}>
                      In Ch ${ch + 1} (Loopback)
                    </option>`
                )}
              </select>
            `}
      </div>

      <!-- Signal Generator Controls & Hardware Output Routing -->
      <div class="toolbar-group">
        <span class="toolbar-label">Gen</span>
        <button
          data-testid="btn-generator-toggle"
          class="btn-toggle-gen ${props.genConfig.enabled ? 'btn-accent' : ''}"
          @click=${props.onToggleGenerator}
        >
          ${props.genConfig.enabled ? 'ON' : 'OFF'}
        </button>
        <select
          aria-label="Generator Signal Type"
          data-testid="select-generator-type"
          .value=${props.genConfig.type}
          @change=${(e: Event) =>
            props.onGeneratorTypeChange(
              (e.target as HTMLSelectElement).value as GeneratorSignalType
            )}
        >
          ${Object.entries(GENERATOR_SIGNAL_LABELS).map(
            ([k, label]) => html`<option value=${k}>${label}</option>`
          )}
        </select>
        <select
          aria-label="Generator Level (dBFS)"
          data-testid="select-generator-level"
          title="Generator Output Level (dBFS)"
          .value=${String(props.genConfig.levelDbFs)}
          @change=${(e: Event) =>
            props.onGeneratorLevelChange(Number((e.target as HTMLSelectElement).value))}
        >
          <option value="-6">-6 dBFS</option>
          <option value="-12">-12 dBFS</option>
          <option value="-18">-18 dBFS</option>
          <option value="-24">-24 dBFS</option>
        </select>
        ${props.audioInputMode === 'hardware'
          ? html`
              <span class="toolbar-label" title="Hardware Audio Output Channel for Signal Generator"
                >Out:</span
              >
              <select
                aria-label="Generator Output Channel"
                data-testid="select-generator-output-channel"
                .value=${String(props.generatorOutputChannel)}
                @change=${(e: Event) =>
                  props.onGeneratorOutputChannelChange(
                    Number((e.target as HTMLSelectElement).value)
                  )}
              >
                <option value="-1" ?selected=${props.generatorOutputChannel === -1}>
                  Out Ch 1+2
                </option>
                ${outputChannelIndices.map(
                  (ch) =>
                    html`<option
                      value=${String(ch)}
                      ?selected=${ch === props.generatorOutputChannel}
                    >
                      Out Ch ${ch + 1}
                    </option>`
                )}
                <option value="-2" ?selected=${props.generatorOutputChannel === -2}>
                  Mute Out
                </option>
              </select>
            `
          : ''}
      </div>

      <!-- Auto Delay Finder & Capture Actions -->
      <div class="toolbar-group">
        <span class="toolbar-label delay-readout" data-testid="delay-estimate-readout">
          <span>Est Delay:</span>
          <strong class="delay-value" data-testid="estimated-delay-ms"
            >${delayEst ? `${delayEst.delayMs.toFixed(2)} ms` : '—'}</strong
          >
          <span class="pol-badge ${delayEst && delayEst.polarity < 0 ? '' : 'hidden'}"
            >(−POL)</span
          >
        </span>
        <button
          class="btn-primary"
          data-testid="btn-apply-delay"
          title="Find propagation delay via cross-correlation and apply to Reference channel (Shortcut: D)"
          @click=${props.onFindAndApplyDelay}
        >
          Find & Apply Delay
        </button>
        <button
          data-testid="btn-capture-trace"
          title="Capture current trace into Stored Sources (Shortcut: Space / C)"
          @click=${props.onCaptureTrace}
        >
          Capture (Space)
        </button>
        <button
          data-testid="btn-pause"
          class="btn-toggle-pause ${props.isPaused ? 'btn-active' : ''}"
          @click=${props.onTogglePause}
        >
          ${props.isPaused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <!-- Live Broadband SPL / Leq / Peak Meter Bar -->
      <div class="toolbar-group spl-readout" data-testid="spl-meter-bar">
        <select
          aria-label="SPL Weighting"
          data-testid="select-spl-weighting"
          .value=${props.splWeighting}
          @change=${(e: Event) =>
            props.onSplWeightingChange((e.target as HTMLSelectElement).value as WeightingCurve)}
        >
          <option value="A">dBA</option>
          <option value="C">dBC</option>
          <option value="Z">dBZ</option>
        </select>
        <select
          aria-label="SPL Integration Time"
          .value=${props.splTime}
          @change=${(e: Event) =>
            props.onSplTimeChange(
              (e.target as HTMLSelectElement).value as MeterIntegrationTime
            )}
        >
          <option value="Fast">Fast</option>
          <option value="Slow">Slow</option>
          <option value="Impulse">Impulse</option>
        </select>
        <div class="spl-main-value" data-testid="spl-main-value">
          ${currentSpl.toFixed(1)} dB${props.splWeighting}
        </div>
        <div class="spl-sub-value">
          <div class="spl-sub-row"><span>Leq:</span><strong>${currentLeq.toFixed(1)}</strong></div>
          <div class="spl-sub-row"><span>Pk:</span><strong>${currentPeak.toFixed(1)}</strong></div>
        </div>
      </div>
    </header>
  `;
}

