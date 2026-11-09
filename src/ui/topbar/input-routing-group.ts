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
import { AudioDeviceOption } from '../../audio/audio-engine.js';
import { InputSourceMode } from '../../dsp/dsp.worker.js';

export interface InputRoutingGroupProps {
  readonly audioInputMode: InputSourceMode;
  readonly audioDevices: readonly AudioDeviceOption[];
  readonly selectedDeviceId: string;
  readonly selectedDeviceLabel?: string;
  readonly availableChannels: number;
  readonly globalReferenceChannel: number;
  readonly onInputSourceSelect: (mode: InputSourceMode, deviceId: string) => void;
  readonly onGlobalReferenceChannelChange: (refCh: number) => void;
}

export function renderInputRoutingGroup(props: InputRoutingGroupProps): TemplateResult {
  const inputChannelIndices = Array.from({ length: props.availableChannels }, (_, i) => i);
  const hasSelectedDeviceInList =
    !props.selectedDeviceId ||
    props.audioDevices.some((d) => d.deviceId === props.selectedDeviceId);

  const currentSelectValue =
    props.audioInputMode === 'simulator'
      ? 'simulator'
      : props.selectedDeviceId
        ? `hardware:${props.selectedDeviceId}`
        : 'hardware';

  const handleSelectChange = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'simulator') {
      props.onInputSourceSelect('simulator', props.selectedDeviceId);
    } else if (val.startsWith('hardware:')) {
      props.onInputSourceSelect('hardware', val.slice('hardware:'.length));
    } else {
      props.onInputSourceSelect('hardware', '');
    }
  };

  return html`
    <div class="toolbar-group">
      <span class="toolbar-label">Input</span>
      <select
        aria-label="Audio Input Source"
        data-testid="select-input-mode"
        .value=${currentSelectValue}
        @change=${handleSelectChange}
      >
        <option value="simulator" ?selected=${currentSelectValue === 'simulator'}>
          Built-in Demo Simulator
        </option>
        <option value="hardware" ?selected=${currentSelectValue === 'hardware'}>
          Hardware: Default Input Device
        </option>
        ${!hasSelectedDeviceInList
          ? html`<option
              value=${`hardware:${props.selectedDeviceId}`}
              ?selected=${currentSelectValue === `hardware:${props.selectedDeviceId}`}
            >
              Hardware: ${props.selectedDeviceLabel || 'Saved Input Device'}
            </option>`
          : nothing}
        ${props.audioDevices.map((d) => {
          const optVal = `hardware:${d.deviceId}`;
          return html`<option
            value=${optVal}
            ?selected=${currentSelectValue === optVal}
          >
            Hardware: ${d.label}
          </option>`;
        })}
      </select>

      ${props.audioInputMode === 'hardware'
        ? html`
            <span
              class="toolbar-label"
              title="Global Reference Timing Channel (Physical Loopback Input or Internal Signal Generator)"
              >Ref:</span
            >
            <select
              aria-label="Global Reference Channel"
              data-testid="select-ref-channel"
              .value=${String(props.globalReferenceChannel)}
              @change=${(e: Event) =>
                props.onGlobalReferenceChannelChange(
                  Number((e.target as HTMLSelectElement).value)
                )}
            >
              <option value="-1" ?selected=${props.globalReferenceChannel === -1}>
                Internal Gen
              </option>
              ${inputChannelIndices.map(
                (ch) =>
                  html`<option
                    value=${String(ch)}
                    ?selected=${ch === props.globalReferenceChannel}
                  >
                    In Ch ${ch + 1} (Loopback)
                  </option>`
              )}
            </select>
          `
        : nothing}
    </div>
  `;
}
