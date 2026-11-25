// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type PopoverParentRootLike,
  renderAudioInterfaceIconSvg,
  renderChevronDownSvg,
  renderPauseIconSvg,
  renderPlayIconSvg,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
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
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onInputSourceSelect: (mode: InputSourceMode, deviceId: string) => void;
  readonly onGlobalReferenceChannelChange: (refCh: number) => void;
  readonly onTogglePause: () => void;
}

function summarizeInputLabel(props: InputRoutingGroupProps): string {
  if (props.audioInputMode === 'simulator') {
    return 'Demo Simulator';
  }
  const matched = props.audioDevices.find((d) => d.deviceId === props.selectedDeviceId);
  const rawName = matched?.label || props.selectedDeviceLabel || 'Hardware Input';
  const cleanName = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const refTag =
    props.globalReferenceChannel === -1
      ? 'Int Ref'
      : `Ref Ch${props.globalReferenceChannel + 1}`;
  return `${cleanName} · ${refTag}`;
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

  const summaryText = summarizeInputLabel(props);

  return html`
    <div class="foh-topbar-zone" role="group" aria-label="Audio Input and Reference">
      <button
        type="button"
        data-testid="btn-pause"
        aria-pressed=${String(props.isPaused)}
        aria-label="Pause or resume live measurement"
        class="foh-tb-pill wsm-pause-pill ${props.isPaused ? 'foh-tb-paused' : ''}"
        title="Pause / Resume Live Measurement (Space)"
        @click=${props.onTogglePause}
      >
        ${props.isPaused ? renderPlayIconSvg() : renderPauseIconSvg()}
        <span class=${props.isPaused ? '' : 'foh-hide-below-medium'}
          >${props.isPaused ? 'Resume' : 'Pause'}</span
        >
      </button>

      <button
        type="button"
        class="foh-tb-pill wsm-io-pill"
        data-testid="btn-io-popover"
        data-popover-trigger="wsm-io-popover"
        popovertarget="wsm-io-popover"
        aria-expanded="false"
        title="Configure Audio Input Source & Global Reference Channel"
      >
        ${renderAudioInterfaceIconSvg()}
        <span class="foh-pill-val">${summaryText}</span>
        ${renderChevronDownSvg()}
      </button>

      <div
        id="wsm-io-popover"
        popover="auto"
        class="foh-popover"
        @toggle=${(ev: Event) => {
          if (props.popoverRoot) syncAnchoredPopoverToggle(ev, props.popoverRoot);
        }}
      >
        <div class="foh-popover-title">Audio Input &amp; Reference</div>
        <div class="foh-popover-grid">
          <div class="foh-popover-row">
            <label for="wsm-select-input-mode">Audio Input Source</label>
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
          </div>

          ${props.audioInputMode === 'hardware'
            ? html`
                <div class="foh-popover-row">
                  <label
                    for="wsm-select-ref-channel"
                    title="Global dual-FFT reference signal for transfer-function magnitude, phase, coherence, impulse deconvolution, and delay estimation"
                  >
                    Global Reference Channel
                  </label>
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
                      Internal Signal Generator
                    </option>
                    ${inputChannelIndices.map(
                      (ch) =>
                        html`<option
                          value=${String(ch)}
                          ?selected=${ch === props.globalReferenceChannel}
                        >
                          In Ch ${ch + 1} (Loopback / Mix Ref)
                        </option>`
                    )}
                  </select>
                </div>
              `
            : nothing}
        </div>
      </div>
    </div>
  `;
}
