// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  StoreSubscriptionController,
  fohControlsCss,
  fohPanelsCss,
  fohPopoverCss,
  fohTokensCss,
} from '@foh/ui';
import { LitElement, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SourceStore } from '../sources/source-store.js';
import type { AudioSessionController } from './controllers/audio-session-controller.js';
import type { MixerWatchController } from './controllers/mixer-watch-controller.js';
import { renderShowSidebar } from './show-sidebar-view.js';
import { wsmShowAndRingLogCss } from './styles/show-cards.css.js';
import type { WorkspaceLayoutController } from './workspace-store.js';

@customElement('wsm-show-sidebar')
export class WsmShowSidebar extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    fohPanelsCss,
    fohPopoverCss,
    wsmShowAndRingLogCss,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        min-height: 0;
        box-sizing: border-box;
      }

      * {
        box-sizing: border-box;
      }

      .sidebar.show-sidebar {
        width: 340px;
        flex: 1;
        min-height: 0;
        background: var(--_foh-bg-header, #0f172a);
        border-left: 1px solid var(--_foh-border-subtle, #1e293b);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 10px;
      }

      /* Tablet Portrait (680px - 959px): Full-Width Charts Over 2-Column Show Control Deck */
      @media (max-width: 959px) and (min-width: 680px) {
        :host {
          width: 100%;
          height: 100%;
        }

        .sidebar.show-sidebar {
          width: 100%;
          border-left: 0;
          border-top: 1px solid var(--_foh-border-subtle, #1e293b);
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
          grid-auto-rows: min-content;
          align-items: start;
          gap: 10px;
          overflow-y: auto;
        }

        .sidebar.show-sidebar > .foh-form-section {
          margin-bottom: 0;
        }

        .sidebar.show-sidebar > .card-live-mics {
          grid-column: 1;
          grid-row: 1 / span 2;
        }

        .sidebar.show-sidebar > .card-ring-log {
          grid-column: 2;
          grid-row: 1;
        }

        .sidebar.show-sidebar > .card-show-limits {
          grid-column: 2;
          grid-row: 2;
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

  @property({ attribute: false })
  public mixerWatch: MixerWatchController | null = null;

  private readonly audioSub = new StoreSubscriptionController(this, null);
  private readonly workspaceSub = new StoreSubscriptionController(this, null);
  private readonly mixerSub = new StoreSubscriptionController(this, null);
  private readonly sourcesSub = new StoreSubscriptionController(this, null);

  protected willUpdate(): void {
    this.audioSub.setSource(this.audio);
    this.workspaceSub.setSource(this.workspace);
    this.mixerSub.setSource(this.mixerWatch);
    this.sourcesSub.setSource(this.sources);
  }

  protected render() {
    if (!this.audio || !this.workspace || !this.sources || !this.mixerWatch) {
      return nothing;
    }

    return renderShowSidebar({
      audioInputMode: this.workspace.audioInputMode,
      availableChannels: this.audio.availableChannels,
      globalReferenceChannel: this.audio.globalReferenceChannel,
      splWeighting: this.workspace.splWeighting,
      popoverRoot: this.renderRoot,
      selectedSourceId: this.sources.getActiveLiveSourceId(),
      liveSlots: this.audio.engine?.getLiveSlots() ?? [],
      liveSources: this.sources.getLiveSources(),
      feedbackRingLog: this.sources.getFeedbackRingLog(),
      splAlertThresholds: this.workspace.splAlertThresholds,
      mixerWatchEnabled: this.mixerWatch.config.enabled,
      mixerWatchChannelCount: this.mixerWatch.enabledChannelCount,
      onOpenMixerWatch: () => this.mixerWatch?.openModal(),
      onAddLiveSource: this.audio.addLiveSlot,
      onSelectSlot: (slotId) => {
        this.sources?.setSelectedSourceId(slotId);
        this.audio?.persistState('replace');
      },
      onDeleteSlot: (slotId) => this.audio?.removeLiveSlot(slotId),
      onToggleSlotVisibility: (id, vis) => this.audio?.toggleSourceVisibility(id, vis),
      onUpdateSlotMeta: (slotId, partial) =>
        this.audio?.updateLiveSlotMeta(slotId, partial),
      onUpdateSlotConfig: (slotId, partial) =>
        this.audio?.updateMeasurementConfig(partial, slotId),
      onSlotFeedbackModeChange: (slotId, mode) =>
        this.audio?.updateMeasurementConfig({ feedbackMode: mode }, slotId),
      onApplyFeedbackNotch: (track) => {
        this.sources?.applyFeedbackNotchToEq(track);
        this.audio?.persistState('none');
      },
      onClearFeedbackRingLog: () => this.sources?.clearFeedbackRingLog(),
      onUpdateSplThresholds: (partial) => {
        this.workspace?.updateSplThresholds(partial);
        this.audio?.persistState('none');
      },
      onResetShowLog: () => this.audio?.resetShowLog(),
      onExportSplCsv: () => this.audio?.exportSplCsv(),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wsm-show-sidebar': WsmShowSidebar;
  }
}
