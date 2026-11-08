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
 *  - Persistent Top Bar (`topbar/topbar-view.ts`)
 *  - Multi-Chart Stack (1 to 3 synchronized `<chart-panel>` instances)
 *  - Reactive `SourceStore` (`sources/source-store.ts`) + Sidebar & Inspector panels
 */

import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AudioDeviceOption, AudioEngine } from '../audio/audio-engine.js';
import '../charts/chart-panel.js';
import { PlotType } from '../charts/plot-types.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import { SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import { SourceData } from '../sources/source-data.js';
import { SourceStore } from '../sources/source-store.js';
import { appShellStyles } from './app-shell-styles.js';
import { renderEqInspector } from './inspectors/eq-source-inspector.js';
import { renderLiveMeasurementInspector } from './inspectors/live-measurement-inspector.js';
import { renderStoredInspector } from './inspectors/stored-source-inspector.js';
import { renderUnionInspector } from './inspectors/union-source-inspector.js';
import { dispatchAppKeydown } from './keyboard-shortcuts.js';
import { renderSidebar } from './sidebar-view.js';
import { renderTopbar } from './topbar/topbar-view.js';

export type LayoutPreset = 'tf-dual' | 'pa-triple' | 'rta-mix' | 'single';

@customElement('web-sound-meter-app')
export class WebSoundMeterApp extends LitElement {
  static styles = appShellStyles;

  private engine: AudioEngine | null = null;
  private readonly sourceStore = new SourceStore();
  private unsubscribeStore: (() => void) | null = null;

  @state()
  private audioInputMode: InputSourceMode = 'simulator';

  @state()
  private simulatorPreset: SimulatorPresetId = 'pa-room-modes';

  @state()
  private audioDevices: AudioDeviceOption[] = [];

  @state()
  private selectedDeviceId: string = '';

  @state()
  private availableChannels: number = 2;

  @state()
  private availableOutputChannels: number = 2;

  @state()
  private measurementChannel: number = 0;

  @state()
  private referenceChannel: number = 1;

  @state()
  private generatorOutputChannel: number = -1;

  @state()
  private measConfig: MeasurementPipelineConfig = { ...DEFAULT_MEASUREMENT_CONFIG };

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
      onCaptureTrace: () => this.sourceStore.captureCurrentTrace(),
      onFindAndApplyDelay: () => this.engine?.findAndApplyDelay(),
    });
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribeStore = this.sourceStore.subscribe(() => {
      this.requestUpdate();
    });

    this.engine = new AudioEngine();
    this.measConfig = this.engine.getMeasurementConfig();
    this.genConfig = this.engine.getGeneratorConfig();

    this.engine.onFrame((live) => {
      this.sourceStore.setLiveFrame(live);
    });
    this.engine.onMeasurementConfigChange((cfg) => {
      this.measConfig = { ...cfg };
    });

    void this.sourceStore.loadFromPersistence();
    window.addEventListener('keydown', this.keydownHandler);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.keydownHandler);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private setLayoutPreset(preset: LayoutPreset): void {
    this.layoutPreset = preset;
    switch (preset) {
      case 'tf-dual':
        this.chartPlotTypes = ['magnitude', 'phase'];
        break;
      case 'pa-triple':
        this.chartPlotTypes = ['magnitude', 'phase', 'impulse'];
        break;
      case 'rta-mix':
        this.chartPlotTypes = ['rta', 'magnitude'];
        break;
      case 'single':
        this.chartPlotTypes = [this.chartPlotTypes[0] ?? 'magnitude'];
        break;
    }
  }

  private handleInputModeChange = async (e: Event): Promise<void> => {
    if (!this.engine) return;
    const mode = (e.target as HTMLSelectElement).value as InputSourceMode;
    this.audioInputMode = mode;
    try {
      await this.engine.setInputMode(
        mode,
        this.selectedDeviceId,
        this.measurementChannel,
        this.referenceChannel
      );
      if (mode === 'hardware') {
        this.audioDevices = await this.engine.listInputDevices();
        this.availableChannels = this.engine.getAvailableChannels();
        this.availableOutputChannels = this.engine.getAvailableOutputChannels();
      }
    } catch {
      this.audioInputMode = this.engine.getInputMode();
    }
  };

  private handleSimulatorPresetChange = (e: Event): void => {
    const preset = (e.target as HTMLSelectElement).value as SimulatorPresetId;
    this.simulatorPreset = preset;
    this.engine?.setSimulatorPreset(preset);
  };

  private handleEqBandDrag = (
    e: CustomEvent<{ bandIndex: number; frequency: number; gainDb: number }>
  ): void => {
    const { bandIndex, frequency, gainDb } = e.detail;
    this.sourceStore.dragActiveEqBand(bandIndex, frequency, gainDb);
  };

  private handleCalibrationUpload = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      this.engine?.loadCalibrationFile(text, file.name);
    });
  };

  private renderSelectedSourceInspector(allSources: SourceData[]) {
    const selectedId = this.sourceStore.getSelectedSourceId();
    const liveHandlers = {
      onResetAveraging: () => this.engine?.resetAveraging(),
      onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) =>
        this.engine?.updateMeasurementConfig(partial),
      onCalibrationUpload: this.handleCalibrationUpload,
    };

    if (selectedId === 'live-measurement') {
      return renderLiveMeasurementInspector(this.measConfig, liveHandlers);
    }

    const stored = this.sourceStore.getStoredSources().find((s) => s.id === selectedId);
    if (stored) {
      return renderStoredInspector(stored, {
        onDelete: (id) => this.sourceStore.deleteStoredSource(id),
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
      });
    }

    const union = this.sourceStore.getUnionSources().find((s) => s.id === selectedId);
    if (union) {
      return renderUnionInspector(union, allSources, {
        onUpdateUnion: (unionId, partial) =>
          this.sourceStore.updateUnionSource(unionId, partial),
      });
    }

    return renderLiveMeasurementInspector(this.measConfig, liveHandlers);
  }

  render() {
    const allSources = this.sourceStore.getAllSources();
    const activeEq = this.sourceStore.getActiveEq();
    const liveSource = this.sourceStore.getLiveSource();

    return html`
      ${renderTopbar({
        layoutPreset: this.layoutPreset,
        audioInputMode: this.audioInputMode,
        simulatorPreset: this.simulatorPreset,
        audioDevices: this.audioDevices,
        selectedDeviceId: this.selectedDeviceId,
        availableChannels: this.availableChannels,
        availableOutputChannels: this.availableOutputChannels,
        measurementChannel: this.measurementChannel,
        referenceChannel: this.referenceChannel,
        generatorOutputChannel: this.generatorOutputChannel,
        genConfig: this.genConfig,
        isPaused: this.isPaused,
        splWeighting: this.splWeighting,
        splTime: this.splTime,
        levels: liveSource?.levels,
        delayEstimate: liveSource?.delayEstimate,
        onLayoutPresetChange: (preset) => this.setLayoutPreset(preset),
        onInputModeChange: this.handleInputModeChange,
        onSimulatorPresetChange: this.handleSimulatorPresetChange,
        onDeviceChange: async (deviceId) => {
          this.selectedDeviceId = deviceId;
          if (!this.engine) return;
          try {
            await this.engine.setInputMode(
              'hardware',
              this.selectedDeviceId,
              this.measurementChannel,
              this.referenceChannel
            );
            this.availableChannels = this.engine.getAvailableChannels();
            this.availableOutputChannels = this.engine.getAvailableOutputChannels();
          } catch {
            this.audioInputMode = this.engine.getInputMode();
          }
        },
        onChannelRoutingChange: (measCh, refCh) => {
          this.measurementChannel = measCh;
          this.referenceChannel = refCh;
          this.engine?.setChannelRouting(measCh, refCh, this.generatorOutputChannel);
        },
        onGeneratorOutputChannelChange: (outCh) => {
          this.generatorOutputChannel = outCh;
          this.engine?.setGeneratorOutputChannel(outCh);
        },
        onToggleGenerator: () => {
          if (!this.engine) return;
          this.engine.updateGeneratorConfig({ enabled: !this.genConfig.enabled });
          this.genConfig = { ...this.engine.getGeneratorConfig() };
        },
        onGeneratorTypeChange: (type: GeneratorSignalType) => {
          if (!this.engine) return;
          this.engine.updateGeneratorConfig({ type });
          this.genConfig = { ...this.engine.getGeneratorConfig() };
        },
        onGeneratorLevelChange: (levelDbFs: number) => {
          if (!this.engine) return;
          this.engine.updateGeneratorConfig({ levelDbFs });
          this.genConfig = { ...this.engine.getGeneratorConfig() };
        },
        onFindAndApplyDelay: () => this.engine?.findAndApplyDelay(),
        onCaptureTrace: () => this.sourceStore.captureCurrentTrace(),
        onTogglePause: () => {
          this.isPaused = !this.isPaused;
          this.engine?.setPaused(this.isPaused);
        },
        onSplWeightingChange: (curve) => {
          this.splWeighting = curve;
        },
        onSplTimeChange: (time) => {
          this.splTime = time;
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
                }}
                @eq-band-drag=${this.handleEqBandDrag}
              ></chart-panel>
            `
          )}
        </main>

        ${renderSidebar({
          audioInputMode: this.audioInputMode,
          simulatorPreset: this.simulatorPreset,
          allSources,
          selectedSourceId: this.sourceStore.getSelectedSourceId(),
          inspectorContent: this.renderSelectedSourceInspector(allSources),
          onAddEqSource: () => this.sourceStore.addVirtualEqSource(),
          onAddUnionSource: () => this.sourceStore.addUnionSource(),
          onSelectSource: (id) => this.sourceStore.setSelectedSourceId(id),
          onToggleSourceVisibility: (id, vis) => this.sourceStore.toggleVisibility(id, vis),
        })}
      </div>
    `;
  }
}
