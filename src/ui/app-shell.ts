/**
 * Main Application Shell (`<web-sound-meter-app>` Lit 3 Web Component).
 *
 * Combines:
 *  - Persistent Top Bar: Layout Presets, Demo Simulator / Hardware Input selector,
 *    Signal Generator controls, Auto Delay Finder & Apply, Capture button, and Live SPL/Leq Meter
 *  - Multi-Chart Stack (1 to 3 synchronized `<chart-panel>` instances)
 *  - Right-hand OSM-style Source List & Context-Sensitive Inspector (Live Measurement,
 *    Stored Traces, Virtual Parametric EQ, and Math/Union Sources)
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AudioDeviceOption, AudioEngine } from '../audio/audio-engine.js';
import '../charts/chart-panel.js';
import { PlotType } from '../charts/plot-types.js';
import {
  InputPreFilterType,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { BiquadFilterType } from '../dsp/biquad.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  GENERATOR_SIGNAL_LABELS,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import { OctaveSmoothingType } from '../dsp/smoothing.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
} from '../dsp/synthetic-rig.js';
import { AveragingType, TransferEstimatorType } from '../dsp/transfer-function.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import {
  WINDOW_FUNCTION_LABELS,
  WindowFunctionType,
} from '../dsp/window-functions.js';
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
  UNION_OPERATION_LABELS,
  UnionOperation,
  UnionSourceConfig,
  computeUnionSourceData,
} from '../sources/union-source.js';

export type LayoutPreset = 'tf-dual' | 'pa-triple' | 'rta-mix' | 'single';

@customElement('web-sound-meter-app')
export class WebSoundMeterApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      background: #060911;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      overflow: hidden;
      box-sizing: border-box;
    }

    * {
      box-sizing: border-box;
    }

    /* Top Bar */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 14px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      flex-wrap: wrap;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 14px;
      color: #38bdf8;
      letter-spacing: 0.02em;
    }

    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #162033;
      border: 1px solid #263554;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
    }

    .toolbar-label {
      color: #94a3b8;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    select,
    input[type='number'],
    input[type='text'],
    button {
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
    }

    button {
      cursor: pointer;
      font-weight: 500;
      transition: background 0.12s, border-color 0.12s;
    }

    button:hover,
    select:hover {
      border-color: #38bdf8;
    }

    button.btn-primary {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
    }

    button.btn-primary:hover {
      background: #0369a1;
    }

    button.btn-accent {
      background: #059669;
      border-color: #10b981;
      color: #ffffff;
    }

    button.btn-accent:hover {
      background: #047857;
    }

    button.btn-active {
      background: #dc2626;
      border-color: #f87171;
      color: #ffffff;
    }

    /* SPL Meter Pill */
    .spl-readout {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .spl-main-value {
      font-size: 16px;
      font-weight: 700;
      color: #38bdf8;
      min-width: 90px;
      text-align: right;
    }

    .spl-sub-value {
      font-size: 11px;
      color: #cbd5e1;
    }

    /* Main Workspace */
    .workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .charts-column {
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: 8px;
      padding: 8px;
      min-width: 0;
      min-height: 0;
    }

    /* Right Sidebar */
    .sidebar {
      width: 340px;
      background: #0f172a;
      border-left: 1px solid #1e293b;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 10px;
      gap: 12px;
    }

    .section-card {
      background: #162033;
      border: 1px solid #263554;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 700;
      color: #e2e8f0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .source-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .source-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 5px;
      background: #0f172a;
      border: 1px solid #1e293b;
      cursor: pointer;
      font-size: 12px;
    }

    .source-row.selected {
      border-color: #38bdf8;
      background: #172554;
    }

    .source-row-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }

    .source-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }

    .source-badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      background: #1e293b;
      color: #94a3b8;
      text-transform: uppercase;
    }

    .prop-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 8px;
      font-size: 11px;
    }

    .prop-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .prop-field.full-width {
      grid-column: 1 / -1;
    }

    .prop-field label {
      color: #94a3b8;
      font-size: 10px;
    }

    .eq-band-row {
      display: grid;
      grid-template-columns: auto 1fr 62px 54px 48px;
      gap: 4px;
      align-items: center;
      font-size: 11px;
      background: #0f172a;
      padding: 4px 6px;
      border-radius: 4px;
    }

    .eq-band-row input,
    .eq-band-row select {
      padding: 2px 4px;
      font-size: 11px;
      width: 100%;
    }

    .sim-banner {
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.35;
      padding: 4px 6px;
      background: #0f172a;
      border-radius: 4px;
      border-left: 3px solid #38bdf8;
    }
  `;

  private engine!: AudioEngine;

  @state()
  private audioInputMode: InputSourceMode = 'simulator';

  @state()
  private simulatorPreset: SimulatorPresetId = 'pa-room-modes';

  @state()
  private audioDevices: AudioDeviceOption[] = [];

  @state()
  private selectedDeviceId: string = '';

  @state()
  private measConfig!: MeasurementPipelineConfig;

  @state()
  private genConfig!: SignalGeneratorConfig;

  @state()
  private isPaused: boolean = false;

  @state()
  private layoutPreset: LayoutPreset = 'pa-triple';

  @state()
  private chartPlotTypes: PlotType[] = ['magnitude', 'phase', 'impulse'];

  @state()
  private liveSource: SourceData | null = null;

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

  private keydownHandler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      this.captureCurrentTrace();
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      this.engine.findAndApplyDelay();
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.engine = new AudioEngine();
    this.measConfig = this.engine.getMeasurementConfig();
    this.genConfig = this.engine.getGeneratorConfig();

    this.engine.onFrame((live) => {
      this.liveSource = live;
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

  private async handleInputModeChange(e: Event): Promise<void> {
    const mode = (e.target as HTMLSelectElement).value as InputSourceMode;
    this.audioInputMode = mode;
    if (mode === 'hardware') {
      this.audioDevices = await this.engine.listInputDevices();
    }
    await this.engine.setInputMode(mode, this.selectedDeviceId);
  }

  private handleSimulatorPresetChange(e: Event): void {
    const preset = (e.target as HTMLSelectElement).value as SimulatorPresetId;
    this.simulatorPreset = preset;
    this.engine.setSimulatorPreset(preset);
  }

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

  private addVirtualEqSource(): void {
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
  }

  private autoFlattenRoomModesWithEq(eqId: string): void {
    // Automatically sets inverse EQ bands matching the "2. PA Tuning (Room Modes + HF Loss)" preset
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

  private addUnionSource(): void {
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
  }

  private handleEqBandDrag(e: CustomEvent<{ bandIndex: number; frequency: number; gainDb: number }>): void {
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
  }

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

  private handleCalibrationUpload(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      this.engine.loadCalibrationFile(text, file.name);
    });
  }

  render() {
    const allSources = this.computeAllSources();
    const activeEq =
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ??
      this.eqSources.find((eq) => eq.visible) ??
      null;

    const levels = this.liveSource?.levels;
    const currentSpl = levels
      ? levels.levelsDb[this.splWeighting][this.splTime]
      : -40.0;
    const currentLeq = levels ? levels.levelsDb[this.splWeighting].Leq : -40.0;
    const currentPeak = levels ? levels.peaksDb[this.splWeighting] : -40.0;
    const delayEst = this.liveSource?.delayEstimate;

    return html`
      <!-- Top Control & SPL Monitoring Bar -->
      <header class="topbar">
        <div class="brand">
          <span>WebSoundMeter</span>
          <select
            aria-label="Chart Layout"
            data-testid="select-layout"
            .value=${this.layoutPreset}
            @change=${(e: Event) =>
              this.setLayoutPreset((e.target as HTMLSelectElement).value as LayoutPreset)}
          >
            <option value="pa-triple">PA Alignment (Mag + Phase + Impulse)</option>
            <option value="tf-dual">Transfer Function (Mag + Phase)</option>
            <option value="rta-mix">Live Mixing (RTA + Magnitude)</option>
            <option value="single">Single Chart</option>
          </select>
        </div>

        <!-- Input Mode & Built-in Demo Simulator Preset Selector -->
        <div class="toolbar-group">
          <span class="toolbar-label">Input</span>
          <select
            aria-label="Input Mode"
            data-testid="select-input-mode"
            .value=${this.audioInputMode}
            @change=${this.handleInputModeChange}
          >
            <option value="simulator">Built-in Demo Simulator</option>
            <option value="hardware">Hardware Audio Input (Mic/Interface)</option>
          </select>

          ${this.audioInputMode === 'simulator'
            ? html`
                <select
                  aria-label="Simulator Preset"
                  data-testid="select-simulator-preset"
                  .value=${this.simulatorPreset}
                  @change=${this.handleSimulatorPresetChange}
                >
                  ${Object.values(SIMULATOR_PRESETS).map(
                    (p) => html`<option value=${p.id}>${p.name}</option>`
                  )}
                </select>
              `
            : html`
                <select
                  aria-label="Audio Device"
                  .value=${this.selectedDeviceId}
                  @change=${(e: Event) => {
                    this.selectedDeviceId = (e.target as HTMLSelectElement).value;
                    this.engine.setInputMode('hardware', this.selectedDeviceId);
                  }}
                >
                  <option value="">Default Input Device</option>
                  ${this.audioDevices.map(
                    (d) => html`<option value=${d.deviceId}>${d.label}</option>`
                  )}
                </select>
              `}
        </div>

        <!-- Signal Generator Controls -->
        <div class="toolbar-group">
          <span class="toolbar-label">Gen</span>
          <button
            data-testid="btn-generator-toggle"
            class=${this.genConfig.enabled ? 'btn-accent' : ''}
            @click=${() => {
              this.engine.updateGeneratorConfig({ enabled: !this.genConfig.enabled });
              this.genConfig = { ...this.engine.getGeneratorConfig() };
            }}
          >
            ${this.genConfig.enabled ? 'ON' : 'OFF'}
          </button>
          <select
            aria-label="Generator Signal Type"
            data-testid="select-generator-type"
            .value=${this.genConfig.type}
            @change=${(e: Event) => {
              const type = (e.target as HTMLSelectElement).value as GeneratorSignalType;
              this.engine.updateGeneratorConfig({ type });
              this.genConfig = { ...this.engine.getGeneratorConfig() };
            }}
          >
            ${Object.entries(GENERATOR_SIGNAL_LABELS).map(
              ([k, label]) => html`<option value=${k}>${label}</option>`
            )}
          </select>
        </div>

        <!-- Auto Delay Finder & Capture Actions -->
        <div class="toolbar-group">
          <span class="toolbar-label" data-testid="delay-estimate-readout">
            Est Delay:
            <strong>${delayEst ? `${delayEst.delayMs.toFixed(2)} ms` : '—'}</strong>
            ${delayEst && delayEst.polarity < 0 ? html`<span style="color:#f43f5e">(−POL)</span>` : nothing}
          </span>
          <button
            class="btn-primary"
            data-testid="btn-apply-delay"
            title="Find propagation delay via cross-correlation and apply to Reference channel (Shortcut: D)"
            @click=${() => this.engine.findAndApplyDelay()}
          >
            Find & Apply Delay
          </button>
          <button
            data-testid="btn-capture-trace"
            title="Capture current trace into Stored Sources (Shortcut: Space / C)"
            @click=${() => this.captureCurrentTrace()}
          >
            Capture (Space)
          </button>
          <button
            data-testid="btn-pause"
            class=${this.isPaused ? 'btn-active' : ''}
            @click=${() => {
              this.isPaused = !this.isPaused;
              this.engine.setPaused(this.isPaused);
            }}
          >
            ${this.isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>

        <!-- Live Broadband SPL / Leq / Peak Meter Bar -->
        <div class="toolbar-group spl-readout" data-testid="spl-meter-bar">
          <select
            aria-label="SPL Weighting"
            data-testid="select-spl-weighting"
            .value=${this.splWeighting}
            @change=${(e: Event) => {
              this.splWeighting = (e.target as HTMLSelectElement).value as WeightingCurve;
            }}
          >
            <option value="A">dBA</option>
            <option value="C">dBC</option>
            <option value="Z">dBZ</option>
          </select>
          <select
            aria-label="SPL Integration Time"
            .value=${this.splTime}
            @change=${(e: Event) => {
              this.splTime = (e.target as HTMLSelectElement).value as MeterIntegrationTime;
            }}
          >
            <option value="Fast">Fast</option>
            <option value="Slow">Slow</option>
            <option value="Impulse">Impulse</option>
          </select>
          <div class="spl-main-value" data-testid="spl-main-value">
            ${currentSpl.toFixed(1)} dB${this.splWeighting}
          </div>
          <div class="spl-sub-value">
            <div>Leq: <strong>${currentLeq.toFixed(1)}</strong></div>
            <div>Pk: <strong>${currentPeak.toFixed(1)}</strong></div>
          </div>
        </div>
      </header>

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
                  <strong>Demo Mode Active:</strong> ${SIMULATOR_PRESETS[this.simulatorPreset].description}
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
                    data-testid="source-row-${src.id}"
                    @click=${() => {
                      this.selectedSourceId = src.id;
                    }}
                  >
                    <div class="source-row-left">
                      <input
                        type="checkbox"
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

  private toggleSourceVisibility(id: string, visible: boolean): void {
    if (id === 'live-measurement' && this.liveSource) {
      this.liveSource = { ...this.liveSource, visible };
    } else if (id.startsWith('stored-')) {
      this.storedSources = this.storedSources.map((s) =>
        s.id === id ? { ...s, visible } : s
      );
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
    if (this.selectedSourceId === 'live-measurement') {
      return this.renderLiveMeasurementInspector();
    }

    const stored = this.storedSources.find((s) => s.id === this.selectedSourceId);
    if (stored) {
      return this.renderStoredInspector(stored);
    }

    const eq = this.eqSources.find((s) => s.id === this.selectedSourceId);
    if (eq) {
      return this.renderEqInspector(eq, allSources);
    }

    const union = this.unionSources.find((s) => s.id === this.selectedSourceId);
    if (union) {
      return this.renderUnionInspector(union, allSources);
    }

    return this.renderLiveMeasurementInspector();
  }

  private renderLiveMeasurementInspector() {
    const cfg = this.measConfig;
    return html`
      <div class="section-card" data-testid="inspector-live-measurement">
        <div class="section-header">
          <span>Live Measurement Settings</span>
          <button @click=${() => this.engine.resetAveraging()}>Reset Avg</button>
        </div>

        <div class="prop-grid">
          <div class="prop-field">
            <label>FFT Size</label>
            <select
              data-testid="select-fft-size"
              .value=${String(cfg.fftSize)}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  fftSize: Number((e.target as HTMLSelectElement).value),
                })}
            >
              <option value="1024">1024 (21 ms)</option>
              <option value="2048">2048 (43 ms)</option>
              <option value="4096">4096 (85 ms)</option>
              <option value="8192">8192 (171 ms)</option>
              <option value="16384">16384 (341 ms)</option>
              <option value="32768">32768 (683 ms)</option>
            </select>
          </div>

          <div class="prop-field">
            <label>Window Function</label>
            <select
              .value=${cfg.windowType}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  windowType: (e.target as HTMLSelectElement).value as WindowFunctionType,
                })}
            >
              ${Object.entries(WINDOW_FUNCTION_LABELS).map(
                ([k, label]) => html`<option value=${k}>${label}</option>`
              )}
            </select>
          </div>

          <div class="prop-field">
            <label>Averaging Mode</label>
            <select
              .value=${cfg.averagingType}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  averagingType: (e.target as HTMLSelectElement).value as AveragingType,
                })}
            >
              <option value="fifo">FIFO Window</option>
              <option value="lpf">LPF / Exponential</option>
              <option value="off">Off (Instant)</option>
            </select>
          </div>

          <div class="prop-field">
            <label>FIFO Averages</label>
            <select
              .value=${String(cfg.fifoDepth)}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  fifoDepth: Number((e.target as HTMLSelectElement).value),
                })}
            >
              <option value="4">4 Frames</option>
              <option value="8">8 Frames</option>
              <option value="16">16 Frames</option>
              <option value="32">32 Frames</option>
              <option value="64">64 Frames</option>
            </select>
          </div>

          <div class="prop-field">
            <label>Octave Smoothing</label>
            <select
              data-testid="select-smoothing"
              .value=${cfg.octaveSmoothing}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  octaveSmoothing: (e.target as HTMLSelectElement).value as OctaveSmoothingType,
                })}
            >
              <option value="off">None (Narrowband)</option>
              <option value="1/48">1/48 Octave</option>
              <option value="1/24">1/24 Octave</option>
              <option value="1/12">1/12 Octave</option>
              <option value="1/6">1/6 Octave</option>
              <option value="1/3">1/3 Octave</option>
              <option value="1/1">1 Octave</option>
            </select>
          </div>

          <div class="prop-field">
            <label>TF Estimator</label>
            <select
              .value=${cfg.estimator}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  estimator: (e.target as HTMLSelectElement).value as TransferEstimatorType,
                })}
            >
              <option value="h1">H1 Cross-Spectrum</option>
              <option value="ratio">|M| / |R| Ratio</option>
            </select>
          </div>

          <div class="prop-field">
            <label>Ref Delay (ms)</label>
            <input
              type="number"
              step="0.1"
              data-testid="input-ref-delay-ms"
              .value=${String(cfg.delayMs)}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  delayMs: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>

          <div class="prop-field">
            <label>Input Gain (dB)</label>
            <input
              type="number"
              step="0.5"
              .value=${String(cfg.gainDb)}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  gainDb: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>

          <div class="prop-field">
            <label>Input Filter</label>
            <select
              .value=${cfg.inputFilter}
              @change=${(e: Event) =>
                this.engine.updateMeasurementConfig({
                  inputFilter: (e.target as HTMLSelectElement).value as InputPreFilterType,
                })}
            >
              <option value="Z">Z (Flat / None)</option>
              <option value="A">A-Weighting</option>
              <option value="C">C-Weighting</option>
              <option value="notch-1k">1 kHz Notch</option>
            </select>
          </div>

          <div class="prop-field">
            <label>Polarity</label>
            <button
              class=${cfg.invertPolarity ? 'btn-active' : ''}
              @click=${() =>
                this.engine.updateMeasurementConfig({ invertPolarity: !cfg.invertPolarity })}
            >
              ${cfg.invertPolarity ? 'Inverted (−180°)' : 'Normal (+)'}
            </button>
          </div>

          <div class="prop-field full-width">
            <label>Mic Calibration (.cal / .txt)</label>
            <input type="file" accept=".cal,.txt,.frd" @change=${this.handleCalibrationUpload} />
          </div>
        </div>
      </div>
    `;
  }

  private renderStoredInspector(stored: SourceData) {
    return html`
      <div class="section-card" data-testid="inspector-stored-source">
        <div class="section-header">
          <span>Stored Trace</span>
          <button
            style="color:#f43f5e;"
            @click=${() => this.deleteStoredSource(stored.id)}
          >
            Delete
          </button>
        </div>

        <div class="prop-grid">
          <div class="prop-field full-width">
            <label>Trace Name</label>
            <input
              type="text"
              .value=${stored.name}
              @input=${(e: Event) => {
                const name = (e.target as HTMLInputElement).value;
                this.storedSources = this.storedSources.map((s) =>
                  s.id === stored.id ? { ...s, name } : s
                );
              }}
            />
          </div>

          <div class="prop-field">
            <label>Gain Offset (dB)</label>
            <input
              type="number"
              step="0.5"
              .value=${String(stored.gainOffsetDb)}
              @input=${(e: Event) => {
                const gainOffsetDb = Number((e.target as HTMLInputElement).value);
                this.storedSources = this.storedSources.map((s) =>
                  s.id === stored.id ? { ...s, gainOffsetDb } : s
                );
              }}
            />
          </div>

          <div class="prop-field">
            <label>Delay Offset (ms)</label>
            <input
              type="number"
              step="0.1"
              .value=${String(stored.delayOffsetMs)}
              @input=${(e: Event) => {
                const delayOffsetMs = Number((e.target as HTMLInputElement).value);
                this.storedSources = this.storedSources.map((s) =>
                  s.id === stored.id ? { ...s, delayOffsetMs } : s
                );
              }}
            />
          </div>
        </div>
        <div style="font-size:11px;color:#94a3b8;">${stored.notes}</div>
      </div>
    `;
  }

  private renderEqInspector(eq: EqualizerSourceConfig, allSources: SourceData[]) {
    const candidateTargets = allSources.filter((s) => s.kind === 'measurement' || s.kind === 'stored');
    return html`
      <div class="section-card" data-testid="inspector-eq-source">
        <div class="section-header">
          <span>${eq.name}</span>
          <button
            class="btn-accent"
            data-testid="btn-auto-flatten-eq"
            title="Load corrective inverse EQ matching the PA Room Modes simulator preset"
            @click=${() => this.autoFlattenRoomModesWithEq(eq.id)}
          >
            Auto-Match Room
          </button>
        </div>

        <div class="prop-field full-width">
          <label>Apply Virtual EQ To Source</label>
          <select
            .value=${eq.targetSourceId ?? ''}
            @change=${(e: Event) => {
              const targetSourceId = (e.target as HTMLSelectElement).value || null;
              this.eqSources = this.eqSources.map((item) =>
                item.id === eq.id ? { ...item, targetSourceId } : item
              );
            }}
          >
            <option value="">None (Show Filter Curve Only)</option>
            ${candidateTargets.map(
              (s) => html`<option value=${s.id} ?selected=${s.id === eq.targetSourceId}>${s.name}</option>`
            )}
          </select>
        </div>

        <div style="font-size:10px;color:#94a3b8;">
          Tip: Drag green EQ handles directly on the Magnitude chart!
        </div>

        ${eq.bands.map(
          (b, idx) => html`
            <div class="eq-band-row">
              <input
                type="checkbox"
                .checked=${b.enabled !== false}
                @change=${(e: Event) => {
                  const enabled = (e.target as HTMLInputElement).checked;
                  this.updateEqBand(eq.id, idx, { enabled });
                }}
              />
              <select
                .value=${b.type}
                @change=${(e: Event) => {
                  const type = (e.target as HTMLSelectElement).value as BiquadFilterType;
                  this.updateEqBand(eq.id, idx, { type });
                }}
              >
                <option value="peaking">Bell</option>
                <option value="lowshelf">LShelf</option>
                <option value="highshelf">HShelf</option>
                <option value="highpass">HPF</option>
                <option value="lowpass">LPF</option>
                <option value="allpass">AllPass</option>
              </select>
              <input
                type="number"
                title="Frequency (Hz)"
                .value=${String(b.frequency)}
                @input=${(e: Event) =>
                  this.updateEqBand(eq.id, idx, {
                    frequency: Number((e.target as HTMLInputElement).value),
                  })}
              />
              <input
                type="number"
                step="0.5"
                title="Gain (dB)"
                .value=${String(b.gainDb ?? 0)}
                @input=${(e: Event) =>
                  this.updateEqBand(eq.id, idx, {
                    gainDb: Number((e.target as HTMLInputElement).value),
                  })}
              />
              <input
                type="number"
                step="0.1"
                title="Q Factor"
                .value=${String(b.q ?? 0.7)}
                @input=${(e: Event) =>
                  this.updateEqBand(eq.id, idx, {
                    q: Number((e.target as HTMLInputElement).value),
                  })}
              />
            </div>
          `
        )}
      </div>
    `;
  }

  private updateEqBand(
    eqId: string,
    bandIdx: number,
    partial: Partial<EqualizerSourceConfig['bands'][number]>
  ): void {
    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== eqId) return eq;
      const bands = eq.bands.map((b, i) => (i === bandIdx ? { ...b, ...partial } : b));
      return { ...eq, bands };
    });
  }

  private renderUnionInspector(union: UnionSourceConfig, allSources: SourceData[]) {
    const candidates = allSources.filter((s) => s.id !== union.id);
    return html`
      <div class="section-card" data-testid="inspector-union-source">
        <div class="section-header">
          <span>${union.name}</span>
        </div>

        <div class="prop-grid">
          <div class="prop-field full-width">
            <label>Math Operation</label>
            <select
              .value=${union.operation}
              @change=${(e: Event) => {
                const operation = (e.target as HTMLSelectElement).value as UnionOperation;
                this.unionSources = this.unionSources.map((u) =>
                  u.id === union.id ? { ...u, operation } : u
                );
              }}
            >
              ${Object.entries(UNION_OPERATION_LABELS).map(
                ([k, label]) => html`<option value=${k}>${label}</option>`
              )}
            </select>
          </div>

          <div class="prop-field">
            <label>Source A</label>
            <select
              .value=${union.sourceIds[0] ?? ''}
              @change=${(e: Event) => {
                const srcA = (e.target as HTMLSelectElement).value;
                this.unionSources = this.unionSources.map((u) =>
                  u.id === union.id ? { ...u, sourceIds: [srcA, u.sourceIds[1] ?? srcA] } : u
                );
              }}
            >
              ${candidates.map(
                (s) => html`<option value=${s.id} ?selected=${s.id === union.sourceIds[0]}>${s.name}</option>`
              )}
            </select>
          </div>

          <div class="prop-field">
            <label>Source B</label>
            <select
              .value=${union.sourceIds[1] ?? ''}
              @change=${(e: Event) => {
                const srcB = (e.target as HTMLSelectElement).value;
                this.unionSources = this.unionSources.map((u) =>
                  u.id === union.id ? { ...u, sourceIds: [u.sourceIds[0] ?? srcB, srcB] } : u
                );
              }}
            >
              ${candidates.map(
                (s) => html`<option value=${s.id} ?selected=${s.id === union.sourceIds[1]}>${s.name}</option>`
              )}
            </select>
          </div>
        </div>
      </div>
    `;
  }
}
