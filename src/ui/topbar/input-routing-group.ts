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
import { AudioDeviceOption } from '../../audio/audio-engine.js';
import { InputSourceMode } from '../../dsp/dsp.worker.js';
import { SIMULATOR_PRESETS, SimulatorPresetId } from '../../dsp/synthetic-rig.js';

export interface InputRoutingGroupProps {
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly audioDevices: readonly AudioDeviceOption[];
  readonly selectedDeviceId: string;
  readonly availableChannels: number;
  readonly measurementChannel: number;
  readonly referenceChannel: number;
  readonly onInputModeChange: (e: Event) => void;
  readonly onSimulatorPresetChange: (e: Event) => void;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly onChannelRoutingChange: (measCh: number, refCh: number) => void;
}

export function renderInputRoutingGroup(props: InputRoutingGroupProps): TemplateResult {
  const inputChannelIndices = Array.from({ length: props.availableChannels }, (_, i) => i);

  return html`
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
  `;
}

