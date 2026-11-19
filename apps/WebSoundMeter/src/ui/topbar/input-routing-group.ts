// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

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
  readonly isPaused: boolean;
  readonly onInputSourceSelect: (mode: InputSourceMode, deviceId: string) => void;
  readonly onGlobalReferenceChannelChange: (refCh: number) => void;
  readonly onTogglePause: () => void;
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
    <div class="toolbar-group" role="group" aria-label="Audio Input Routing">
      <span class="toolbar-label">Input</span>
      <select
        id="wsm-select-input-mode"
        name="audio-input-source"
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
              id="wsm-select-ref-channel"
              name="global-reference-channel"
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

      <button
        type="button"
        data-testid="btn-pause"
        aria-pressed=${String(props.isPaused)}
        class="btn-toggle-pause ${props.isPaused ? 'btn-active' : ''}"
        title="Pause / Resume Live Measurement (Shortcut: Space)"
        @click=${props.onTogglePause}
      >
        ${props.isPaused ? 'Resume' : 'Pause'}
      </button>
    </div>
  `;
}
