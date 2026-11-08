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
 *  - Persistent Top Bar (`topbar-view.ts`): Layout Presets, Demo Simulator / Hardware Input selector,
 *    Signal Generator controls, Auto Delay Finder & Apply, Capture button, and Live SPL/Leq Meter
 *  - Multi-Chart Stack (1 to 3 synchronized `<chart-panel>` instances)
 *  - Right-hand OSM-style Source List & Context-Sensitive Inspector (`inspector-views.ts`)
 */

import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AudioDeviceOption, AudioEngine } from '../audio/audio-engine.js';
import '../charts/chart-panel.js';
import { PlotType } from '../charts/plot-types.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { BiquadSpec } from '../dsp/biquad.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
} from '../dsp/synthetic-rig.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import {
  EqualizerSourceConfig,
  computeEqualizerSourceData,
  createDefaultEqBands,
} from '../sources/eq-source.js';
import {
  deleteStoredTraceFromDb,
  loadAllStoredTracesFromDb,
  saveStoredTraceToDb,
} from '../sources/session-storage.js';
import {
  DEFAULT_SOURCE_PALETTE,
  SourceData,
  cloneSourceDataAsStored,
} from '../sources/source-data.js';
import {
  UnionSourceConfig,
  computeUnionSourceData,
} from '../sources/union-source.js';
import { appShellStyles } from './app-shell-styles.js';
import {
  renderEqInspector,
  renderLiveMeasurementInspector,
  renderStoredInspector,
  renderUnionInspector,
} from './inspector-views.js';
import { renderTopbar } from './topbar-view.js';

export type LayoutPreset = 'tf-dual' | 'pa-triple' | 'rta-mix' | 'single';

@customElement('web-sound-meter-app')
export class WebSoundMeterApp extends LitElement {
  static styles = appShellStyles;

  private engine: AudioEngine | null = null;

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
  private liveSource: SourceData | null = null;

  @state()
  private liveSourceVisible: boolean = true;

  @state()
  private storedSources: SourceData[] = [];

  @state()
  private eqSources: EqualizerSourceConfig[] = [];

  @state()
  private unionSources: UnionSourceConfig[] = [];

  @state()
  private selectedSourceId: string = 'live-measurement';

  @state()
  private splWeighting: WeightingCurve = 'A';

  @state()
  private splTime: MeterIntegrationTime = 'Fast';

  private eqEvalCache = new Map<
    string,
    { cfg: EqualizerSourceConfig; target: SourceData | null; data: SourceData }
  >();
  private unionEvalCache = new Map<
    string,
    { cfg: UnionSourceConfig; inputs: SourceData[]; data: SourceData }
  >();
  private lastAllSourcesRef: {
    live: SourceData | null;
    stored: SourceData[];
    eq: EqualizerSourceConfig[];
    union: UnionSourceConfig[];
    result: SourceData[];
  } | null = null;

  private keydownHandler = (e: KeyboardEvent) => {
    const target = (e.composedPath?.()[0] ?? e.target) as HTMLElement | undefined;
    const tag = target?.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      target?.isContentEditable
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      this.captureCurrentTrace();
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      this.engine?.findAndApplyDelay();
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.engine = new AudioEngine();
    this.measConfig = this.engine.getMeasurementConfig();
    this.genConfig = this.engine.getGeneratorConfig();

    this.engine.onFrame((live) => {
      this.liveSource = this.liveSourceVisible
        ? live
        : { ...live, visible: false };
    });
    this.engine.onMeasurementConfigChange((cfg) => {
      this.measConfig = { ...cfg };
    });

    loadAllStoredTracesFromDb().then((loaded) => {
      if (loaded.length > 0) {
        this.storedSources = loaded;
      }
    });

    window.addEventListener('keydown', this.keydownHandler);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.keydownHandler);
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

  private captureCurrentTrace(): void {
    const allSources = this.computeAllSources();
    const target =
      allSources.find((s) => s.id === this.selectedSourceId) ?? this.liveSource;
    if (!target) return;

    const paletteIdx = (this.storedSources.length + 1) % DEFAULT_SOURCE_PALETTE.length;
    const captured = cloneSourceDataAsStored(
      target,
      `${target.name} #${this.storedSources.length + 1}`,
      DEFAULT_SOURCE_PALETTE[paletteIdx]
    );

    this.storedSources = [...this.storedSources, captured];
    this.selectedSourceId = captured.id;
    saveStoredTraceToDb(captured);
  }

  private deleteStoredSource(id: string): void {
    this.storedSources = this.storedSources.filter((s) => s.id !== id);
    deleteStoredTraceFromDb(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = 'live-measurement';
    }
  }

  private addVirtualEqSource = (): void => {
    const uid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `eq-${uid}`;
    const newEq: EqualizerSourceConfig = {
      id,
      name: `Virtual EQ #${this.eqSources.length + 1}`,
      color: '#10b981',
      visible: true,
      bands: createDefaultEqBands(),
      targetSourceId: 'live-measurement',
    };
    this.eqSources = [...this.eqSources, newEq];
    this.selectedSourceId = id;
  };

  private autoFlattenRoomModesWithEq(eqId: string): void {
    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== eqId) return eq;
      return {
        ...eq,
        bands: [
          { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
          { type: 'lowshelf', frequency: 100, q: 0.707, gainDb: 0, enabled: true },
          { type: 'peaking', frequency: 160, q: 2.2, gainDb: -6.5, enabled: true },
          { type: 'peaking', frequency: 800, q: 3.0, gainDb: 5.0, enabled: true },
          { type: 'peaking', frequency: 3200, q: 2.5, gainDb: -3.5, enabled: true },
          { type: 'highshelf', frequency: 9000, q: 0.707, gainDb: 6.0, enabled: true },
        ],
      };
    });
  }

  private addUnionSource = (): void => {
    const uid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `union-${uid}`;
    const allIds = ['live-measurement', ...this.storedSources.map((s) => s.id)];
    const newUnion: UnionSourceConfig = {
      id,
      name: `Math Union #${this.unionSources.length + 1}`,
      color: '#f59e0b',
      visible: true,
      operation: 'vector-avg',
      sourceIds: [allIds[0], allIds[1] ?? allIds[0]],
    };
    this.unionSources = [...this.unionSources, newUnion];
    this.selectedSourceId = id;
  };

  private handleEqBandDrag = (
    e: CustomEvent<{ bandIndex: number; frequency: number; gainDb: number }>
  ): void => {
    const activeEq =
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ?? this.eqSources[0];
    if (!activeEq) return;

    const { bandIndex, frequency, gainDb } = e.detail;
    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== activeEq.id) return eq;
      const bands = eq.bands.map((b, i) =>
        i === bandIndex ? { ...b, frequency, gainDb } : b
      );
      return { ...eq, bands };
    });
  };

  private updateEqBand(eqId: string, bandIdx: number, partial: Partial<BiquadSpec>): void {
    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== eqId) return eq;
      const bands = eq.bands.map((b, i) => (i === bandIdx ? { ...b, ...partial } : b));
      return { ...eq, bands };
    });
  }

  private computeAllSources(): SourceData[] {
    if (
      this.lastAllSourcesRef &&
      this.lastAllSourcesRef.live === this.liveSource &&
      this.lastAllSourcesRef.stored === this.storedSources &&
      this.lastAllSourcesRef.eq === this.eqSources &&
      this.lastAllSourcesRef.union === this.unionSources
    ) {
      return this.lastAllSourcesRef.result;
    }

    const list: SourceData[] = [];
    if (this.liveSource) {
      list.push(this.liveSource);
    }
    list.push(...this.storedSources);

    // Evaluate Virtual EQ sources (memoized by config + target reference)
    for (const eqCfg of this.eqSources) {
      const target = eqCfg.targetSourceId
        ? list.find((s) => s.id === eqCfg.targetSourceId) ?? null
        : null;
      const cached = this.eqEvalCache.get(eqCfg.id);
      if (cached && cached.cfg === eqCfg && cached.target === target) {
        list.push(cached.data);
      } else {
        const data = computeEqualizerSourceData(eqCfg, target);
        this.eqEvalCache.set(eqCfg.id, { cfg: eqCfg, target, data });
        list.push(data);
      }
    }

    // Evaluate Math / Union sources (memoized by config + input references)
    for (const uCfg of this.unionSources) {
      const inputs = uCfg.sourceIds
        .map((id) => list.find((s) => s.id === id))
        .filter((s): s is SourceData => Boolean(s));
      const cached = this.unionEvalCache.get(uCfg.id);
      const inputsMatch =
        cached &&
        cached.inputs.length === inputs.length &&
        cached.inputs.every((inp, idx) => inp === inputs[idx]);
      if (cached && cached.cfg === uCfg && inputsMatch) {
        list.push(cached.data);
      } else {
        const data = computeUnionSourceData(uCfg, inputs);
        this.unionEvalCache.set(uCfg.id, { cfg: uCfg, inputs, data });
        list.push(data);
      }
    }

    this.lastAllSourcesRef = {
      live: this.liveSource,
      stored: this.storedSources,
      eq: this.eqSources,
      union: this.unionSources,
      result: list,
    };

    return list;
  }

  private handleCalibrationUpload = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      this.engine?.loadCalibrationFile(text, file.name);
    });
  };

  private toggleSourceVisibility(id: string, visible: boolean): void {
    if (id === 'live-measurement') {
      this.liveSourceVisible = visible;
      if (this.liveSource) {
        this.liveSource = { ...this.liveSource, visible };
      }
    } else if (id.startsWith('stored-')) {
      this.storedSources = this.storedSources.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, visible };
        saveStoredTraceToDb(updated);
        return updated;
      });
    } else if (id.startsWith('eq-')) {
      this.eqSources = this.eqSources.map((s) =>
        s.id === id ? { ...s, visible } : s
      );
    } else if (id.startsWith('union-')) {
      this.unionSources = this.unionSources.map((s) =>
        s.id === id ? { ...s, visible } : s
      );
    }
  }

  private renderSelectedSourceInspector(allSources: SourceData[]) {
    const liveHandlers = {
      onResetAveraging: () => this.engine?.resetAveraging(),
      onUpdateConfig: (partial: Partial<MeasurementPipelineConfig>) =>
        this.engine?.updateMeasurementConfig(partial),
      onCalibrationUpload: this.handleCalibrationUpload,
    };

    if (this.selectedSourceId === 'live-measurement') {
      return renderLiveMeasurementInspector(this.measConfig, liveHandlers);
    }

    const stored = this.storedSources.find((s) => s.id === this.selectedSourceId);
    if (stored) {
      return renderStoredInspector(stored, {
        onDelete: (id) => this.deleteStoredSource(id),
        onUpdateStored: (id, partial) => {
          this.storedSources = this.storedSources.map((s) => {
            if (s.id !== id) return s;
            const updated = { ...s, ...partial };
            saveStoredTraceToDb(updated);
            return updated;
          });
        },
      });
    }

    const eq = this.eqSources.find((s) => s.id === this.selectedSourceId);
    if (eq) {
      return renderEqInspector(eq, allSources, {
        onAutoFlatten: (eqId) => this.autoFlattenRoomModesWithEq(eqId),
        onTargetSourceChange: (eqId, targetSourceId) => {
          this.eqSources = this.eqSources.map((item) =>
            item.id === eqId ? { ...item, targetSourceId } : item
          );
        },
        onUpdateEqBand: (eqId, bandIdx, partial) => this.updateEqBand(eqId, bandIdx, partial),
      });
    }

    const union = this.unionSources.find((s) => s.id === this.selectedSourceId);
    if (union) {
      return renderUnionInspector(union, allSources, {
        onUpdateUnion: (unionId, partial) => {
          this.unionSources = this.unionSources.map((u) =>
            u.id === unionId ? { ...u, ...partial } : u
          );
        },
      });
    }

    return renderLiveMeasurementInspector(this.measConfig, liveHandlers);
  }

  render() {
    const allSources = this.computeAllSources();
    const activeEq =
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ??
      this.eqSources.find((eq) => eq.visible) ??
      null;

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
        levels: this.liveSource?.levels,
        delayEstimate: this.liveSource?.delayEstimate,
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
        onCaptureTrace: () => this.captureCurrentTrace(),
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

      <!-- Main Workspace: Stacked Charts + Right Source/Inspector Sidebar -->
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

        <aside class="sidebar">
          ${this.audioInputMode === 'simulator'
            ? html`
                <div class="sim-banner" data-testid="simulator-description">
                  <strong>Demo Mode Active:</strong>
                  ${SIMULATOR_PRESETS[this.simulatorPreset].description}
                </div>
              `
            : nothing}

          <!-- Sources List Card -->
          <div class="section-card">
            <div class="section-header">
              <span>Sources (${allSources.length})</span>
              <div style="display:flex;gap:4px;">
                <button
                  data-testid="btn-add-eq"
                  title="Add Virtual Parametric EQ Source"
                  @click=${this.addVirtualEqSource}
                >
                  + EQ
                </button>
                <button
                  data-testid="btn-add-union"
                  title="Add Math / Union Source"
                  @click=${this.addUnionSource}
                >
                  + Math
                </button>
              </div>
            </div>

            <div class="source-list" data-testid="source-list">
              ${allSources.map(
                (src) => html`
                  <div
                    class="source-row ${this.selectedSourceId === src.id ? 'selected' : ''}"
                    data-testid="source-item-${src.id}"
                    @click=${() => {
                      this.selectedSourceId = src.id;
                    }}
                  >
                    <div class="source-row-left">
                      <input
                        type="checkbox"
                        aria-label="Toggle visibility for ${src.name}"
                        .checked=${src.visible}
                        @click=${(e: Event) => e.stopPropagation()}
                        @change=${(e: Event) => {
                          const vis = (e.target as HTMLInputElement).checked;
                          this.toggleSourceVisibility(src.id, vis);
                        }}
                      />
                      <span
                        style="width:10px;height:10px;border-radius:50%;background:${src.color};display:inline-block;flex-shrink:0;"
                      ></span>
                      <span class="source-name">${src.name}</span>
                    </div>
                    <span class="source-badge">${src.kind}</span>
                  </div>
                `
              )}
            </div>
          </div>

          <!-- Context-Sensitive Inspector for Selected Source -->
          ${this.renderSelectedSourceInspector(allSources)}
        </aside>
      </div>
    `;
  }
}
