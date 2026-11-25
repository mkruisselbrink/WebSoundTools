// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  StoreSubscriptionController,
  fohControlsCss,
  fohPanelsCss,
  fohTokensCss,
} from '@foh/ui';
import { LitElement, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SourceStore } from '../sources/source-store.js';
import type { AudioSessionController } from './controllers/audio-session-controller.js';
import type { MixerWatchController } from './controllers/mixer-watch-controller.js';
import { renderMixerWatchModal } from './mixer-watch-modal.js';
import type { WorkspaceLayoutController } from './workspace-store.js';

@customElement('wsm-mixer-watch-modal')
export class WsmMixerWatchModal extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    fohPanelsCss,
    css`
      :host {
        display: contents;
      }

      * {
        box-sizing: border-box;
      }

      .label-muted {
        color: #94a3b8;
        font-size: 10px;
        text-transform: uppercase;
      }

      .sim-banner {
        font-size: 10.5px;
        color: #94a3b8;
        line-height: 1.35;
        margin-top: 2px;
        padding: 4px 7px;
        background: #090d16;
        border-radius: 4px;
        border-left: 2px solid #38bdf8;
      }

      .mixer-watch-modal-content {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .mixer-watch-top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        background: #162033;
        border: 1px solid #263554;
        border-radius: 6px;
      }

      .mixer-watch-enable-group {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12.5px;
        color: #f8fafc;
      }

      .mixer-watch-status-pill {
        font-size: 10.5px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
        background: #1e293b;
        color: #94a3b8;
        font-family: var(--_foh-font-mono, monospace);
        white-space: nowrap;
      }

      .mixer-watch-status-pill.active {
        background: rgba(16, 185, 129, 0.2);
        border: 1px solid #10b981;
        color: #34d399;
      }

      .mixer-watch-notice {
        padding: 6px 8px;
        border-radius: 5px;
        background: rgba(245, 158, 11, 0.16);
        border: 1px solid #f59e0b;
        color: #fef3c7;
        font-size: 11px;
      }

      .mixer-preset-save-form {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 5px;
      }

      .mixer-preset-save-form input[type='text'] {
        flex: 1;
        min-width: 0;
      }

      .mixer-channel-matrix-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px;
        padding-top: 6px;
        border-top: 1px solid #1e293b;
      }

      .mixer-batch-btns {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .mixer-channel-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px 8px;
        max-height: 280px;
        overflow-y: auto;
        padding: 6px;
        background: #080d18;
        border: 1px solid #1e293b;
        border-radius: 6px;
      }

      @media (max-width: 560px) {
        .mixer-channel-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .mixer-ch-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 4px;
        background: #0f172a;
        border: 1px solid #1e293b;
        min-width: 0;
      }

      .mixer-ch-row.watched {
        border-color: rgba(16, 185, 129, 0.5);
        background: rgba(16, 185, 129, 0.08);
      }

      .mixer-ch-num {
        font-size: 10.5px;
        font-weight: 600;
        color: #94a3b8;
        width: 34px;
        flex-shrink: 0;
        font-family: var(--_foh-font-mono, monospace);
        cursor: pointer;
      }

      .mixer-ch-led {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #1e293b;
        border: 1px solid #334155;
        flex-shrink: 0;
      }

      .mixer-ch-led.sig {
        background: #10b981;
        border-color: #34d399;
        box-shadow: 0 0 5px rgba(16, 185, 129, 0.7);
      }

      .mixer-ch-led.hot {
        background: #f59e0b;
        border-color: #fbbf24;
        box-shadow: 0 0 6px rgba(245, 158, 11, 0.8);
      }

      .mixer-ch-name-input {
        flex: 1;
        min-width: 0;
        padding: 2px 6px;
        font-size: 11px;
      }
    `,
  ];

  @property({ attribute: false })
  public audio: AudioSessionController | null = null;

  @property({ attribute: false })
  public workspace: WorkspaceLayoutController | null = null;

  @property({ attribute: false })
  public sources: SourceStore | null = null;

  @property({ attribute: false })
  public mixerWatch: MixerWatchController | null = null;

  private readonly mixerSub = new StoreSubscriptionController(this, null);
  private readonly workspaceSub = new StoreSubscriptionController(this, null, {
    shouldProcess: () => Boolean(this.mixerWatch?.modalOpen),
  });
  private readonly audioSub = new StoreSubscriptionController(this, null, {
    shouldProcess: () => Boolean(this.mixerWatch?.modalOpen),
  });
  private readonly sourcesSub = new StoreSubscriptionController(this, null, {
    // Only refresh live dBFS LEDs at 25 Hz while the modal is actually open!
    shouldProcess: () => Boolean(this.mixerWatch?.modalOpen),
  });

  protected willUpdate(): void {
    this.mixerSub.setSource(this.mixerWatch);
    this.workspaceSub.setSource(this.workspace);
    this.audioSub.setSource(this.audio);
    this.sourcesSub.setSource(this.sources);
  }

  protected render() {
    if (!this.audio || !this.workspace || !this.mixerWatch) {
      return nothing;
    }

    return renderMixerWatchModal({
      open: this.mixerWatch.modalOpen,
      audioInputMode: this.workspace.audioInputMode,
      mainDeviceId: this.audio.selectedDeviceId,
      mainDeviceLabel: this.audio.selectedDeviceLabel,
      audioDevices: this.audio.audioDevices,
      availableMixerChannels: this.audio.engine?.getMixerWatchAvailableChannels() ?? 16,
      mixerSampleRate: this.audio.engine?.getMixerWatchSampleRate() ?? 48000,
      globalReferenceChannel: this.audio.globalReferenceChannel,
      config: this.mixerWatch.config,
      library: this.mixerWatch.library,
      channelLevelsDbFs: this.audio.mixerChannelLevelsDbFs,
      statusNotice: this.audio.engine?.getMixerWatchStatusNotice() ?? '',
      draftPresetName: this.mixerWatch.draftPresetName,
      onClose: () => this.mixerWatch?.closeModal(),
      onDraftPresetNameChange: (name) => this.mixerWatch?.setDraftPresetName(name),
      onSaveNewPreset: (name) => {
        if (!this.audio || !this.mixerWatch) return;
        this.mixerWatch.saveNewPreset(name, this.audio.getEffectiveMixerDeviceIdentity());
      },
      onUpdateActivePreset: () => {
        if (!this.audio || !this.mixerWatch) return;
        this.mixerWatch.updateActivePreset(this.audio.getEffectiveMixerDeviceIdentity());
      },
      onDeleteActivePreset: () => this.mixerWatch?.deleteActivePreset(),
      onSelectPreset: (profileId) => {
        if (!this.audio || !this.mixerWatch) return;
        this.mixerWatch.selectPreset(
          profileId,
          this.audio.getEffectiveMixerDeviceIdentity()
        );
      },
      onSelectMixerDevice: (mode, deviceId, deviceLabel) =>
        this.mixerWatch?.selectMixerDevice(mode, deviceId, deviceLabel),
      onUpdateConfig: (partial) => this.mixerWatch?.updateConfig(partial),
      onUpdatePatch: (partial) => this.mixerWatch?.updatePatch(partial),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wsm-mixer-watch-modal': WsmMixerWatchModal;
  }
}
