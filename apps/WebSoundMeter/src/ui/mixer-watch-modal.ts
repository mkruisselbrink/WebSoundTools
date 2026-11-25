// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Mixer Input Watch & Named Patch Presets Modal (`src/ui/mixer-watch-modal.ts`).
 *
 * Configures up to 32 watched console USB channels (on either the primary audio interface
 * or an independent secondary USB mixer interface), named show/band patch presets with
 * automatic `deviceId` / `deviceLabel` affinity recall, Pre- vs. Post-Fader tap mode,
 * and live per-channel `dBFS` signal-activity LEDs.
 */

import { html, nothing, type TemplateResult } from 'lit';
import type { AudioDeviceOption } from '../audio/audio-engine.js';
import type { InputSourceMode } from '../dsp/dsp-worker-protocol.js';
import {
  MAX_MIXER_WATCH_CHANNELS,
  type MixerPatchLibraryState,
  type MixerTapMode,
  type MixerWatchChannelConfig,
  type MixerWatchSensitivityMode,
  type MixerWatchSessionConfig,
  findAffinityProfileForDevice,
} from '../sources/mixer-patch-storage.js';

export interface MixerWatchModalProps {
  readonly open: boolean;
  readonly audioInputMode: InputSourceMode;
  readonly mainDeviceId: string;
  readonly mainDeviceLabel: string;
  readonly audioDevices: readonly AudioDeviceOption[];
  readonly availableMixerChannels: number;
  readonly mixerSampleRate: number;
  readonly globalReferenceChannel: number;
  readonly config: MixerWatchSessionConfig;
  readonly library: MixerPatchLibraryState;
  readonly channelLevelsDbFs: Readonly<Record<number, number>>;
  readonly statusNotice: string;
  readonly draftPresetName: string;
  readonly onClose: () => void;
  readonly onDraftPresetNameChange: (name: string) => void;
  readonly onSaveNewPreset: (name: string) => void;
  readonly onUpdateActivePreset: () => void;
  readonly onDeleteActivePreset: () => void;
  readonly onSelectPreset: (profileId: string | null) => void;
  readonly onSelectMixerDevice: (mode: 'follow-main' | 'separate-device', deviceId: string, deviceLabel: string) => void;
  readonly onUpdateConfig: (partial: Partial<MixerWatchSessionConfig>) => void;
  readonly onUpdatePatch: (partial: {
    readonly tapMode?: MixerTapMode;
    readonly mixBusChannel?: number;
    readonly channels?: readonly MixerWatchChannelConfig[];
  }) => void;
}

function isImeComposingEnter(ev: KeyboardEvent): boolean {
  return ev.isComposing || ev.keyCode === 229;
}

export function renderMixerWatchModal(props: MixerWatchModalProps): TemplateResult {
  const { config, library, availableMixerChannels, channelLevelsDbFs } = props;
  const totalRows = Math.max(
    16,
    Math.min(64, Math.max(availableMixerChannels, config.patch.channels.length))
  );
  const channelByIdx = new Map<number, MixerWatchChannelConfig>();
  for (const ch of config.patch.channels) {
    channelByIdx.set(ch.channelIndex, ch);
  }
  const enabledCount = config.patch.channels.filter((c) => c.enabled).length;

  const currentDeviceId =
    config.deviceMode === 'separate-device'
      ? config.separateDeviceId
      : props.mainDeviceId;
  const currentDeviceLabel =
    config.deviceMode === 'separate-device'
      ? config.separateDeviceLabel
      : props.mainDeviceLabel;
  const affinityProfile =
    props.audioInputMode === 'hardware'
      ? findAffinityProfileForDevice(library, currentDeviceId, currentDeviceLabel)
      : null;
  const activeProfile = config.activeProfileId
    ? (library.profiles.find((p) => p.id === config.activeProfileId) ?? null)
    : null;

  const deviceSelectValue =
    config.deviceMode === 'separate-device' && config.separateDeviceId
      ? `sep:${config.separateDeviceId}`
      : 'follow-main';

  const globalRefLabel =
    props.globalReferenceChannel < 0
      ? 'Internal Gen'
      : `In Ch ${props.globalReferenceChannel + 1}`;

  const buildRows = (): MixerWatchChannelConfig[] =>
    Array.from({ length: totalRows }, (_, i) => {
      const existing = channelByIdx.get(i);
      return (
        existing ?? {
          channelIndex: i,
          name: `Ch ${i + 1}`,
          enabled: false,
        }
      );
    });

  const rows = buildRows();

  const applyBatchSelection = (predicate: (idx: number) => boolean): void => {
    let count = 0;
    const next = rows.map((row) => {
      let enabled = predicate(row.channelIndex);
      if (enabled) {
        if (count >= MAX_MIXER_WATCH_CHANNELS) {
          enabled = false;
        } else {
          count++;
        }
      }
      return { ...row, enabled };
    });
    props.onUpdatePatch({ channels: next });
  };

  const toggleSingleChannel = (idx: number, checked: boolean): void => {
    if (checked && enabledCount >= MAX_MIXER_WATCH_CHANNELS) {
      return;
    }
    const next = rows.map((r) =>
      r.channelIndex === idx ? { ...r, enabled: checked } : r
    );
    props.onUpdatePatch({ channels: next });
  };

  const renameSingleChannel = (idx: number, rawName: string): void => {
    const clean = rawName.trim() || `Ch ${idx + 1}`;
    const next = rows.map((r) =>
      r.channelIndex === idx ? { ...r, name: clean } : r
    );
    props.onUpdatePatch({ channels: next });
  };

  return html`
    <foh-modal
      class="mixer-watch-modal-host"
      .open=${props.open}
      modalTitle="Mixer Input Watch & Patch Presets"
      maxWidth="660px"
      dialogTestId="mixer-watch-modal"
      @close-modal=${props.onClose}
    >
      <div class="mixer-watch-modal-content">
        <!-- 1. Master Enable & Live Device Status -->
        <div class="mixer-watch-top-bar">
          <div class="mixer-watch-enable-group">
            <input
              type="checkbox"
              id="wsm-mixer-watch-enabled"
              name="mixer-watch-enabled"
              data-testid="toggle-mixer-watch-enabled"
              .checked=${config.enabled}
              @change=${(e: Event) =>
                props.onUpdateConfig({
                  enabled: (e.target as HTMLInputElement).checked,
                })}
            />
            <label for="wsm-mixer-watch-enabled">
              <strong>Watch Mixer Inputs for Feedback Culprits</strong>
            </label>
          </div>
          <span class="mixer-watch-status-pill ${config.enabled ? 'active' : ''}">
            ${config.enabled
              ? `Watching ${enabledCount}/${MAX_MIXER_WATCH_CHANNELS} ch · ${(
                  props.mixerSampleRate / 1000
                ).toFixed(1)} kHz`
              : 'Off (Single-Mic Mode)'}
          </span>
        </div>

        ${props.statusNotice
          ? html`<div class="mixer-watch-notice" role="status">${props.statusNotice}</div>`
          : props.audioInputMode === 'simulator'
            ? html`
                <div class="sim-banner">
                  <strong>Demo Stage Simulator Active:</strong> Simulates 4 console inputs
                  (<code>Ch 1 Lead Vox</code> singing with vibrato,
                  <code>Ch 2 Stage Vox 2</code> driving 2.48 kHz feedback,
                  <code>Ch 3 Acoustic Gtr</code> 630 Hz ring + bleed,
                  <code>Ch 4 Spare Mic</code> muted wedge bleed). Switch Sim Rig to
                  <em>6. Live Show Feedback Ring</em> to test culprit attribution!
                </div>
              `
            : nothing}

        <!-- 2. Audio Device & Named Patch Preset Controls -->
        <div class="prop-grid" style="margin-top:4px;">
          <div class="prop-field">
            <label for="wsm-mixer-watch-device">Mixer Audio Interface</label>
            <select
              id="wsm-mixer-watch-device"
              name="mixer-watch-device"
              data-testid="select-mixer-watch-device"
              ?disabled=${props.audioInputMode === 'simulator'}
              .value=${deviceSelectValue}
              @change=${(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                if (val === 'follow-main') {
                  props.onSelectMixerDevice(
                    'follow-main',
                    props.mainDeviceId,
                    props.mainDeviceLabel
                  );
                } else if (val.startsWith('sep:')) {
                  const id = val.slice(4);
                  const dev = props.audioDevices.find((d) => d.deviceId === id);
                  props.onSelectMixerDevice(
                    'separate-device',
                    id,
                    dev?.label ?? config.separateDeviceLabel
                  );
                }
              }}
            >
              <option value="follow-main" ?selected=${deviceSelectValue === 'follow-main'}>
                Same as Main Input
                ${props.mainDeviceLabel ? `(${props.mainDeviceLabel})` : ''}
              </option>
              ${props.audioDevices
                .filter((d) => d.deviceId !== props.mainDeviceId)
                .map(
                  (dev) => html`
                    <option
                      value="sep:${dev.deviceId}"
                      ?selected=${deviceSelectValue === `sep:${dev.deviceId}`}
                    >
                      Separate USB Mixer: ${dev.label}
                    </option>
                  `
                )}
            </select>
          </div>

          <div class="prop-field">
            <label for="wsm-mixer-watch-preset">Saved Input Patch Preset</label>
            <div style="display:flex;gap:4px;">
              <select
                id="wsm-mixer-watch-preset"
                name="mixer-watch-preset"
                data-testid="select-mixer-watch-preset"
                style="flex:1;min-width:0;"
                .value=${config.activeProfileId ?? ''}
                @change=${(e: Event) => {
                  const id = (e.target as HTMLSelectElement).value || null;
                  props.onSelectPreset(id);
                }}
              >
                <option value="" ?selected=${!config.activeProfileId}>
                  Custom / Unsaved Patch
                </option>
                ${library.profiles.map(
                  (prof) => html`
                    <option
                      value=${prof.id}
                      ?selected=${prof.id === config.activeProfileId}
                    >
                      ${prof.name}${affinityProfile?.id === prof.id
                        ? ' ★ Device Default'
                        : prof.lastDeviceLabel
                          ? ` (${prof.lastDeviceLabel})`
                          : ''}
                    </option>
                  `
                )}
              </select>
              ${activeProfile
                ? html`
                    <button
                      type="button"
                      title="Save current channel names & settings back into '${activeProfile.name}'"
                      @click=${props.onUpdateActivePreset}
                    >
                      Update
                    </button>
                    <button
                      type="button"
                      style="color:#f43f5e;"
                      title="Delete preset '${activeProfile.name}'"
                      @click=${props.onDeleteActivePreset}
                    >
                      ×
                    </button>
                  `
                : nothing}
            </div>
          </div>

          <!-- Save New Patch Preset Form -->
          <div class="prop-field full-width">
            <form
              class="mixer-preset-save-form"
              aria-label="Save New Mixer Input Patch Preset"
              @submit=${(e: Event) => {
                e.preventDefault();
                const trimmed = props.draftPresetName.trim();
                if (trimmed) {
                  props.onSaveNewPreset(trimmed);
                }
              }}
            >
              <label for="wsm-mixer-preset-name" class="label-muted" style="white-space:nowrap;">
                Save Patch As:
              </label>
              <input
                type="text"
                id="wsm-mixer-preset-name"
                name="mixer-preset-name"
                data-testid="input-mixer-preset-name"
                placeholder="e.g. Festival Headliner Vox, Sunday Lavs…"
                maxlength="48"
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
                enterkeyhint="done"
                .value=${props.draftPresetName}
                @input=${(e: Event) =>
                  props.onDraftPresetNameChange(
                    (e.target as HTMLInputElement).value
                  )}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (isImeComposingEnter(e)) return;
                    const trimmed = props.draftPresetName.trim();
                    if (trimmed) props.onSaveNewPreset(trimmed);
                  }
                }}
              />
              <button
                type="submit"
                class="btn-primary"
                data-testid="btn-save-mixer-preset"
              >
                Save Preset
              </button>
            </form>
          </div>

          <!-- 3. Console USB Tap Point, Mix Bus Reference & Sensitivity -->
          <div class="prop-field">
            <label for="wsm-mixer-tap-mode">Console USB Tap Point</label>
            <select
              id="wsm-mixer-tap-mode"
              name="mixer-tap-mode"
              data-testid="select-mixer-tap-mode"
              .value=${config.patch.tapMode}
              @change=${(e: Event) =>
                props.onUpdatePatch({
                  tapMode: (e.target as HTMLSelectElement).value as MixerTapMode,
                })}
            >
              <option value="pre-fader">Pre-Fader Direct Outs (Default)</option>
              <option value="post-fader">Post-Fader / Post-Mute Outs</option>
            </select>
          </div>

          <div class="prop-field">
            <label for="wsm-mixer-bus-ch">Console Mix / Wedge Bus Ref</label>
            <select
              id="wsm-mixer-bus-ch"
              name="mixer-bus-channel"
              data-testid="select-mixer-bus-channel"
              .value=${String(config.patch.mixBusChannel)}
              @change=${(e: Event) =>
                props.onUpdatePatch({
                  mixBusChannel: Number((e.target as HTMLSelectElement).value),
                })}
            >
              ${config.deviceMode === 'follow-main'
                ? html`
                    <option value="-2" ?selected=${config.patch.mixBusChannel === -2}>
                      Follow Global Ref (${globalRefLabel})
                    </option>
                  `
                : nothing}
              <option value="-1" ?selected=${config.patch.mixBusChannel === -1}>
                None (Direct Outs Only)
              </option>
              ${rows.map(
                (r) => html`
                  <option
                    value=${String(r.channelIndex)}
                    ?selected=${config.patch.mixBusChannel === r.channelIndex}
                  >
                    Mixer Ch ${r.channelIndex + 1} (${r.name})
                  </option>
                `
              )}
            </select>
          </div>

          <div class="prop-field full-width">
            <label for="wsm-mixer-sensitivity">Stage Input Watch Sensitivity</label>
            <select
              id="wsm-mixer-sensitivity"
              name="mixer-watch-sensitivity"
              .value=${config.sensitivity}
              @change=${(e: Event) =>
                props.onUpdateConfig({
                  sensitivity: (e.target as HTMLSelectElement)
                    .value as MixerWatchSensitivityMode,
                })}
            >
              <option value="foh-normal">
                FOH Concert Strict (Rejects vibrato vocals &amp; music)
              </option>
              <option value="monitor-sensitive">
                Soundcheck / Wedge Ring-Out (Catches early overhang rings)
              </option>
            </select>
          </div>
        </div>

        <!-- 4. Channel Patch Matrix (Ch 1..N) -->
        <div class="mixer-channel-matrix-head">
          <span class="label-muted">
            Watched Stage Inputs (${enabledCount}/${MAX_MIXER_WATCH_CHANNELS} max) — uncheck DI /
            playback channels
          </span>
          <div class="mixer-batch-btns">
            <button type="button" @click=${() => applyBatchSelection((i) => i < 4)}>
              Ch 1–4
            </button>
            <button type="button" @click=${() => applyBatchSelection((i) => i < 16)}>
              Ch 1–16
            </button>
            <button
              type="button"
              title="Enable channels currently showing audio above -58 dBFS"
              @click=${() =>
                applyBatchSelection((i) => (channelLevelsDbFs[i] ?? -120) > -58)}
            >
              Watch Active
            </button>
            <button type="button" @click=${() => applyBatchSelection(() => false)}>
              Clear
            </button>
          </div>
        </div>

        <div class="mixer-channel-grid">
          ${rows.map((row) => {
            const idx = row.channelIndex;
            const db = channelLevelsDbFs[idx] ?? -120;
            const isSignal = db > -60;
            const isHot = db > -12;
            const checkId = `wsm-mw-ch-en-${idx}`;
            const nameId = `wsm-mw-ch-name-${idx}`;
            const disableNewCheck =
              !row.enabled && enabledCount >= MAX_MIXER_WATCH_CHANNELS;

            return html`
              <div class="mixer-ch-row ${row.enabled ? 'watched' : ''}">
                <input
                  type="checkbox"
                  id=${checkId}
                  name=${checkId}
                  .checked=${row.enabled}
                  ?disabled=${disableNewCheck}
                  @change=${(e: Event) =>
                    toggleSingleChannel(idx, (e.target as HTMLInputElement).checked)}
                />
                <label for=${checkId} class="mixer-ch-num">Ch ${idx + 1}</label>
                <span
                  class="mixer-ch-led ${isHot ? 'hot' : isSignal ? 'sig' : ''}"
                  title=${isSignal ? `${db.toFixed(1)} dBFS` : 'Silent'}
                ></span>
                <label for=${nameId} class="visually-hidden">
                  Channel ${idx + 1} Label
                </label>
                <input
                  type="text"
                  id=${nameId}
                  name=${nameId}
                  class="mixer-ch-name-input"
                  maxlength="32"
                  autocorrect="off"
                  autocapitalize="none"
                  spellcheck="false"
                  enterkeyhint="done"
                  .value=${row.name}
                  @change=${(e: Event) =>
                    renameSingleChannel(idx, (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      if (isImeComposingEnter(e)) return;
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
            `;
          })}
        </div>
      </div>
    </foh-modal>
  `;
}
