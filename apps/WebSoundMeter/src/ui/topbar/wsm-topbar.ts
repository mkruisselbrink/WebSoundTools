// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  StoreSubscriptionController,
  fohControlsCss,
  fohTokensCss,
  fohTopbarCss,
} from '@foh/ui';
import { LitElement, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GeneratorSignalType } from '../../dsp/signal-generator.js';
import type { SourceStore } from '../../sources/source-store.js';
import type { AudioSessionController } from '../controllers/audio-session-controller.js';
import type { WorkspaceMode } from '../url-state.js';
import type { LayoutPreset, WorkspaceLayoutController } from '../workspace-store.js';
import { renderTopbar } from './topbar-view.js';

@customElement('wsm-topbar')
export class WsmTopbar extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    fohTopbarCss,
    css`
      :host {
        display: block;
        width: 100%;
        flex-shrink: 0;
        box-sizing: border-box;
      }

      * {
        box-sizing: border-box;
      }

      .wsm-pause-pill {
        inline-size: 66px;
      }

      .wsm-pause-pill[aria-pressed='true'] {
        inline-size: auto;
        min-inline-size: 74px;
        padding-inline: 8px;
      }

      .wsm-stop-btn {
        padding: 0 6px;
        min-inline-size: 26px;
      }

      .wsm-popover-full-btn {
        inline-size: 100%;
        justify-content: center;
        margin-top: 2px;
      }

      .wsm-io-pill {
        max-inline-size: 196px;
      }

      .wsm-gen-toggle-btn {
        inline-size: 68px;
      }

      .spl-show-inline {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }

      @container topbar (max-width: 1259px) {
        .wsm-io-pill {
          max-inline-size: 136px;
        }
      }

      @container topbar (max-width: 1099px) {
        .wsm-pause-pill:not([aria-pressed='true']) {
          inline-size: 30px;
        }
      }

      @container topbar (max-width: 939px) {
        .wsm-io-pill {
          max-inline-size: 102px;
        }
        .wsm-transport-split + .wsm-io-pill {
          max-inline-size: 84px;
        }
        .wsm-stop-btn {
          padding: 0 5px;
          min-inline-size: 24px;
        }
        .wsm-gen-toggle-btn {
          inline-size: 52px;
        }
        .spl-show-inline {
          gap: 4px;
        }
      }

      @container topbar (max-width: 779px) {
        .wsm-io-pill {
          max-inline-size: 88px;
        }
        .wsm-transport-split + .wsm-io-pill {
          max-inline-size: 66px;
        }
      }

      @media (pointer: coarse) {
        .wsm-pause-pill {
          inline-size: 70px;
        }

        @container topbar (max-width: 1099px) {
          .wsm-pause-pill:not([aria-pressed='true']) {
            inline-size: 34px;
          }
        }
      }
    `,
  ];

  @property({ attribute: false })
  public audio: AudioSessionController | null = null;

  @property({ attribute: false })
  public workspace: WorkspaceLayoutController | null = null;

  @property({ attribute: false })
  public sources: SourceStore | null = null;

  @property({ type: Boolean })
  public isMobileShow = false;

  @property({ type: Boolean })
  public wcoVisible = false;

  @property({ attribute: false })
  public onWorkspaceModeChange?: (mode: WorkspaceMode) => void;

  @property({ attribute: false })
  public onLayoutPresetChange?: (preset: LayoutPreset) => void;

  @property({ attribute: false })
  public onOpenHelp?: () => void;

  private readonly audioSub = new StoreSubscriptionController(this, null);
  private readonly workspaceSub = new StoreSubscriptionController(this, null);
  private readonly sourcesSub = new StoreSubscriptionController(this, null);

  protected willUpdate(): void {
    this.audioSub.setSource(this.audio);
    this.workspaceSub.setSource(this.workspace);
    this.sourcesSub.setSource(this.sources);
  }

  protected render() {
    if (!this.audio || !this.workspace || !this.sources) return nothing;
    const activeLiveId = this.sources.getActiveLiveSourceId();
    const activeLiveSource = this.sources.getLiveSource(activeLiveId);

    return renderTopbar({
      workspaceMode: this.workspace.workspaceMode,
      layoutPreset: this.workspace.layoutPreset,
      isMobileShow: this.isMobileShow,
      wcoVisible: this.wcoVisible,
      canUndo: this.sources.canUndo,
      canRedo: this.sources.canRedo,
      popoverRoot: this.renderRoot,
      audioInputMode: this.workspace.audioInputMode,
      audioDevices: this.audio.audioDevices,
      selectedDeviceId: this.audio.selectedDeviceId,
      selectedDeviceLabel: this.audio.selectedDeviceLabel,
      availableChannels: this.audio.availableChannels,
      availableOutputChannels: this.audio.availableOutputChannels,
      globalReferenceChannel: this.audio.globalReferenceChannel,
      generatorOutputChannel: this.audio.generatorOutputChannel,
      genConfig: this.audio.genConfig,
      isPaused: this.audio.isPaused,
      isHardwareDisconnected: this.audio.isHardwareDisconnected,
      autoReleaseMinutes: this.audio.autoReleaseMinutes,
      splWeighting: this.workspace.splWeighting,
      splTime: this.workspace.splTime,
      levels: activeLiveSource?.levels,
      splAlertThresholds: this.workspace.splAlertThresholds,
      onWorkspaceModeChange: (mode) => this.onWorkspaceModeChange?.(mode),
      onLayoutPresetChange: (preset) => this.onLayoutPresetChange?.(preset),
      onUndo: () => {
        if (this.sources?.undo()) this.audio?.persistState('replace');
      },
      onRedo: () => {
        if (this.sources?.redo()) this.audio?.persistState('replace');
      },
      onInputSourceSelect: this.audio.selectInputSource,
      onGlobalReferenceChannelChange: (refCh) =>
        this.audio?.setGlobalReferenceChannel(refCh),
      onGeneratorOutputChannelChange: (outCh) =>
        this.audio?.setGeneratorOutputChannel(outCh),
      onToggleGenerator: () =>
        this.audio?.updateGenerator({ enabled: !this.audio.genConfig.enabled }),
      onGeneratorTypeChange: (type: GeneratorSignalType) =>
        this.audio?.updateGenerator({ type }),
      onGeneratorLevelChange: (levelDbFs: number) =>
        this.audio?.updateGenerator({ levelDbFs }),
      onTogglePause: () => {
        void this.audio?.togglePause();
      },
      onDisconnectHardware: () => this.audio?.disconnectHardware('manual'),
      onAutoReleaseMinutesChange: (mins) => this.audio?.setAutoReleaseMinutes(mins),
      onSplWeightingChange: (curve) => {
        this.workspace?.setSplWeighting(curve);
        this.audio?.persistState('replace');
      },
      onSplTimeChange: (time) => {
        this.workspace?.setSplTime(time);
        this.audio?.persistState('replace');
      },
      onOpenHelp: () => this.onOpenHelp?.(),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wsm-topbar': WsmTopbar;
  }
}
