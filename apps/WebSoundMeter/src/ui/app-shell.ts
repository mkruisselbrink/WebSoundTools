// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Main Application Shell (`<web-sound-meter-app>` Lit 3 Web Component), composing
 * `AudioSessionController`, `MixerWatchController`, `WorkspaceLayoutController`,
 * `SourceStore`, and coarse-grained region custom elements.
 */

import {
  observeServiceWorkerUpdate,
  observeWindowControlsOverlay,
} from '@foh/pwa/client';
import '@foh/ui';
import {
  ShellWindowController,
  StoreSubscriptionController,
  hasOpenPopover,
} from '@foh/ui';
import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '../charts/chart-panel.js';
import type { PlotType } from '../charts/plot-types.js';
import type { SplHistoryWindowSec } from '../dsp/spl-history.js';
import { SourceStore } from '../sources/source-store.js';
import { loadWorkspaceSession } from '../sources/workspace-session.js';
import { appShellStyles } from './app-shell-styles.js';
import { AudioSessionController } from './controllers/audio-session-controller.js';
import { MixerWatchController } from './controllers/mixer-watch-controller.js';
import {
  WSM_HELP_ATTRIBUTION,
  WSM_HELP_RESOURCES,
  WSM_HELP_SHORTCUTS,
  WSM_HELP_SUMMARY,
} from './help-content.js';
import { dispatchAppKeydown } from './keyboard-shortcuts.js';
import './topbar/wsm-topbar.js';
import {
  type UrlViewState,
  type WorkspaceMode,
  parseUrlViewState,
  syncBrowserUrlState,
} from './url-state.js';
import { type LayoutPreset, WorkspaceLayoutController } from './workspace-store.js';
import './wsm-mixer-watch-modal.js';
import './wsm-mobile-show-deck.js';
import './wsm-show-sidebar.js';
import './wsm-tuning-sidebar.js';
import type { WsmTuningSidebar } from './wsm-tuning-sidebar.js';

export type { LayoutPreset };

@customElement('web-sound-meter-app')
export class WebSoundMeterApp extends LitElement {
  static styles = appShellStyles;

  public readonly sourceStore = new SourceStore();
  public readonly workspace = new WorkspaceLayoutController();
  public readonly mixerWatch = new MixerWatchController((nextCfg) => {
    this.audio.syncMixerWatchToEngine(nextCfg);
  });
  public readonly audio = new AudioSessionController(
    this.workspace,
    this.sourceStore,
    this.mixerWatch
  );

  @state()
  private helpModalOpen = false;

  private readonly shellWindow = new ShellWindowController(this, {
    mediaQuery: '(max-width: 679px)',
    observeWco: (cb) => observeWindowControlsOverlay((snap) => cb(snap.visible)),
    observeSwUpdate: observeServiceWorkerUpdate,
    onFlushPersistence: () => this.audio.flushPendingPersistence(),
    onKeyDown: (e) => this.handleKeyDown(e),
    onPopState: () => this.handlePopState(),
  });

  // Subscribe shell to top-level chart/banner slices
  protected readonly audioSub = new StoreSubscriptionController(this, this.audio);
  protected readonly workspaceSub = new StoreSubscriptionController(this, this.workspace);
  protected readonly sourcesSub = new StoreSubscriptionController(this, this.sourceStore);

  connectedCallback(): void {
    super.connectedCallback();

    const session = loadWorkspaceSession();
    const searchStr = typeof window !== 'undefined' ? window.location.search : '';
    const initialUrl = this.workspace.hydrateFromSessionAndUrl(session, searchStr);

    this.mixerWatch.hydrate(session.mixerWatch);
    this.sourceStore.setSelectedSourceId(initialUrl.selectedSourceId);
    this.audio.connect(session, initialUrl.simulatorPreset);
    syncBrowserUrlState(this.getUrlViewState(), 'replace');
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.audio.disconnect();
  }

  private getUrlViewState(): UrlViewState {
    const activeSlot = this.audio.engine?.getLiveSlot(
      this.sourceStore.getActiveLiveSourceId()
    );
    return this.workspace.buildUrlViewState({
      simulatorPreset: activeSlot?.simulatorPreset ?? 'pa-room-modes',
      selectedSourceId: this.sourceStore.getSelectedSourceId(),
    });
  }

  private setWorkspaceMode(mode: WorkspaceMode): void {
    if (!this.workspace.switchWorkspaceMode(mode)) return;
    this.audio.enforceShowHardwareGeneratorInterlock();
    this.audio.syncWakeLock();
    this.audio.persistState('push');
  }

  private setLayoutPreset(preset: LayoutPreset): void {
    this.workspace.applyLayoutPreset(preset);
    this.audio.persistState('push');
  }

  private handlePopState(): void {
    const next = parseUrlViewState(window.location.search, this.getUrlViewState());
    const nextMode: WorkspaceMode = next.workspaceMode ?? 'tuning';
    this.workspace.workspaceMode = nextMode;
    this.audio.enforceShowHardwareGeneratorInterlock();
    this.audio.syncWakeLock();
    this.workspace.layoutPreset = next.layoutPreset;
    this.workspace.chartPlotTypes = next.chartPlotTypes;
    const activeId = this.sourceStore.getActiveLiveSourceId();
    const activeSlot = this.audio.engine?.getLiveSlot(activeId);
    if (activeSlot && next.simulatorPreset !== activeSlot.simulatorPreset) {
      this.audio.engine?.setSimulatorPreset(next.simulatorPreset, activeId);
    }
    this.workspace.splWeighting = next.splWeighting;
    this.workspace.splTime = next.splTime;
    this.workspace.notify();
    this.sourceStore.setSelectedSourceId(next.selectedSourceId);
    this.audio.persistState('none');
  }

  private handleKeyDown(e: KeyboardEvent): void {
    dispatchAppKeydown(e, {
      onCaptureTrace: () => {
        this.sourceStore.captureCurrentTrace();
        this.audio.persistState('replace');
      },
      onFindAndApplyDelay: () => this.audio.findAndApplyDelay(),
      onTogglePause: () => {
        void this.audio.togglePause();
      },
      onDisconnectHardware: () => this.audio.disconnectHardware('manual'),
      onAddLiveSource: this.audio.addLiveSlot,
      onAddEqSource: () => {
        if (this.workspace.workspaceMode !== 'tuning') return;
        this.sourceStore.addVirtualEqSource();
        this.audio.persistState('replace');
      },
      onAddUnionSource: () => {
        if (this.workspace.workspaceMode !== 'tuning') return;
        this.sourceStore.addUnionSource();
        this.audio.persistState('replace');
      },
      onResetAveraging: () => this.audio.resetAveraging(undefined, true),
      onSelectLayoutCount: (count) => {
        const isShow = this.workspace.workspaceMode === 'show';
        const nextPreset: LayoutPreset =
          count === 1
            ? 'single'
            : count === 2
              ? isShow
                ? 'show-dual'
                : 'tf-dual'
              : isShow
                ? 'show-triple'
                : 'pa-triple';
        this.setLayoutPreset(nextPreset);
      },
      onOpenHelp: () => {
        this.helpModalOpen = !this.helpModalOpen;
      },
      onEscape: () => {
        if (hasOpenPopover(this.renderRoot)) return;
        if (this.helpModalOpen) {
          this.helpModalOpen = false;
          return;
        }
        if (this.mixerWatch.modalOpen) {
          this.mixerWatch.closeModal();
          return;
        }
        const tuningSidebar = this.renderRoot.querySelector(
          'wsm-tuning-sidebar'
        ) as WsmTuningSidebar | null;
        if (tuningSidebar?.collapseAdvancedIfOpen()) {
          return;
        }
        this.sourceStore.setSelectedSourceId(this.sourceStore.getActiveLiveSourceId());
        this.audio.persistState('replace');
      },
      onUndo: () => {
        if (this.sourceStore.undo()) this.audio.persistState('replace');
      },
      onRedo: () => {
        if (this.sourceStore.redo()) this.audio.persistState('replace');
      },
    });
  }

  private renderStatusBanner() {
    if (this.audio.audioStatusError) {
      return html`
        <div
          class="audio-status-banner error"
          data-testid="audio-status-banner"
          data-doc-region="status-banner"
        >
          <span>${this.audio.audioStatusError}</span>
          <div class="audio-status-actions">
            <button
              type="button"
              class="foh-btn foh-btn-primary"
              @click=${() => {
                void this.audio.selectInputSource(
                  'hardware',
                  this.audio.selectedDeviceId
                );
              }}
            >
              Retry Mic
            </button>
            <button
              type="button"
              class="foh-btn"
              @click=${() => this.audio.dismissAudioError()}
            >
              Dismiss
            </button>
          </div>
        </div>
      `;
    }

    if (
      this.audio.hardwareStreamDeferred &&
      this.audio.isPaused &&
      this.workspace.audioInputMode === 'hardware'
    ) {
      return html`
        <div
          class="audio-status-banner"
          data-testid="audio-status-banner"
          data-doc-region="status-banner"
        >
          <span>
            ${this.audio.hardwareDisconnectReason === 'manual'
              ? html`Hardware audio capture is disconnected (OS mic released) — tap
                  <strong>Resume Mic</strong> or press <strong>Space</strong> to
                  reconnect.`
              : this.audio.hardwareDisconnectReason === 'auto-idle'
                ? html`Hardware audio capture was auto-released after
                    ${this.audio.autoReleaseMinutes} min paused — tap
                    <strong>Resume Mic</strong> to reconnect.`
                : html`Microphone input is paused after launch — tap
                    <strong>Resume Mic</strong> to start live capture.`}
          </span>
          <div class="audio-status-actions">
            <button
              type="button"
              class="foh-btn foh-btn-primary"
              @click=${() => {
                void this.audio.togglePause();
              }}
            >
              ▶ Resume Mic
            </button>
            <button
              type="button"
              class="foh-btn"
              @click=${() => {
                void this.audio.selectInputSource('simulator', '');
              }}
            >
              Demo Simulator
            </button>
          </div>
        </div>
      `;
    }

    return '';
  }

  render() {
    const allSources = this.sourceStore.getAllSources();
    const chartSources =
      this.workspace.workspaceMode === 'show'
        ? allSources.filter((s) => s.kind !== 'stored' && s.kind !== 'union')
        : allSources;
    const activeEq = this.sourceStore.getActiveEq();
    const isMobileShow =
      this.workspace.workspaceMode === 'show' && this.shellWindow.mediaMatches;
    const extraFeedbackTracks = this.sourceStore.getMixerOnlyFeedbackTracks();

    return html`
      <wsm-topbar
        .audio=${this.audio}
        .workspace=${this.workspace}
        .sources=${this.sourceStore}
        .isMobileShow=${isMobileShow}
        .wcoVisible=${this.shellWindow.wcoVisible}
        .updateReady=${this.shellWindow.swUpdateReady}
        .onWorkspaceModeChange=${(mode: WorkspaceMode) => this.setWorkspaceMode(mode)}
        .onLayoutPresetChange=${(preset: LayoutPreset) => this.setLayoutPreset(preset)}
        .onOpenHelp=${() => {
          this.helpModalOpen = true;
        }}
      ></wsm-topbar>

      ${this.renderStatusBanner()}

      ${isMobileShow
        ? html`
            <wsm-mobile-show-deck
              .audio=${this.audio}
              .workspace=${this.workspace}
              .sources=${this.sourceStore}
              .mixerWatch=${this.mixerWatch}
            ></wsm-mobile-show-deck>
          `
        : html`
            <div class="workspace" data-mode=${this.workspace.workspaceMode}>
              <main class="charts-column" data-doc-region="charts-column">
                ${this.workspace.chartPlotTypes.map(
                  (pt, idx) => html`
                    <chart-panel
                      data-testid="chart-panel-${idx}"
                      data-doc-region="chart-${idx}"
                      .plotType=${pt}
                      .sources=${chartSources}
                      .extraFeedbackTracks=${extraFeedbackTracks}
                      .eqBands=${activeEq ? activeEq.bands : null}
                      .splAlertThresholds=${this.workspace.splAlertThresholds}
                      @plot-type-change=${(e: CustomEvent<{ plotType: PlotType }>) => {
                        this.workspace.updateChartPlotTypeAt(idx, e.detail.plotType);
                        this.audio.persistState('replace');
                      }}
                      @spl-window-change=${(
                        e: CustomEvent<{ windowSec: SplHistoryWindowSec }>
                      ) => {
                        this.audio.setSplHistoryWindow(e.detail.windowSec);
                      }}
                      @eq-band-drag=${(
                        e: CustomEvent<{
                          bandIndex: number;
                          frequency: number;
                          gainDb: number;
                          q?: number;
                        }>
                      ) => {
                        const { bandIndex, frequency, gainDb, q } = e.detail;
                        this.sourceStore.dragActiveEqBand(
                          bandIndex,
                          frequency,
                          gainDb,
                          q
                        );
                      }}
                      @eq-band-drag-end=${() => this.sourceStore.endEqBandDrag()}
                    ></chart-panel>
                  `
                )}
              </main>

              ${this.workspace.workspaceMode === 'show'
                ? html`
                    <wsm-show-sidebar
                      .audio=${this.audio}
                      .workspace=${this.workspace}
                      .sources=${this.sourceStore}
                      .mixerWatch=${this.mixerWatch}
                    ></wsm-show-sidebar>
                  `
                : html`
                    <wsm-tuning-sidebar
                      .audio=${this.audio}
                      .workspace=${this.workspace}
                      .sources=${this.sourceStore}
                      .mixerWatch=${this.mixerWatch}
                    ></wsm-tuning-sidebar>
                  `}
            </div>
          `}

      <wsm-mixer-watch-modal
        .audio=${this.audio}
        .workspace=${this.workspace}
        .sources=${this.sourceStore}
        .mixerWatch=${this.mixerWatch}
      ></wsm-mixer-watch-modal>

      <foh-help-modal
        .open=${this.helpModalOpen}
        .updateReady=${this.shellWindow.swUpdateReady}
        appName="WebSoundMeter"
        .appSummary=${WSM_HELP_SUMMARY}
        .resources=${WSM_HELP_RESOURCES}
        .shortcuts=${WSM_HELP_SHORTCUTS}
        .attribution=${WSM_HELP_ATTRIBUTION}
        dialogTestId="help-modal"
        @apply-app-update=${() => this.shellWindow.applyServiceWorkerUpdate()}
        @close-modal=${() => {
          this.helpModalOpen = false;
        }}
      ></foh-help-modal>
    `;
  }
}
