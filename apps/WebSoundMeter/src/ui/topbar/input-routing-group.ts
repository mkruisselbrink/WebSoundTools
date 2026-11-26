// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type PopoverParentRootLike,
  closePopoverById,
  renderAudioInterfaceIconSvg,
  renderChevronDownSvg,
  renderPauseIconSvg,
  renderPlayIconSvg,
  renderStopSquareIconSvg,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
import { html, nothing, TemplateResult } from 'lit';
import { AudioDeviceOption } from '../../audio/audio-engine.js';
import { InputSourceMode } from '../../dsp/dsp.worker.js';
import { DEFAULT_AUTO_RELEASE_MINUTES } from '../../sources/workspace-session.js';

export interface InputRoutingGroupProps {
  readonly audioInputMode: InputSourceMode;
  readonly audioDevices: readonly AudioDeviceOption[];
  readonly selectedDeviceId: string;
  readonly selectedDeviceLabel?: string;
  readonly availableChannels: number;
  readonly globalReferenceChannel: number;
  readonly isPaused: boolean;
  readonly isHardwareDisconnected?: boolean;
  readonly autoReleaseMinutes?: number;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onInputSourceSelect: (mode: InputSourceMode, deviceId: string) => void;
  readonly onGlobalReferenceChannelChange: (refCh: number) => void;
  readonly onTogglePause: () => void;
  readonly onDisconnectHardware?: () => void;
  readonly onAutoReleaseMinutesChange?: (minutes: number) => void;
}

function summarizeInputLabel(props: InputRoutingGroupProps): string {
  if (props.audioInputMode === 'simulator') {
    return 'Demo Simulator';
  }
  const matched = props.audioDevices.find((d) => d.deviceId === props.selectedDeviceId);
  const rawName = matched?.label || props.selectedDeviceLabel || 'Hardware Input';
  const cleanName = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (props.isHardwareDisconnected) {
    return `${cleanName} · Off`;
  }
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
  const autoReleaseVal = props.autoReleaseMinutes ?? DEFAULT_AUTO_RELEASE_MINUTES;
  const pauseVariantClass = props.isPaused
    ? props.isHardwareDisconnected
      ? 'foh-tb-standby'
      : 'foh-tb-paused'
    : '';

  return html`
    <div class="foh-topbar-zone" role="group" aria-label="Audio Input and Reference">
      ${props.audioInputMode === 'hardware'
        ? html`
            <div
              class="foh-split-pill wsm-transport-split"
              role="group"
              aria-label="Hardware Capture Transport"
            >
              <button
                type="button"
                data-testid="btn-pause"
                aria-pressed=${String(props.isPaused)}
                aria-label=${props.isHardwareDisconnected
                  ? 'Reconnect and resume live measurement'
                  : 'Pause or resume live measurement'}
                class="wsm-pause-pill ${pauseVariantClass}"
                title=${props.isHardwareDisconnected
                  ? 'Reconnect & Resume Live Capture (Space)'
                  : 'Pause / Freeze DSP — Keeps Hardware Stream Warm (Space)'}
                @click=${props.onTogglePause}
              >
                ${props.isPaused ? renderPlayIconSvg() : renderPauseIconSvg()}
                <span
                  class=${props.isPaused
                    ? 'foh-hide-below-narrow'
                    : 'foh-hide-below-wide'}
                  >${props.isPaused ? 'Resume' : 'Pause'}</span
                >
              </button>
              <button
                type="button"
                class="wsm-stop-btn"
                data-testid="btn-stop-hardware"
                ?disabled=${Boolean(props.isHardwareDisconnected)}
                aria-label="Stop and disconnect hardware microphone"
                title=${props.isHardwareDisconnected
                  ? 'Hardware Audio Disconnected (OS Mic Released)'
                  : 'Stop & Disconnect Hardware Audio — Releases OS Mic (Shift+Space)'}
                @click=${() => props.onDisconnectHardware?.()}
              >
                ${renderStopSquareIconSvg()}
              </button>
            </div>
          `
        : html`
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
              <span
                class=${props.isPaused
                  ? 'foh-hide-below-narrow'
                  : 'foh-hide-below-wide'}
                >${props.isPaused ? 'Resume' : 'Pause'}</span
              >
            </button>
          `}

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
        data-doc-region="io-popover"
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

                  <div class="foh-popover-row">
                    <label
                      for="wsm-select-auto-release"
                      title="Automatically stop and release OS microphone capture if left Paused for this duration"
                    >
                      Auto-Release Mic When Paused
                    </label>
                    <select
                      id="wsm-select-auto-release"
                      name="auto-release-minutes"
                      aria-label="Auto-Release Mic When Paused"
                      data-testid="select-auto-release-minutes"
                      .value=${String(autoReleaseVal)}
                      @change=${(e: Event) =>
                        props.onAutoReleaseMinutesChange?.(
                          Number((e.target as HTMLSelectElement).value)
                        )}
                    >
                      <option value="0" ?selected=${autoReleaseVal === 0}>
                        Never (Keep Stream Warm)
                      </option>
                      <option value="2" ?selected=${autoReleaseVal === 2}>
                        After 2 minutes
                      </option>
                      <option value="5" ?selected=${autoReleaseVal === 5}>
                        After 5 minutes (Default)
                      </option>
                      <option value="10" ?selected=${autoReleaseVal === 10}>
                        After 10 minutes
                      </option>
                      <option value="30" ?selected=${autoReleaseVal === 30}>
                        After 30 minutes
                      </option>
                    </select>
                  </div>

                  <div class="foh-popover-row">
                    <button
                      type="button"
                      class="foh-tb-pill wsm-popover-full-btn ${props.isHardwareDisconnected
                        ? 'foh-tb-primary'
                        : ''}"
                      data-testid="btn-popover-disconnect-hw"
                      @click=${() => {
                        if (props.isHardwareDisconnected) {
                          props.onTogglePause();
                        } else {
                          props.onDisconnectHardware?.();
                        }
                        closePopoverById(props.popoverRoot, 'wsm-io-popover');
                      }}
                    >
                      ${props.isHardwareDisconnected
                        ? html`${renderPlayIconSvg()}
                            <span>Reconnect Audio Interface (Space)</span>`
                        : html`${renderStopSquareIconSvg()}
                            <span>Disconnect / Release OS Mic (Shift+Space)</span>`}
                    </button>
                  </div>
                `
              : nothing}
        </div>
      </div>
    </div>
  `;
}
