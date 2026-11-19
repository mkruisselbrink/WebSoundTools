// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Main Application Shell (`<web-sound-meter-app>` Lit 3 Web Component).
 */

import '@foh/ui';
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
  clearSplShowCheckpointsFromDb,
  loadAllSplShowCheckpointsFromDb,
  saveSplShowCheckpointsToDb,
} from '../sources/session-storage.js';
import { SourceData, exportSourceDataToFrd } from '../sources/source-data.js';
import { SourceStore, isLiveSourceId } from '../sources/source-store.js';
import { loadWorkspaceSession } from '../sources/workspace-session.js';
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
import { renderShowSidebar } from './show-sidebar-view.js';
import { renderSidebar } from './sidebar-view.js';
import { renderTopbar } from './topbar/topbar-view.js';
import {
  UrlViewState,
  WorkspaceMode,
  parseUrlViewState,
  syncBrowserUrlState,
} from './url-state.js';
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
  private hardwareStreamDeferred = false;

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
  private helpModalOpen = false;

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
        if (this.helpModalOpen) {
          this.helpModalOpen = false;
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

  private popstateHandler = () => {
    const next = parseUrlViewState(window.location.search, this.getUrlViewState());
    const nextMode: WorkspaceMode = next.workspaceMode ?? 'tuning';
    this.workspace.workspaceMode = nextMode;
    if (nextMode === 'show' && this.workspace.audioInputMode === 'hardware' && this.genConfig.enabled) {
      this.updateGenerator({ enabled: false });
    }
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
      this.engine.setPaused(true);
    }

    void this.engine.listInputDevices().then((devices) => {
      if (devices.length > 0) {
        this.audioDevices = devices;
      }
    });

    this.engine.onLiveFrames((frames) => {
      this.sourceStore.setLiveFrames(frames);
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

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('popstate', this.popstateHandler);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('popstate', this.popstateHandler);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private getActiveLiveSlot(): LiveMeasurementSlotConfig {
    const activeId = this.sourceStore.getActiveLiveSourceId();
    return this.engine!.getLiveSlot(activeId);
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
      },
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
    if (mode === 'hardware') {
      if ((modeChanged || this.workspace.workspaceMode === 'show') && this.genConfig.enabled) {
        this.updateGenerator({ enabled: false });
      }
      this.selectedDeviceId = deviceId;
      const dev = this.audioDevices.find((d) => d.deviceId === deviceId);
      this.selectedDeviceLabel = dev ? dev.label : '';
    }
    this.hardwareStreamDeferred = false;
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
      }
    } catch {
      this.workspace.audioInputMode = this.engine.getInputMode();
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

  private handleTogglePause = async (): Promise<void> => {
    const nextPaused = !this.isPaused;
    if (
      !nextPaused &&
      this.workspace.audioInputMode === 'hardware' &&
      this.hardwareStreamDeferred &&
      this.engine
    ) {
      try {
        await this.engine.setInputMode('hardware', this.selectedDeviceId);
        this.hardwareStreamDeferred = false;
        this.audioDevices = await this.engine.listInputDevices();
        this.availableChannels = this.engine.getAvailableChannels();
        this.availableOutputChannels = this.engine.getAvailableOutputChannels();
      } catch {
        this.workspace.audioInputMode = this.engine.getInputMode();
        this.persistState('replace');
      }
    }
    this.isPaused = nextPaused;
    this.engine?.setPaused(this.isPaused);
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
      onResetAveraging: () => this.engine?.resetAveraging(liveSlot.id),
      onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) => {
        this.engine?.updateMeasurementConfig(partial, liveSlot.id);
        this.persistState('none');
        this.requestUpdate();
      },
      onCalibrationUpload: (e: Event) =>
        this.handleCalibrationUpload(liveSlot.id, e),
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
    const activeSlot = this.getActiveLiveSlot();
    const activeLiveSource = this.sourceStore.getLiveSource(activeLiveId);

    return html`
      ${renderTopbar({
        workspaceMode: this.workspace.workspaceMode,
        layoutPreset: this.workspace.layoutPreset,
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
        splWeighting: this.workspace.splWeighting,
        splTime: this.workspace.splTime,
        levels: activeLiveSource?.levels,
        splAlertThresholds: this.workspace.splAlertThresholds,
        onWorkspaceModeChange: (mode) => this.setWorkspaceMode(mode),
        onLayoutPresetChange: (preset) => this.setLayoutPreset(preset),
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

      <div class="workspace">
        <main class="charts-column">
          ${this.workspace.chartPlotTypes.map(
            (pt, idx) => html`
              <chart-panel
                data-testid="chart-panel-${idx}"
                .plotType=${pt}
                .sources=${chartSources}
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
          ? renderShowSidebar({
              audioInputMode: this.workspace.audioInputMode,
              availableChannels: this.availableChannels,
              globalReferenceChannel: this.globalReferenceChannel,
              selectedSourceId: activeLiveId,
              liveSlots: this.engine?.getLiveSlots() ?? [],
              liveSources: this.sourceStore.getLiveSources(),
              feedbackRingLog: this.sourceStore.getFeedbackRingLog(),
              splAlertThresholds: this.workspace.splAlertThresholds,
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
            })
          : renderSidebar({
              audioInputMode: this.workspace.audioInputMode,
              simulatorPreset: activeSlot.simulatorPreset,
              allSources,
              selectedSourceId: this.sourceStore.getSelectedSourceId(),
              inspectorContent: this.renderSelectedSourceInspector(allSources),
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
