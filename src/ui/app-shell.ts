/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Main Application Shell (`<web-sound-meter-app>` Lit 3 Web Component).
 *
 * Coordinates:
 *  - Persistent Top Bar (`topbar/topbar-view.ts`) tracking the active Live Measurement slot
 *  - Multi-Chart Stack (1 to 3 synchronized `<chart-panel>` instances)
 *  - Multi-Channel Live Measurements + Reactive `SourceStore` (`sources/source-store.ts`)
 *  - URL Query State (`url-state.ts`) + `localStorage` Workspace Session (`workspace-session.ts`)
 *    + `IndexedDB` v2 Stored Traces, Virtual EQs, Math Unions, and Calibration Curves
 */

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
import { parseCalibrationFile } from '../dsp/calibration.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import {
  StoredCalibrationFile,
  deleteCalibrationFileFromDb,
  loadAllCalibrationFilesFromDb,
  saveCalibrationFileToDb,
} from '../sources/session-storage.js';
import { SourceData } from '../sources/source-data.js';
import { SourceStore, isLiveSourceId } from '../sources/source-store.js';
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
} from '../sources/workspace-session.js';
import { appShellStyles } from './app-shell-styles.js';
import { renderEqInspector } from './inspectors/eq-source-inspector.js';
import { renderLiveMeasurementInspector } from './inspectors/live-measurement-inspector.js';
import { renderStoredInspector } from './inspectors/stored-source-inspector.js';
import { renderUnionInspector } from './inspectors/union-source-inspector.js';
import { dispatchAppKeydown } from './keyboard-shortcuts.js';
import { renderSidebar } from './sidebar-view.js';
import { renderTopbar } from './topbar/topbar-view.js';
import {
  UrlViewState,
  parseUrlViewState,
  plotsForLayoutPreset,
  syncBrowserUrlState,
} from './url-state.js';

export type LayoutPreset = 'tf-dual' | 'pa-triple' | 'rta-mix' | 'single';

@customElement('web-sound-meter-app')
export class WebSoundMeterApp extends LitElement {
  static styles = appShellStyles;

  private engine: AudioEngine | null = null;
  private readonly sourceStore = new SourceStore();
  private unsubscribeStore: (() => void) | null = null;
  private hardwareStreamDeferred = false;

  @state()
  private audioInputMode: InputSourceMode = 'simulator';

  @state()
  private audioDevices: AudioDeviceOption[] = [];

  @state()
  private selectedDeviceId: string = '';

  @state()
  private selectedDeviceLabel: string = '';

  @state()
  private availableChannels: number = 2;

  @state()
  private availableOutputChannels: number = 2;

  @state()
  private globalReferenceChannel: number = 1;

  @state()
  private generatorOutputChannel: number = -1;

  @state()
  private showAdvancedMeasSettings: boolean = false;

  @state()
  private savedCalibrations: StoredCalibrationFile[] = [];

  @state()
  private genConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };

  @state()
  private isPaused: boolean = false;

  @state()
  private layoutPreset: LayoutPreset = 'pa-triple';

  @state()
  private chartPlotTypes: PlotType[] = ['magnitude', 'phase', 'impulse'];

  @state()
  private splWeighting: WeightingCurve = 'A';

  @state()
  private splTime: MeterIntegrationTime = 'Fast';

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
    });
  };

  private popstateHandler = () => {
    const next = parseUrlViewState(window.location.search, this.getUrlViewState());
    this.layoutPreset = next.layoutPreset;
    this.chartPlotTypes = next.chartPlotTypes;
    const activeId = this.sourceStore.getActiveLiveSourceId();
    const activeSlot = this.engine?.getLiveSlot(activeId);
    if (activeSlot && next.simulatorPreset !== activeSlot.simulatorPreset) {
      this.engine?.setSimulatorPreset(next.simulatorPreset, activeId);
    }
    this.splWeighting = next.splWeighting;
    this.splTime = next.splTime;
    this.sourceStore.setSelectedSourceId(next.selectedSourceId);
    this.persistState('none');
    this.requestUpdate();
  };

  connectedCallback(): void {
    super.connectedCallback();

    const session = loadWorkspaceSession();
    const initialUrl = parseUrlViewState(
      typeof window !== 'undefined' ? window.location.search : '',
      {
        layoutPreset: session.layoutPreset,
        chartPlotTypes: session.chartPlotTypes,
        audioInputMode: session.audioInputMode,
        simulatorPreset: session.simulatorPreset,
        splWeighting: session.splWeighting,
        splTime: session.splTime,
        selectedSourceId: session.selectedSourceId,
      }
    );

    this.layoutPreset = initialUrl.layoutPreset;
    this.chartPlotTypes = initialUrl.chartPlotTypes;
    this.audioInputMode = initialUrl.audioInputMode;
    this.splWeighting = initialUrl.splWeighting;
    this.splTime = initialUrl.splTime;

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
    this.engine.updateGeneratorConfig(session.genConfig);
    this.engine.setGeneratorOutputChannel(this.generatorOutputChannel);
    this.genConfig = { ...this.engine.getGeneratorConfig() };

    if (this.audioInputMode === 'hardware') {
      // On reload in hardware mode, start paused until user clicks Resume (user gesture)
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
    const [, calibrations] = await Promise.all([
      this.sourceStore.loadFromPersistence(),
      loadAllCalibrationFilesFromDb(),
    ]);
    this.savedCalibrations = calibrations;

    if (this.engine) {
      for (const slot of this.engine.getLiveSlots()) {
        if (slot.activeCalibrationId) {
          const match = calibrations.find((c) => c.id === slot.activeCalibrationId);
          if (match) {
            this.engine.loadCalibrationFile(match.text, match.name, slot.id);
          } else {
            this.engine.updateLiveSlot(slot.id, { activeCalibrationId: null });
          }
        }
      }
    }
    this.persistState('replace');
  }

  private getUrlViewState(): UrlViewState {
    const activeSlot = this.engine?.getLiveSlot(
      this.sourceStore.getActiveLiveSourceId()
    );
    return {
      layoutPreset: this.layoutPreset,
      chartPlotTypes: this.chartPlotTypes,
      audioInputMode: this.audioInputMode,
      simulatorPreset: activeSlot?.simulatorPreset ?? 'pa-room-modes',
      splWeighting: this.splWeighting,
      splTime: this.splTime,
      selectedSourceId: this.sourceStore.getSelectedSourceId(),
    };
  }

  private persistState(urlMode: 'push' | 'replace' | 'none' = 'replace'): void {
    const viewState = this.getUrlViewState();
    if (urlMode !== 'none') {
      syncBrowserUrlState(viewState, urlMode);
    }
    const currentSlots = (this.engine?.getLiveSlots() ?? []).map((s) => ({
      ...s,
      visible: this.sourceStore.getLiveSourceVisible(s.id),
    }));

    saveWorkspaceSession({
      version: 1,
      ...viewState,
      liveSlots: currentSlots,
      genConfig: {
        enabled: this.genConfig.enabled,
        type: this.genConfig.type,
        levelDbFs: this.genConfig.levelDbFs,
        sineFrequencyHz: this.genConfig.sineFrequencyHz,
      },
      hardwareRouting: {
        selectedDeviceId: this.selectedDeviceId,
        selectedDeviceLabel: this.selectedDeviceLabel,
        globalReferenceChannel: this.globalReferenceChannel,
        generatorOutputChannel: this.generatorOutputChannel,
      },
    });
  }

  private setLayoutPreset(preset: LayoutPreset): void {
    this.layoutPreset = preset;
    this.chartPlotTypes = plotsForLayoutPreset(preset, this.chartPlotTypes[0]);
    this.persistState('push');
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
    const modeChanged = this.audioInputMode !== mode;
    this.audioInputMode = mode;
    if (mode === 'hardware') {
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
      this.audioInputMode = this.engine.getInputMode();
    }
    this.persistState(modeChanged ? 'push' : 'none');
  };

  private handleEqBandDrag = (
    e: CustomEvent<{ bandIndex: number; frequency: number; gainDb: number }>
  ): void => {
    const { bandIndex, frequency, gainDb } = e.detail;
    this.sourceStore.dragActiveEqBand(bandIndex, frequency, gainDb);
  };

  private handleCalibrationUpload = (slotId: string, e: Event): void => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const parsed = parseCalibrationFile(text, file.name);
      const id = `cal-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const record: StoredCalibrationFile = {
        id,
        name: file.name,
        text,
        pointCount: parsed.points.length,
        createdAt: new Date().toISOString(),
      };
      this.savedCalibrations = [
        ...this.savedCalibrations.filter((c) => c.id !== id),
        record,
      ];
      void saveCalibrationFileToDb(record);
      this.engine?.updateLiveSlot(slotId, { activeCalibrationId: id });
      this.engine?.loadCalibrationFile(text, file.name, slotId);
      this.persistState('none');
      this.requestUpdate();
    });
  };

  private handleSelectCalibration = (
    slotId: string,
    calibrationId: string | null
  ): void => {
    this.engine?.updateLiveSlot(slotId, { activeCalibrationId: calibrationId });
    if (!calibrationId) {
      this.engine?.clearCalibration(slotId);
    } else {
      const found = this.savedCalibrations.find((c) => c.id === calibrationId);
      if (found) {
        this.engine?.loadCalibrationFile(found.text, found.name, slotId);
      }
    }
    this.persistState('none');
    this.requestUpdate();
  };

  private handleDeleteCalibration = (
    slotId: string,
    calibrationId: string
  ): void => {
    this.savedCalibrations = this.savedCalibrations.filter(
      (c) => c.id !== calibrationId
    );
    void deleteCalibrationFileFromDb(calibrationId);
    if (this.engine) {
      for (const slot of this.engine.getLiveSlots()) {
        if (slot.activeCalibrationId === calibrationId) {
          this.engine.updateLiveSlot(slot.id, { activeCalibrationId: null });
          this.engine.clearCalibration(slot.id);
        }
      }
    }
    this.persistState('none');
    this.requestUpdate();
  };

  private handleTogglePause = async (): Promise<void> => {
    const nextPaused = !this.isPaused;
    if (
      !nextPaused &&
      this.audioInputMode === 'hardware' &&
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
        this.audioInputMode = this.engine.getInputMode();
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
      audioInputMode: this.audioInputMode,
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
      savedCalibrations: this.savedCalibrations,
      activeCalibrationId: liveSlot.activeCalibrationId,
      onSelectCalibration: (calId: string | null) =>
        this.handleSelectCalibration(liveSlot.id, calId),
      onDeleteCalibration: (calId: string) =>
        this.handleDeleteCalibration(liveSlot.id, calId),
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

  render() {
    const allSources = this.sourceStore.getAllSources();
    const activeEq = this.sourceStore.getActiveEq();
    const activeLiveId = this.sourceStore.getActiveLiveSourceId();
    const activeSlot = this.getActiveLiveSlot();
    const activeLiveSource = this.sourceStore.getLiveSource(activeLiveId);

    return html`
      ${renderTopbar({
        layoutPreset: this.layoutPreset,
        audioInputMode: this.audioInputMode,
        audioDevices: this.audioDevices,
        selectedDeviceId: this.selectedDeviceId,
        selectedDeviceLabel: this.selectedDeviceLabel,
        availableChannels: this.availableChannels,
        availableOutputChannels: this.availableOutputChannels,
        globalReferenceChannel: this.globalReferenceChannel,
        generatorOutputChannel: this.generatorOutputChannel,
        genConfig: this.genConfig,
        isPaused: this.isPaused,
        splWeighting: this.splWeighting,
        splTime: this.splTime,
        levels: activeLiveSource?.levels,
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
        onToggleGenerator: () => {
          if (!this.engine) return;
          this.engine.updateGeneratorConfig({ enabled: !this.genConfig.enabled });
          this.genConfig = { ...this.engine.getGeneratorConfig() };
          this.persistState('none');
        },
        onGeneratorTypeChange: (type: GeneratorSignalType) => {
          if (!this.engine) return;
          this.engine.updateGeneratorConfig({ type });
          this.genConfig = { ...this.engine.getGeneratorConfig() };
          this.persistState('none');
        },
        onGeneratorLevelChange: (levelDbFs: number) => {
          if (!this.engine) return;
          this.engine.updateGeneratorConfig({ levelDbFs });
          this.genConfig = { ...this.engine.getGeneratorConfig() };
          this.persistState('none');
        },
        onTogglePause: () => {
          void this.handleTogglePause();
        },
        onSplWeightingChange: (curve) => {
          this.splWeighting = curve;
          this.persistState('replace');
        },
        onSplTimeChange: (time) => {
          this.splTime = time;
          this.persistState('replace');
        },
      })}

      <div class="workspace">
        <main class="charts-column">
          ${this.chartPlotTypes.map(
            (pt, idx) => html`
              <chart-panel
                data-testid="chart-panel-${idx}"
                .plotType=${pt}
                .sources=${allSources}
                .eqBands=${activeEq ? activeEq.bands : null}
                @plot-type-change=${(e: CustomEvent<{ plotType: PlotType }>) => {
                  const updated = [...this.chartPlotTypes];
                  updated[idx] = e.detail.plotType;
                  this.chartPlotTypes = updated;
                  this.persistState('replace');
                }}
                @eq-band-drag=${this.handleEqBandDrag}
              ></chart-panel>
            `
          )}
        </main>

        ${renderSidebar({
          audioInputMode: this.audioInputMode,
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
    `;
  }
}
