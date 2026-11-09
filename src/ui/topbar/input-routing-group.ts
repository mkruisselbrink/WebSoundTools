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
  readonly onInputModeChange: (e: Event) => void;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly onGlobalReferenceChannelChange: (refCh: number) => void;
}

export function renderInputRoutingGroup(props: InputRoutingGroupProps): TemplateResult {
  const inputChannelIndices = Array.from({ length: props.availableChannels }, (_, i) => i);
  const hasSelectedDeviceInList =
    !props.selectedDeviceId ||
    props.audioDevices.some((d) => d.deviceId === props.selectedDeviceId);

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

      ${props.audioInputMode === 'hardware'
        ? html`
            <select
              aria-label="Audio Device"
              data-testid="select-audio-device"
              .value=${props.selectedDeviceId}
              @change=${(e: Event) =>
                props.onDeviceChange((e.target as HTMLSelectElement).value)}
            >
              <option value="">Default Input Device</option>
              ${!hasSelectedDeviceInList
                ? html`<option value=${props.selectedDeviceId} selected>
                    ${props.selectedDeviceLabel || 'Saved Input Device'}
                  </option>`
                : ''}
              ${props.audioDevices.map(
                (d) =>
                  html`<option
                    value=${d.deviceId}
                    ?selected=${d.deviceId === props.selectedDeviceId}
                  >
                    ${d.label}
                  </option>`
              )}
            </select>
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
