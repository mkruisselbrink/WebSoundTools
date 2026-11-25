// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Main Application Shell (`<web-sound-meter-app>` Lit 3 Web Component).
 */

import { observeWindowControlsOverlay } from '@foh/pwa/client';
import '@foh/ui';
import { hasOpenPopover } from '@foh/ui';
import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  AudioDeviceOption,
  AudioEngine,
  LiveMeasurementSlotConfig,
} from '../audio/audio-engine.js';
import '../charts/chart-panel.js';
import { PlotType } from '../charts/plot-types.js';
import { MeasurementPipelineConfig } from '../dsp/analyzer-pipeline.js';
import type { InputSourceMode } from '../dsp/dsp-worker-protocol.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import { SplHistoryWindowSec } from '../dsp/spl-history.js';
import { CalibrationManager } from '../sources/calibration-manager.js';
import {
  type MixerPatchLibraryState,
  type MixerWatchSessionConfig,
  bindProfileToDevice,
  createDefaultMixerWatchSessionConfig,
  deleteMixerPatchProfile,
  findAffinityProfileForDevice,
  hydrateMixerPatchData,
  loadMixerPatchLibrary,
  saveMixerPatchLibrary,
  upsertMixerPatchProfile,
} from '../sources/mixer-patch-storage.js';
import {
  clearSplShowCheckpointsFromDb,
  loadAllSplShowCheckpointsFromDb,
  saveSplShowCheckpointsToDb,
} from '../sources/session-storage.js';
import { SourceData, exportSourceDataToFrd } from '../sources/source-data.js';
import { SourceStore, isLiveSourceId } from '../sources/source-store.js';
import {
  DEFAULT_AUTO_RELEASE_MINUTES,
  loadWorkspaceSession,
} from '../sources/workspace-session.js';
import { appShellStyles } from './app-shell-styles.js';
import {
  WSM_HELP_ATTRIBUTION,
  WSM_HELP_RESOURCES,
  WSM_HELP_SHORTCUTS,
  WSM_HELP_SUMMARY,
} from './help-content.js';
import { renderEqInspector } from './inspectors/eq-source-inspector.js';
import { renderLiveMeasurementInspector } from './inspectors/live-measurement-inspector.js';
import { renderStoredInspector } from './inspectors/stored-source-inspector.js';
import { renderUnionInspector } from './inspectors/union-source-inspector.js';
import { dispatchAppKeydown } from './keyboard-shortcuts.js';
import { renderMixerWatchModal } from './mixer-watch-modal.js';
import {
  type MobileShowTab,
  renderMobileShowWorkspace,
} from './show-mobile-view.js';
import { renderShowSidebar, type ShowSidebarViewProps } from './show-sidebar-view.js';
import { renderSidebar } from './sidebar-view.js';
import { renderTopbar } from './topbar/topbar-view.js';
import {
  UrlViewState,
  WorkspaceMode,
  parseUrlViewState,
  syncBrowserUrlState,
} from './url-state.js';
import { ScreenWakeLockController } from './wake-lock.js';
import {
  LayoutPreset,
  WorkspaceLayoutController,
  downloadTextFile,
} from './workspace-store.js';

export type { LayoutPreset };

@customElement('web-sound-meter-app')
export class WebSoundMeterApp extends LitElement {
  static styles = appShellStyles;

  private engine: AudioEngine | null = null;
  private readonly sourceStore = new SourceStore();
  private readonly workspace = new WorkspaceLayoutController();
  private readonly calibrationMgr = new CalibrationManager();
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeWco: (() => void) | null = null;
  private phoneMediaQuery: MediaQueryList | null = null;
  private readonly wakeLock = new ScreenWakeLockController({
    onChange: (active) => {
      this.wakeLockActive = active;
    },
  });
  private hardwareStreamDeferred = false;
  private hardwareDisconnectReason: 'launch' | 'manual' | 'auto-idle' = 'launch';
  private pauseAutoReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  @state()
  private autoReleaseMinutes = DEFAULT_AUTO_RELEASE_MINUTES;

  @state()
  private wcoVisible = false;

  @state()
  private isPhoneViewport = false;

  @state()
  private mobileShowTab: MobileShowTab = 'rta';

  @state()
  private wakeLockActive = false;

  @state()
  private audioDevices: AudioDeviceOption[] = [];

  @state()
  private selectedDeviceId = '';

  @state()
  private selectedDeviceLabel = '';

  @state()
  private availableChannels = 2;

  @state()
  private availableOutputChannels = 2;

  @state()
  private globalReferenceChannel = 1;

  @state()
  private generatorOutputChannel = -1;

  @state()
  private showAdvancedMeasSettings = false;

  @state()
  private genConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };

  @state()
  private isPaused = false;

  @state()
  private audioStatusError = '';

  @state()
  private helpModalOpen = false;

  @state()
  private mixerWatchModalOpen = false;

  @state()
  private mixerWatchConfig: MixerWatchSessionConfig =
    createDefaultMixerWatchSessionConfig();

  @state()
  private mixerPatchLibrary: MixerPatchLibraryState = {
    version: 1,
    profiles: [],
    deviceAffinity: {},
  };

  @state()
  private draftMixerPresetName = '';

  private mixerChannelLevelsDbFs: Readonly<Record<number, number>> = {};

  private keydownHandler = (e: KeyboardEvent) => {
    dispatchAppKeydown(e, {
      onCaptureTrace: () => {
        this.sourceStore.captureCurrentTrace();
        this.persistState('replace');
      },
      onFindAndApplyDelay: () => {
        const activeId = this.sourceStore.getActiveLiveSourceId();
        this.engine?.findAndApplyDelay(activeId);
      },
      onTogglePause: () => {
        void this.handleTogglePause();
      },
      onDisconnectHardware: () => {
        this.handleDisconnectHardware('manual');
      },
      onAddLiveSource: () => this.handleAddLiveSource(),
      onAddEqSource: () => {
        if (this.workspace.workspaceMode !== 'tuning') return;
        this.sourceStore.addVirtualEqSource();
        this.persistState('replace');
      },
      onAddUnionSource: () => {
        if (this.workspace.workspaceMode !== 'tuning') return;
        this.sourceStore.addUnionSource();
        this.persistState('replace');
      },
      onResetAveraging: () => {
        const activeId = this.sourceStore.getActiveLiveSourceId();
        this.engine?.resetAveraging(activeId);
        if (this.workspace.workspaceMode !== 'show') {
          this.engine?.resetSplHistory(activeId);
        }
      },
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
        if (hasOpenPopover(this.renderRoot)) {
          return;
        }
        if (this.helpModalOpen) {
          this.helpModalOpen = false;
        } else if (this.mixerWatchModalOpen) {
          this.mixerWatchModalOpen = false;
        } else if (this.showAdvancedMeasSettings) {
          this.showAdvancedMeasSettings = false;
        } else {
          this.sourceStore.setSelectedSourceId(this.sourceStore.getActiveLiveSourceId());
          this.persistState('replace');
        }
      },
      onUndo: () => {
        if (this.sourceStore.undo()) {
          this.persistState('replace');
        }
      },
      onRedo: () => {
        if (this.sourceStore.redo()) {
          this.persistState('replace');
        }
      },
    });
  };

  private readonly phoneMediaChangeHandler = (e: MediaQueryListEvent): void => {
    this.isPhoneViewport = e.matches;
  };

  private recoveringHardwareAudio = false;

  private readonly foregroundAudioRecoveryHandler = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    void this.recoverHardwareAudioIfNeeded();
  };

  private readonly gestureAudioRecoveryHandler = (): void => {
    if (
      this.workspace.audioInputMode === 'hardware' &&
      !this.isPaused &&
      !this.hardwareStreamDeferred &&
      this.engine &&
      !this.engine.isHardwareStreamHealthy()
    ) {
      void this.recoverHardwareAudioIfNeeded();
    }
  };

  private async recoverHardwareAudioIfNeeded(): Promise<void> {
    if (
      this.recoveringHardwareAudio ||
      !this.engine ||
      this.workspace.audioInputMode !== 'hardware' ||
      this.isPaused ||
      this.hardwareStreamDeferred
    ) {
      return;
    }
    if (this.engine.isHardwareStreamHealthy()) {
      return;
    }
    this.recoveringHardwareAudio = true;
    try {
      const ok = await this.engine.recoverHardwareStreamIfInterrupted();
      if (ok) {
        this.audioStatusError = '';
      } else {
        // iOS/iPadOS Home Screen WebKit requires a fresh user tap to re-open an ended mic track
        this.clearPauseAutoReleaseTimer();
        this.isPaused = true;
        this.hardwareStreamDeferred = true;
        this.hardwareDisconnectReason = 'launch';
        this.engine.setPaused(true);
        this.syncWakeLock();
      }
    } finally {
      this.recoveringHardwareAudio = false;
    }
  }

  private syncWakeLock(): void {
    void this.wakeLock.setDesired(
      this.workspace.workspaceMode === 'show' && !this.isPaused
    );
  }

  private popstateHandler = () => {
    const next = parseUrlViewState(window.location.search, this.getUrlViewState());
    const nextMode: WorkspaceMode = next.workspaceMode ?? 'tuning';
    this.workspace.workspaceMode = nextMode;
    if (nextMode === 'show' && this.workspace.audioInputMode === 'hardware' && this.genConfig.enabled) {
      this.updateGenerator({ enabled: false });
    }
    this.syncWakeLock();
    this.workspace.layoutPreset = next.layoutPreset;
    this.workspace.chartPlotTypes = next.chartPlotTypes;
    const activeId = this.sourceStore.getActiveLiveSourceId();
    const activeSlot = this.engine?.getLiveSlot(activeId);
    if (activeSlot && next.simulatorPreset !== activeSlot.simulatorPreset) {
      this.engine?.setSimulatorPreset(next.simulatorPreset, activeId);
    }
    this.workspace.splWeighting = next.splWeighting;
    this.workspace.splTime = next.splTime;
    this.sourceStore.setSelectedSourceId(next.selectedSourceId);
    this.persistState('none');
    this.requestUpdate();
  };

  connectedCallback(): void {
    super.connectedCallback();

    const session = loadWorkspaceSession();
    const searchStr = typeof window !== 'undefined' ? window.location.search : '';
    const initialUrl = this.workspace.hydrateFromSessionAndUrl(session, searchStr);

    this.selectedDeviceId = session.hardwareRouting.selectedDeviceId;
    this.selectedDeviceLabel = session.hardwareRouting.selectedDeviceLabel;
    this.globalReferenceChannel = session.hardwareRouting.globalReferenceChannel;
    this.generatorOutputChannel = session.hardwareRouting.generatorOutputChannel;
    this.autoReleaseMinutes =
      session.hardwareRouting.autoReleaseMinutes ?? DEFAULT_AUTO_RELEASE_MINUTES;
    this.mixerPatchLibrary = loadMixerPatchLibrary();
    this.mixerWatchConfig =
      session.mixerWatch ?? createDefaultMixerWatchSessionConfig();

    const hydratedSlots = session.liveSlots.map((slot, idx) =>
      idx === 0 && initialUrl.audioInputMode === 'simulator'
        ? { ...slot, simulatorPreset: initialUrl.simulatorPreset }
        : slot
    );

    for (const slot of hydratedSlots) {
      this.sourceStore.setLiveSourceVisible(slot.visible, slot.id);
    }
    this.sourceStore.setSelectedSourceId(initialUrl.selectedSourceId);

    this.unsubscribeStore = this.sourceStore.subscribe(() => {
      this.requestUpdate();
    });

    this.engine = new AudioEngine();
    this.engine.setGlobalReferenceChannel(this.globalReferenceChannel);
    this.engine.setLiveSlots(hydratedSlots);
    void this.engine.setMixerWatchConfig(this.mixerWatchConfig);
    const safeGenConfig =
      this.workspace.workspaceMode === 'show' && this.workspace.audioInputMode === 'hardware'
        ? { ...session.genConfig, enabled: false }
        : session.genConfig;
    this.engine.updateGeneratorConfig(safeGenConfig);
    this.engine.setGeneratorOutputChannel(this.generatorOutputChannel);
    this.genConfig = { ...this.engine.getGeneratorConfig() };

    if (this.workspace.audioInputMode === 'hardware') {
      this.isPaused = true;
      this.hardwareStreamDeferred = true;
      this.hardwareDisconnectReason = 'launch';
      this.engine.setPaused(true);
    }

    void this.engine.listInputDevices().then((devices) => {
      if (devices.length > 0) {
        this.audioDevices = devices;
      }
    });

    this.engine.onLiveFrames((frames, mixerTelemetry) => {
      this.mixerChannelLevelsDbFs = mixerTelemetry?.channelLevelsDbFs ?? {};
      this.sourceStore.setLiveFrames(
        frames,
        mixerTelemetry?.mixerOnlyFeedbackTracks
      );
    });
    this.engine.onMeasurementConfigChange(() => {
      this.persistState('none');
      this.requestUpdate();
    });
    this.engine.onSplHistoryCheckpoints((checkpoints) => {
      void saveSplShowCheckpointsToDb(checkpoints);
    });
    this.engine.onSplCsvExported((csvText: string) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadTextFile(
        csvText,
        `websoundmeter-spl-log-${stamp}.csv`,
        'text/csv;charset=utf-8'
      );
    });

    void this.hydratePersistentStores();
    syncBrowserUrlState(this.getUrlViewState(), 'replace');

    this.unsubscribeWco = observeWindowControlsOverlay((snap) => {
      this.wcoVisible = snap.visible;
    });

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.phoneMediaQuery = window.matchMedia('(max-width: 679px)');
      this.isPhoneViewport = this.phoneMediaQuery.matches;
      this.phoneMediaQuery.addEventListener('change', this.phoneMediaChangeHandler);
    }
    this.syncWakeLock();

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('popstate', this.popstateHandler);
    window.addEventListener('pageshow', this.foregroundAudioRecoveryHandler);
    window.addEventListener('pointerdown', this.gestureAudioRecoveryHandler, {
      passive: true,
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.foregroundAudioRecoveryHandler);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearPauseAutoReleaseTimer();
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('popstate', this.popstateHandler);
    window.removeEventListener('pageshow', this.foregroundAudioRecoveryHandler);
    window.removeEventListener('pointerdown', this.gestureAudioRecoveryHandler);
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        this.foregroundAudioRecoveryHandler
      );
    }
    this.phoneMediaQuery?.removeEventListener('change', this.phoneMediaChangeHandler);
    this.phoneMediaQuery = null;
    this.wakeLock.dispose();
    this.unsubscribeWco?.();
    this.unsubscribeWco = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private async hydratePersistentStores(): Promise<void> {
    const [, , splCheckpoints] = await Promise.all([
      this.sourceStore.loadFromPersistence(),
      this.calibrationMgr.hydrateAndSyncEngine(this.engine),
      loadAllSplShowCheckpointsFromDb(),
    ]);
    if (this.engine && splCheckpoints.length > 0) {
      this.engine.hydrateSplHistory(splCheckpoints);
    }
    this.persistState('replace');
    this.requestUpdate();
  }

  private getUrlViewState(): UrlViewState {
    const activeSlot = this.engine?.getLiveSlot(
      this.sourceStore.getActiveLiveSourceId()
    );
    return this.workspace.buildUrlViewState({
      simulatorPreset: activeSlot?.simulatorPreset ?? 'pa-room-modes',
      selectedSourceId: this.sourceStore.getSelectedSourceId(),
    });
  }

  private persistState(urlMode: 'push' | 'replace' | 'none' = 'replace'): void {
    const activeSlot = this.engine?.getLiveSlot(
      this.sourceStore.getActiveLiveSourceId()
    );
    const currentSlots = (this.engine?.getLiveSlots() ?? []).map((s) => ({
      ...s,
      visible: this.sourceStore.getLiveSourceVisible(s.id),
    }));

    this.workspace.persist({
      urlMode,
      simulatorPreset: activeSlot?.simulatorPreset ?? 'pa-room-modes',
      selectedSourceId: this.sourceStore.getSelectedSourceId(),
      liveSlots: currentSlots,
      genConfig: this.genConfig,
      hardwareRouting: {
        selectedDeviceId: this.selectedDeviceId,
        selectedDeviceLabel: this.selectedDeviceLabel,
        globalReferenceChannel: this.globalReferenceChannel,
        generatorOutputChannel: this.generatorOutputChannel,
        autoReleaseMinutes: this.autoReleaseMinutes,
      },
      mixerWatch: this.mixerWatchConfig,
    });
  }

  private getEffectiveMixerDeviceIdentity(): {
    readonly deviceId: string;
    readonly deviceLabel: string;
  } {
    if (this.workspace.audioInputMode !== 'hardware') {
      return { deviceId: '', deviceLabel: '' };
    }
    if (
      this.mixerWatchConfig.deviceMode === 'separate-device' &&
      this.mixerWatchConfig.separateDeviceId
    ) {
      return {
        deviceId: this.mixerWatchConfig.separateDeviceId,
        deviceLabel: this.mixerWatchConfig.separateDeviceLabel,
      };
    }
    return {
      deviceId: this.selectedDeviceId,
      deviceLabel: this.selectedDeviceLabel,
    };
  }

  private applyMixerWatchUpdate(nextConfig: MixerWatchSessionConfig): void {
    this.mixerWatchConfig = nextConfig;
    if (this.engine) {
      void this.engine.setMixerWatchConfig(nextConfig).then(() => {
        if (this.engine) {
          this.mixerWatchConfig = this.engine.getMixerWatchConfig();
        }
        this.persistState('none');
        this.requestUpdate();
      });
    } else {
      this.persistState('none');
      this.requestUpdate();
    }
  }

  private maybeRecallMixerProfileForDevice(
    deviceId: string,
    deviceLabel: string
  ): void {
    const matched = findAffinityProfileForDevice(
      this.mixerPatchLibrary,
      deviceId,
      deviceLabel
    );
    if (!matched) return;
    this.applyMixerWatchUpdate({
      ...this.mixerWatchConfig,
      activeProfileId: matched.id,
      patch: hydrateMixerPatchData(matched, Math.max(16, matched.channels.length)),
    });
  }

  private setWorkspaceMode(mode: WorkspaceMode): void {
    if (!this.workspace.switchWorkspaceMode(mode)) return;
    if (
      mode === 'show' &&
      this.workspace.audioInputMode === 'hardware' &&
      this.genConfig.enabled
    ) {
      this.updateGenerator({ enabled: false });
    }
    this.syncWakeLock();
    this.persistState('push');
    this.requestUpdate();
  }

  private setLayoutPreset(preset: LayoutPreset): void {
    this.workspace.applyLayoutPreset(preset);
    this.persistState('push');
    this.requestUpdate();
  }

  private handleAddLiveSource = (): void => {
    if (!this.engine) return;
    const created = this.engine.addLiveSlot();
    this.sourceStore.setLiveSourceVisible(true, created.id);
    this.sourceStore.setSelectedSourceId(created.id);
    this.persistState('replace');
    this.requestUpdate();
  };

  private handleDeleteLiveSlot = (slotId: string): void => {
    if (!this.engine || this.engine.getLiveSlots().length <= 1) return;
    this.engine.removeLiveSlot(slotId);
    this.sourceStore.removeLiveSource(slotId);
    this.persistState('replace');
    this.requestUpdate();
  };

  private handleInputSourceSelect = async (
    mode: InputSourceMode,
    deviceId: string
  ): Promise<void> => {
    if (!this.engine) return;
    const modeChanged = this.workspace.audioInputMode !== mode;
    this.workspace.audioInputMode = mode;
    this.audioStatusError = '';
    if (mode === 'hardware') {
      if ((modeChanged || this.workspace.workspaceMode === 'show') && this.genConfig.enabled) {
        this.updateGenerator({ enabled: false });
      }
      this.selectedDeviceId = deviceId;
      const dev = this.audioDevices.find((d) => d.deviceId === deviceId);
      this.selectedDeviceLabel = dev ? dev.label : '';
    }
    this.clearPauseAutoReleaseTimer();
    this.hardwareStreamDeferred = false;
    if (this.isPaused) {
      this.isPaused = false;
      this.engine.setPaused(false);
      this.syncWakeLock();
    }
    try {
      await this.engine.setInputMode(mode, this.selectedDeviceId);
      if (mode === 'hardware') {
        this.audioDevices = await this.engine.listInputDevices();
        this.availableChannels = this.engine.getAvailableChannels();
        this.availableOutputChannels = this.engine.getAvailableOutputChannels();
        const activeDev = this.audioDevices.find(
          (d) => d.deviceId === this.selectedDeviceId
        );
        if (activeDev) {
          this.selectedDeviceLabel = activeDev.label;
        }
        if (this.mixerWatchConfig.deviceMode === 'follow-main') {
          this.maybeRecallMixerProfileForDevice(
            this.selectedDeviceId,
            this.selectedDeviceLabel
          );
        }
      }
    } catch (err) {
      this.workspace.audioInputMode = this.engine.getInputMode();
      const reason =
        err instanceof Error && err.message ? err.message : 'Microphone permission denied or unavailable.';
      this.audioStatusError = `Could not open audio input (${reason})`;
    }
    this.persistState(modeChanged ? 'push' : 'none');
    this.requestUpdate();
  };

  private handleEqBandDrag = (
    e: CustomEvent<{ bandIndex: number; frequency: number; gainDb: number; q?: number }>
  ): void => {
    const { bandIndex, frequency, gainDb, q } = e.detail;
    this.sourceStore.dragActiveEqBand(bandIndex, frequency, gainDb, q);
  };

  private handleCalibrationUpload = (slotId: string, e: Event): void => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void this.calibrationMgr.uploadFileForSlot(slotId, file, this.engine).then(() => {
      this.persistState('none');
      this.requestUpdate();
    });
  };

  private clearPauseAutoReleaseTimer(): void {
    if (this.pauseAutoReleaseTimer !== null) {
      clearTimeout(this.pauseAutoReleaseTimer);
      this.pauseAutoReleaseTimer = null;
    }
  }

  private schedulePauseAutoReleaseTimer(): void {
    this.clearPauseAutoReleaseTimer();
    if (
      this.workspace.audioInputMode === 'hardware' &&
      this.isPaused &&
      !this.hardwareStreamDeferred &&
      this.autoReleaseMinutes > 0
    ) {
      const delayMs = this.autoReleaseMinutes * 60_000;
      this.pauseAutoReleaseTimer = setTimeout(() => {
        this.pauseAutoReleaseTimer = null;
        this.handleDisconnectHardware('auto-idle');
      }, delayMs);
    }
  }

  private handleDisconnectHardware = (
    reason: 'manual' | 'auto-idle' = 'manual'
  ): void => {
    if (this.workspace.audioInputMode !== 'hardware' || !this.engine) return;
    this.clearPauseAutoReleaseTimer();
    this.engine.disconnectHardwareStreams();
    this.isPaused = true;
    this.hardwareStreamDeferred = true;
    this.hardwareDisconnectReason = reason;
    this.audioStatusError = '';
    this.syncWakeLock();
    this.requestUpdate();
  };

  private handleTogglePause = async (): Promise<void> => {
    const nextPaused = !this.isPaused;
    this.isPaused = nextPaused;
    this.engine?.setPaused(this.isPaused);
    this.syncWakeLock();

    if (nextPaused) {
      this.schedulePauseAutoReleaseTimer();
      return;
    }

    this.clearPauseAutoReleaseTimer();
    if (this.workspace.audioInputMode === 'hardware' && this.engine) {
      this.audioStatusError = '';
      if (this.hardwareStreamDeferred || !this.engine.isHardwareStreamHealthy()) {
        try {
          await this.engine.setInputMode('hardware', this.selectedDeviceId);
          this.hardwareStreamDeferred = false;
          this.audioDevices = await this.engine.listInputDevices();
          this.availableChannels = this.engine.getAvailableChannels();
          this.availableOutputChannels = this.engine.getAvailableOutputChannels();
        } catch (err) {
          this.workspace.audioInputMode = this.engine.getInputMode();
          const reason =
            err instanceof Error && err.message
              ? err.message
              : 'Microphone permission denied or unavailable.';
          this.audioStatusError = `Could not open microphone (${reason})`;
          this.persistState('replace');
        }
      }
    }
  };

  private renderSelectedSourceInspector(allSources: SourceData[]) {
    const selectedId = this.sourceStore.getSelectedSourceId();
    const activeLiveId = this.sourceStore.getActiveLiveSourceId();
    const liveSlot = this.engine!.getLiveSlot(activeLiveId);
    const activeLiveSource = this.sourceStore.getLiveSource(activeLiveId);
    const canDeleteSlot = (this.engine?.getLiveSlots().length ?? 1) > 1;

    const liveHandlers = {
      slot: liveSlot,
      delayEstimate: activeLiveSource?.delayEstimate,
      levels: activeLiveSource?.levels,
      splWeighting: this.workspace.splWeighting,
      popoverRoot: this.renderRoot,
      audioInputMode: this.workspace.audioInputMode,
      availableChannels: this.availableChannels,
      globalReferenceChannel: this.globalReferenceChannel,
      showAdvanced: this.showAdvancedMeasSettings,
      onToggleAdvanced: () => {
        this.showAdvancedMeasSettings = !this.showAdvancedMeasSettings;
      },
      canDeleteSlot,
      onUpdateSlotMeta: (
        partial: Partial<
          Pick<
            LiveMeasurementSlotConfig,
            'name' | 'simulatorPreset' | 'measurementChannel' | 'referenceChannel'
          >
        >
      ) => {
        this.engine?.updateLiveSlot(liveSlot.id, partial);
        this.persistState(partial.simulatorPreset !== undefined ? 'push' : 'none');
        this.requestUpdate();
      },
      onDeleteSlot: () => this.handleDeleteLiveSlot(liveSlot.id),
      onFindAndApplyDelay: () => this.engine?.findAndApplyDelay(liveSlot.id),
      onCaptureTrace: () => {
        this.sourceStore.captureCurrentTrace();
        this.persistState('replace');
      },
      savedCalibrations: this.calibrationMgr.getAll(),
      activeCalibrationId: liveSlot.activeCalibrationId,
      onSelectCalibration: (calId: string | null) => {
        this.calibrationMgr.selectForSlot(liveSlot.id, calId, this.engine);
        this.persistState('none');
        this.requestUpdate();
      },
      onDeleteCalibration: (calId: string) => {
        this.calibrationMgr.deleteCalibration(calId, this.engine);
        this.persistState('none');
        this.requestUpdate();
      },
      onResetAveraging: () => {
        this.engine?.resetAveraging(liveSlot.id);
        this.engine?.resetSplHistory(liveSlot.id);
      },
      onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) => {
        this.engine?.updateMeasurementConfig(partial, liveSlot.id);
        this.persistState('none');
        this.requestUpdate();
      },
      onCalibrationUpload: (e: Event) =>
        this.handleCalibrationUpload(liveSlot.id, e),
      mixerWatchEnabled: this.mixerWatchConfig.enabled,
      mixerWatchChannelCount: this.mixerWatchConfig.patch.channels.filter(
        (c) => c.enabled
      ).length,
      onOpenMixerWatch: () => {
        this.mixerWatchModalOpen = true;
      },
    };

    if (isLiveSourceId(selectedId)) {
      return renderLiveMeasurementInspector(liveSlot.config, liveHandlers);
    }

    const stored = this.sourceStore.getStoredSources().find((s) => s.id === selectedId);
    if (stored) {
      return renderStoredInspector(stored, {
        onDelete: (id) => {
          this.sourceStore.deleteStoredSource(id);
          this.persistState('replace');
        },
        onUpdateStored: (id, partial) => this.sourceStore.updateStoredSource(id, partial),
        onExportFrd: (src) => {
          const frdText = exportSourceDataToFrd(src);
          const slug =
            src.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'trace';
          downloadTextFile(frdText, `${slug}.frd`, 'text/plain;charset=utf-8');
        },
      });
    }

    const eq = this.sourceStore.getEqSources().find((s) => s.id === selectedId);
    if (eq) {
      return renderEqInspector(eq, allSources, {
        onAutoFlatten: (eqId) => this.sourceStore.autoFlattenRoomModesWithEq(eqId),
        onTargetSourceChange: (eqId, targetSourceId) =>
          this.sourceStore.setEqTargetSource(eqId, targetSourceId),
        onUpdateEqBand: (eqId, bandIdx, partial) =>
          this.sourceStore.updateEqBand(eqId, bandIdx, partial),
        onUpdateEqDsp: (eqId, patch, txKey) =>
          this.sourceStore.updateEqDsp(eqId, patch, txKey),
        onDelete: (eqId) => {
          this.sourceStore.deleteEqSource(eqId);
          this.persistState('replace');
        },
      });
    }

    const union = this.sourceStore.getUnionSources().find((s) => s.id === selectedId);
    if (union) {
      return renderUnionInspector(union, allSources, {
        onUpdateUnion: (unionId, partial) =>
          this.sourceStore.updateUnionSource(unionId, partial),
        onDelete: (unionId) => {
          this.sourceStore.deleteUnionSource(unionId);
          this.persistState('replace');
        },
      });
    }

    return renderLiveMeasurementInspector(liveSlot.config, liveHandlers);
  }

  private updateGenerator(partial: Partial<SignalGeneratorConfig>): void {
    if (!this.engine) return;
    this.engine.updateGeneratorConfig(partial);
    this.genConfig = { ...this.engine.getGeneratorConfig() };
    this.persistState('none');
  }

  render() {
    const allSources = this.sourceStore.getAllSources();
    const chartSources =
      this.workspace.workspaceMode === 'show'
        ? allSources.filter((s) => s.kind !== 'stored' && s.kind !== 'union')
        : allSources;
    const activeEq = this.sourceStore.getActiveEq();
    const activeLiveId = this.sourceStore.getActiveLiveSourceId();
    const activeLiveSource = this.sourceStore.getLiveSource(activeLiveId);
    const liveSlots = this.engine?.getLiveSlots() ?? [];
    const activeLiveSlot = this.engine?.getLiveSlot(activeLiveId) ?? liveSlots[0];
    const isMobileShow =
      this.workspace.workspaceMode === 'show' && this.isPhoneViewport;

    const extraFeedbackTracks = this.sourceStore.getMixerOnlyFeedbackTracks();
    const enabledMixerWatchCount = this.mixerWatchConfig.patch.channels.filter(
      (c) => c.enabled
    ).length;

    const showSidebarProps: ShowSidebarViewProps = {
      audioInputMode: this.workspace.audioInputMode,
      availableChannels: this.availableChannels,
      globalReferenceChannel: this.globalReferenceChannel,
      splWeighting: this.workspace.splWeighting,
      popoverRoot: this.renderRoot,
      selectedSourceId: activeLiveId,
      liveSlots,
      liveSources: this.sourceStore.getLiveSources(),
      feedbackRingLog: this.sourceStore.getFeedbackRingLog(),
      splAlertThresholds: this.workspace.splAlertThresholds,
      mixerWatchEnabled: this.mixerWatchConfig.enabled,
      mixerWatchChannelCount: enabledMixerWatchCount,
      onOpenMixerWatch: () => {
        this.mixerWatchModalOpen = true;
      },
      onAddLiveSource: this.handleAddLiveSource,
      onSelectSlot: (slotId) => {
        this.sourceStore.setSelectedSourceId(slotId);
        this.persistState('replace');
      },
      onDeleteSlot: (slotId) => this.handleDeleteLiveSlot(slotId),
      onToggleSlotVisibility: (id, vis) => {
        this.sourceStore.toggleVisibility(id, vis);
        this.engine?.updateLiveSlot(id, { visible: vis });
        this.persistState('none');
      },
      onUpdateSlotMeta: (slotId, partial) => {
        this.engine?.updateLiveSlot(slotId, partial);
        this.persistState(partial.simulatorPreset !== undefined ? 'push' : 'none');
        this.requestUpdate();
      },
      onUpdateSlotConfig: (slotId, partial) => {
        this.engine?.updateMeasurementConfig(partial, slotId);
        this.persistState('none');
        this.requestUpdate();
      },
      onSlotFeedbackModeChange: (slotId, mode) => {
        this.engine?.updateMeasurementConfig({ feedbackMode: mode }, slotId);
        this.persistState('none');
        this.requestUpdate();
      },
      onApplyFeedbackNotch: (track) => {
        this.sourceStore.applyFeedbackNotchToEq(track);
        this.persistState('none');
      },
      onClearFeedbackRingLog: () => {
        this.sourceStore.clearFeedbackRingLog();
      },
      onUpdateSplThresholds: (partial) => {
        this.workspace.splAlertThresholds = {
          ...this.workspace.splAlertThresholds,
          ...partial,
        };
        this.persistState('none');
        this.requestUpdate();
      },
      onResetShowLog: () => {
        this.engine?.resetSplHistory();
        void clearSplShowCheckpointsFromDb();
      },
      onExportSplCsv: () => {
        this.engine?.exportSplCsv();
      },
    };

    return html`
      ${renderTopbar({
        workspaceMode: this.workspace.workspaceMode,
        layoutPreset: this.workspace.layoutPreset,
        isMobileShow,
        wcoVisible: this.wcoVisible,
        canUndo: this.sourceStore.canUndo,
        canRedo: this.sourceStore.canRedo,
        popoverRoot: this.renderRoot,
        audioInputMode: this.workspace.audioInputMode,
        audioDevices: this.audioDevices,
        selectedDeviceId: this.selectedDeviceId,
        selectedDeviceLabel: this.selectedDeviceLabel,
        availableChannels: this.availableChannels,
        availableOutputChannels: this.availableOutputChannels,
        globalReferenceChannel: this.globalReferenceChannel,
        generatorOutputChannel: this.generatorOutputChannel,
        genConfig: this.genConfig,
        isPaused: this.isPaused,
        isHardwareDisconnected:
          this.workspace.audioInputMode === 'hardware' &&
          (this.hardwareStreamDeferred ||
            !(this.engine?.hasActiveHardwareCapture() ?? false)),
        autoReleaseMinutes: this.autoReleaseMinutes,
        splWeighting: this.workspace.splWeighting,
        splTime: this.workspace.splTime,
        levels: activeLiveSource?.levels,
        splAlertThresholds: this.workspace.splAlertThresholds,
        onWorkspaceModeChange: (mode) => this.setWorkspaceMode(mode),
        onLayoutPresetChange: (preset) => this.setLayoutPreset(preset),
        onUndo: () => {
          if (this.sourceStore.undo()) this.persistState('replace');
        },
        onRedo: () => {
          if (this.sourceStore.redo()) this.persistState('replace');
        },
        onInputSourceSelect: this.handleInputSourceSelect,
        onGlobalReferenceChannelChange: (refCh) => {
          this.globalReferenceChannel = refCh;
          this.engine?.setGlobalReferenceChannel(refCh);
          this.persistState('none');
          this.requestUpdate();
        },
        onGeneratorOutputChannelChange: (outCh) => {
          this.generatorOutputChannel = outCh;
          this.engine?.setGeneratorOutputChannel(outCh);
          this.persistState('none');
        },
        onToggleGenerator: () => this.updateGenerator({ enabled: !this.genConfig.enabled }),
        onGeneratorTypeChange: (type: GeneratorSignalType) => this.updateGenerator({ type }),
        onGeneratorLevelChange: (levelDbFs: number) => this.updateGenerator({ levelDbFs }),
        onTogglePause: () => {
          void this.handleTogglePause();
        },
        onDisconnectHardware: () => {
          this.handleDisconnectHardware('manual');
        },
        onAutoReleaseMinutesChange: (minutes) => {
          this.autoReleaseMinutes = minutes;
          this.schedulePauseAutoReleaseTimer();
          this.persistState('none');
          this.requestUpdate();
        },
        onSplWeightingChange: (curve) => {
          this.workspace.splWeighting = curve;
          this.persistState('replace');
          this.requestUpdate();
        },
        onSplTimeChange: (time) => {
          this.workspace.splTime = time;
          this.persistState('replace');
          this.requestUpdate();
        },
        onOpenHelp: () => {
          this.helpModalOpen = true;
        },
      })}

      ${this.audioStatusError
        ? html`
            <div class="audio-status-banner error" data-testid="audio-status-banner">
              <span>${this.audioStatusError}</span>
              <div class="audio-status-actions">
                <button
                  type="button"
                  class="btn-primary"
                  @click=${() => {
                    void this.handleInputSourceSelect('hardware', this.selectedDeviceId);
                  }}
                >
                  Retry Mic
                </button>
                <button
                  type="button"
                  @click=${() => {
                    this.audioStatusError = '';
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          `
        : this.hardwareStreamDeferred &&
            this.isPaused &&
            this.workspace.audioInputMode === 'hardware'
          ? html`
              <div class="audio-status-banner" data-testid="audio-status-banner">
                <span>
                  ${this.hardwareDisconnectReason === 'manual'
                    ? html`Hardware audio capture is disconnected (OS mic released) — tap
                        <strong>Resume Mic</strong> or press <strong>Space</strong> to
                        reconnect.`
                    : this.hardwareDisconnectReason === 'auto-idle'
                      ? html`Hardware audio capture was auto-released after
                          ${this.autoReleaseMinutes} min paused — tap
                          <strong>Resume Mic</strong> to reconnect.`
                      : html`Microphone input is paused after launch — tap
                          <strong>Resume Mic</strong> to start live capture.`}
                </span>
                <div class="audio-status-actions">
                  <button
                    type="button"
                    class="btn-primary"
                    @click=${() => {
                      void this.handleTogglePause();
                    }}
                  >
                    ▶ Resume Mic
                  </button>
                  <button
                    type="button"
                    @click=${() => {
                      void this.handleInputSourceSelect('simulator', '');
                    }}
                  >
                    Demo Simulator
                  </button>
                </div>
              </div>
            `
          : ''}

      ${isMobileShow
        ? renderMobileShowWorkspace({
            ...showSidebarProps,
            activeTab: this.mobileShowTab,
            splWeighting: this.workspace.splWeighting,
            splTime: this.workspace.splTime,
            levels: activeLiveSource?.levels,
            activeSlotName: activeLiveSlot?.name ?? 'Live Measurement',
            activeSlotColor: activeLiveSlot?.color ?? '#38bdf8',
            wakeLockActive: this.wakeLockActive,
            chartSources,
            extraFeedbackTracks,
            eqBands: activeEq ? activeEq.bands : null,
            onSelectTab: (tab) => {
              this.mobileShowTab = tab;
            },
            onSplWeightingChange: (curve) => {
              this.workspace.splWeighting = curve;
              this.persistState('replace');
              this.requestUpdate();
            },
            onSplTimeChange: (time) => {
              this.workspace.splTime = time;
              this.persistState('replace');
              this.requestUpdate();
            },
            onSplWindowChange: (windowSec) => {
              this.engine?.setSplHistoryWindow(windowSec);
            },
            onEqBandDrag: this.handleEqBandDrag,
            onEqBandDragEnd: () => this.sourceStore.endEqBandDrag(),
          })
        : html`
            <div class="workspace" data-mode=${this.workspace.workspaceMode}>
              <main class="charts-column">
                ${this.workspace.chartPlotTypes.map(
                  (pt, idx) => html`
                    <chart-panel
                      data-testid="chart-panel-${idx}"
                      .plotType=${pt}
                      .sources=${chartSources}
                      .extraFeedbackTracks=${extraFeedbackTracks}
                      .eqBands=${activeEq ? activeEq.bands : null}
                      .splAlertThresholds=${this.workspace.splAlertThresholds}
                      @plot-type-change=${(e: CustomEvent<{ plotType: PlotType }>) => {
                        this.workspace.updateChartPlotTypeAt(idx, e.detail.plotType);
                        this.persistState('replace');
                        this.requestUpdate();
                      }}
                      @spl-window-change=${(
                        e: CustomEvent<{ windowSec: SplHistoryWindowSec }>
                      ) => {
                        this.engine?.setSplHistoryWindow(e.detail.windowSec);
                      }}
                      @eq-band-drag=${this.handleEqBandDrag}
                      @eq-band-drag-end=${() => this.sourceStore.endEqBandDrag()}
                    ></chart-panel>
                  `
                )}
              </main>

              ${this.workspace.workspaceMode === 'show'
                ? renderShowSidebar(showSidebarProps)
                : renderSidebar({
                    allSources,
                    selectedSourceId: this.sourceStore.getSelectedSourceId(),
                    inspectorContent: this.renderSelectedSourceInspector(allSources),
                    feedbackRingLog: this.sourceStore.getFeedbackRingLog(),
                    showTuningRingLog: this.mixerWatchConfig.enabled,
                    onApplyFeedbackNotch: (track) => {
                      this.sourceStore.applyFeedbackNotchToEq(track);
                      this.persistState('none');
                    },
                    onClearFeedbackRingLog: () => {
                      this.sourceStore.clearFeedbackRingLog();
                    },
                    onAddLiveSource: this.handleAddLiveSource,
                    onAddEqSource: () => {
                      this.sourceStore.addVirtualEqSource();
                      this.persistState('replace');
                    },
                    onAddUnionSource: () => {
                      this.sourceStore.addUnionSource();
                      this.persistState('replace');
                    },
                    onImportFrdFile: (file: File) => {
                      void file.text().then((text) => {
                        try {
                          this.sourceStore.importFrdStoredSource(text, file.name);
                          this.persistState('replace');
                        } catch {
                          // Ignore malformed .frd uploads
                        }
                      });
                    },
                    onSelectSource: (id) => {
                      this.sourceStore.setSelectedSourceId(id);
                      this.persistState('replace');
                    },
                    onToggleSourceVisibility: (id, vis) => {
                      this.sourceStore.toggleVisibility(id, vis);
                      if (isLiveSourceId(id)) {
                        this.engine?.updateLiveSlot(id, { visible: vis });
                      }
                      this.persistState('none');
                    },
                  })}
            </div>
          `}

      ${renderMixerWatchModal({
        open: this.mixerWatchModalOpen,
        audioInputMode: this.workspace.audioInputMode,
        mainDeviceId: this.selectedDeviceId,
        mainDeviceLabel: this.selectedDeviceLabel,
        audioDevices: this.audioDevices,
        availableMixerChannels: this.engine?.getMixerWatchAvailableChannels() ?? 16,
        mixerSampleRate: this.engine?.getMixerWatchSampleRate() ?? 48000,
        globalReferenceChannel: this.globalReferenceChannel,
        config: this.mixerWatchConfig,
        library: this.mixerPatchLibrary,
        channelLevelsDbFs: this.mixerChannelLevelsDbFs,
        statusNotice: this.engine?.getMixerWatchStatusNotice() ?? '',
        draftPresetName: this.draftMixerPresetName,
        onClose: () => {
          this.mixerWatchModalOpen = false;
        },
        onDraftPresetNameChange: (name) => {
          this.draftMixerPresetName = name;
        },
        onSaveNewPreset: (name) => {
          const dev = this.getEffectiveMixerDeviceIdentity();
          const { library, profile } = upsertMixerPatchProfile(
            this.mixerPatchLibrary,
            {
              name,
              patch: this.mixerWatchConfig.patch,
              deviceId: dev.deviceId,
              deviceLabel: dev.deviceLabel,
            }
          );
          this.mixerPatchLibrary = library;
          saveMixerPatchLibrary(library);
          this.draftMixerPresetName = '';
          this.applyMixerWatchUpdate({
            ...this.mixerWatchConfig,
            activeProfileId: profile.id,
          });
        },
        onUpdateActivePreset: () => {
          const activeId = this.mixerWatchConfig.activeProfileId;
          if (!activeId) return;
          const existing = this.mixerPatchLibrary.profiles.find(
            (p) => p.id === activeId
          );
          if (!existing) return;
          const dev = this.getEffectiveMixerDeviceIdentity();
          const { library } = upsertMixerPatchProfile(this.mixerPatchLibrary, {
            id: existing.id,
            name: existing.name,
            patch: this.mixerWatchConfig.patch,
            deviceId: dev.deviceId || existing.lastDeviceId,
            deviceLabel: dev.deviceLabel || existing.lastDeviceLabel,
          });
          this.mixerPatchLibrary = library;
          saveMixerPatchLibrary(library);
          this.requestUpdate();
        },
        onDeleteActivePreset: () => {
          const activeId = this.mixerWatchConfig.activeProfileId;
          if (!activeId) return;
          const nextLib = deleteMixerPatchProfile(
            this.mixerPatchLibrary,
            activeId
          );
          this.mixerPatchLibrary = nextLib;
          saveMixerPatchLibrary(nextLib);
          this.applyMixerWatchUpdate({
            ...this.mixerWatchConfig,
            activeProfileId: null,
          });
        },
        onSelectPreset: (profileId) => {
          if (!profileId) {
            this.applyMixerWatchUpdate({
              ...this.mixerWatchConfig,
              activeProfileId: null,
            });
            return;
          }
          const prof = this.mixerPatchLibrary.profiles.find(
            (p) => p.id === profileId
          );
          if (!prof) return;
          const dev = this.getEffectiveMixerDeviceIdentity();
          if (dev.deviceId || dev.deviceLabel) {
            this.mixerPatchLibrary = bindProfileToDevice(
              this.mixerPatchLibrary,
              prof.id,
              dev.deviceId,
              dev.deviceLabel
            );
            saveMixerPatchLibrary(this.mixerPatchLibrary);
          }
          this.applyMixerWatchUpdate({
            ...this.mixerWatchConfig,
            activeProfileId: prof.id,
            patch: hydrateMixerPatchData(
              prof,
              Math.max(16, prof.channels.length)
            ),
          });
        },
        onSelectMixerDevice: (mode, deviceId, deviceLabel) => {
          const matched = findAffinityProfileForDevice(
            this.mixerPatchLibrary,
            deviceId,
            deviceLabel
          );
          const nextPatch = matched
            ? hydrateMixerPatchData(
                matched,
                Math.max(16, matched.channels.length)
              )
            : mode === 'separate-device' &&
                this.mixerWatchConfig.patch.mixBusChannel === -2
              ? { ...this.mixerWatchConfig.patch, mixBusChannel: -1 }
              : this.mixerWatchConfig.patch;
          this.applyMixerWatchUpdate({
            ...this.mixerWatchConfig,
            deviceMode: mode,
            separateDeviceId: mode === 'separate-device' ? deviceId : '',
            separateDeviceLabel: mode === 'separate-device' ? deviceLabel : '',
            activeProfileId: matched
              ? matched.id
              : this.mixerWatchConfig.activeProfileId,
            patch: nextPatch,
          });
        },
        onUpdateConfig: (partial) => {
          this.applyMixerWatchUpdate({
            ...this.mixerWatchConfig,
            ...partial,
          });
        },
        onUpdatePatch: (partial) => {
          this.applyMixerWatchUpdate({
            ...this.mixerWatchConfig,
            patch: {
              ...this.mixerWatchConfig.patch,
              ...partial,
            },
          });
        },
      })}

      <foh-help-modal
        .open=${this.helpModalOpen}
        appName="WebSoundMeter"
        .appSummary=${WSM_HELP_SUMMARY}
        .resources=${WSM_HELP_RESOURCES}
        .shortcuts=${WSM_HELP_SHORTCUTS}
        .attribution=${WSM_HELP_ATTRIBUTION}
        dialogTestId="help-modal"
        @close-modal=${() => {
          this.helpModalOpen = false;
        }}
      ></foh-help-modal>
    `;
  }
}
