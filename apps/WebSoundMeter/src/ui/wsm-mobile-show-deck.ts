// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  StoreSubscriptionController,
  fohControlsCss,
  fohPanelsCss,
  fohTokensCss,
  fohTopbarCss,
} from '@foh/ui';
import { LitElement, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '../charts/chart-panel.js';
import type { SourceStore } from '../sources/source-store.js';
import type { AudioSessionController } from './controllers/audio-session-controller.js';
import type { MixerWatchController } from './controllers/mixer-watch-controller.js';
import {
  type MobileShowTab,
  renderMobileShowWorkspace,
} from './show-mobile-view.js';
import { wsmShowAndRingLogCss } from './styles/show-cards.css.js';
import type { WorkspaceLayoutController } from './workspace-store.js';

@customElement('wsm-mobile-show-deck')
export class WsmMobileShowDeck extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    fohPanelsCss,
    fohTopbarCss,
    wsmShowAndRingLogCss,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        box-sizing: border-box;
      }

      * {
        box-sizing: border-box;
      }

      .mobile-show-shell {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        background: var(--_foh-bg-app, #060911);
      }

      .mobile-spl-hero {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 8px 8px 4px;
        padding: 10px 12px;
        background: #0b1120;
        border: 1px solid #1e293b;
        border-radius: 10px;
        flex-shrink: 0;
      }

      .mobile-spl-hero.alert-warn {
        border-color: #f59e0b;
        background: rgba(245, 158, 11, 0.11);
      }

      .mobile-spl-hero.alert-limit {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.15);
      }

      .mobile-spl-hero-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .mobile-spl-hero-reading {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .mobile-spl-hero-value {
        font-family: var(--_foh-font-mono, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 28px;
        line-height: 1.08;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #38bdf8;
        white-space: nowrap;
      }

      .mobile-spl-hero.alert-warn .mobile-spl-hero-value {
        color: #fbbf24;
      }

      .mobile-spl-hero.alert-limit .mobile-spl-hero-value {
        color: #f87171;
      }

      .mobile-spl-mic-tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: #cbd5e1;
        min-width: 0;
      }

      .mobile-spl-mic-tag > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mobile-wake-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 4px;
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid rgba(52, 211, 153, 0.35);
        color: #34d399;
        flex-shrink: 0;
      }

      .mobile-spl-hero-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        flex-shrink: 0;
      }

      .mobile-spl-weight-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-block-size: 32px;
        padding: 4px 10px;
        background: #162033;
        border: 1px solid #334155;
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 600;
        color: #e2e8f0;
        cursor: pointer;
      }

      .mobile-spl-kpi-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
        padding-top: 7px;
        border-top: 1px solid #1e293b;
        font-family: var(--_foh-font-mono, monospace);
        font-variant-numeric: tabular-nums;
      }

      .mobile-spl-kpi {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .mobile-spl-kpi span {
        font-family: var(--_foh-font-sans, sans-serif);
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        color: #94a3b8;
      }

      .mobile-spl-kpi strong {
        font-size: 12px;
        color: #f8fafc;
        white-space: nowrap;
      }

      .mobile-ring-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 2px 8px 4px;
        padding: 6px 8px;
        border-radius: 8px;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid #f59e0b;
        flex-shrink: 0;
      }

      .mobile-ring-banner.crit {
        background: rgba(239, 68, 68, 0.18);
        border-color: #ef4444;
      }

      .mobile-ring-banner-jump {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        padding: 2px 4px;
        border: 0;
        background: transparent;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }

      .mobile-ring-banner-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-size: 11px;
        color: #cbd5e1;
      }

      .mobile-ring-banner-text strong {
        font-size: 12.5px;
        color: #ffffff;
      }

      .mobile-show-stage {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        padding: 4px 8px 8px;
        overflow: hidden;
      }

      .mobile-show-scroll-pane {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding-bottom: 8px;
      }

      .mobile-show-scroll-pane .ring-log-list {
        max-height: none;
      }

      .mobile-show-scroll-pane > .foh-form-section {
        margin-bottom: 0;
      }

      .mobile-show-tablist {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        background: #0b1120;
        border-top: 1px solid #1e293b;
        padding-inline: max(4px, env(safe-area-inset-left, 0px))
          max(4px, env(safe-area-inset-right, 0px));
        padding-bottom: max(4px, env(safe-area-inset-bottom, 0px));
        flex-shrink: 0;
      }

      .mobile-show-tablist > [role='tab'] {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-block-size: 46px;
        padding: 8px 4px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #94a3b8;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }

      .mobile-show-tablist > [role='tab'][aria-selected='true'] {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.08);
      }

      .mobile-show-tablist > [role='tab'][aria-selected='true']::before {
        content: '';
        position: absolute;
        inset: 0 10px auto 10px;
        border-block-start: 3px solid #38bdf8;
      }

      .mobile-tab-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 18px;
        padding: 0 5px;
        border-radius: 999px;
        font-family: var(--_foh-font-mono, monospace);
        font-size: 10.5px;
        background: #1e293b;
        color: #cbd5e1;
      }

      .mobile-tab-count.active-ring {
        background: #ef4444;
        color: #ffffff;
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

  @state()
  private activeTab: MobileShowTab = 'rta';

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

    const allSources = this.sources.getAllSources();
    const chartSources = allSources.filter(
      (s) => s.kind !== 'stored' && s.kind !== 'union'
    );
    const activeEq = this.sources.getActiveEq();
    const activeLiveId = this.sources.getActiveLiveSourceId();
    const activeLiveSource = this.sources.getLiveSource(activeLiveId);
    const liveSlots = this.audio.engine?.getLiveSlots() ?? [];
    const activeLiveSlot = this.audio.engine?.getLiveSlot(activeLiveId) ?? liveSlots[0];

    return renderMobileShowWorkspace({
      activeTab: this.activeTab,
      audioInputMode: this.workspace.audioInputMode,
      availableChannels: this.audio.availableChannels,
      globalReferenceChannel: this.audio.globalReferenceChannel,
      splWeighting: this.workspace.splWeighting,
      splTime: this.workspace.splTime,
      levels: activeLiveSource?.levels,
      activeSlotName: activeLiveSlot?.name ?? 'Live Measurement',
      activeSlotColor: activeLiveSlot?.color ?? '#38bdf8',
      wakeLockActive: this.audio.wakeLockActive,
      popoverRoot: this.renderRoot,
      selectedSourceId: activeLiveId,
      liveSlots,
      liveSources: this.sources.getLiveSources(),
      feedbackRingLog: this.sources.getFeedbackRingLog(),
      splAlertThresholds: this.workspace.splAlertThresholds,
      mixerWatchEnabled: this.mixerWatch.config.enabled,
      mixerWatchChannelCount: this.mixerWatch.enabledChannelCount,
      chartSources,
      extraFeedbackTracks: this.sources.getMixerOnlyFeedbackTracks(),
      eqBands: activeEq ? activeEq.bands : null,
      onSelectTab: (tab) => {
        this.activeTab = tab;
      },
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
      onSplWeightingChange: (curve) => {
        this.workspace?.setSplWeighting(curve);
        this.audio?.persistState('replace');
      },
      onSplTimeChange: (time) => {
        this.workspace?.setSplTime(time);
        this.audio?.persistState('replace');
      },
      onSplWindowChange: (windowSec) => this.audio?.setSplHistoryWindow(windowSec),
      onEqBandDrag: (e) => {
        const { bandIndex, frequency, gainDb, q } = e.detail;
        this.sources?.dragActiveEqBand(bandIndex, frequency, gainDb, q);
      },
      onEqBandDragEnd: () => this.sources?.endEqBandDrag(),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wsm-mobile-show-deck': WsmMobileShowDeck;
  }
}
