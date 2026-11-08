import { html, nothing, TemplateResult } from 'lit';
import { AudioDeviceOption } from '../audio/audio-engine.js';
import { DelayEstimate } from '../dsp/deconvolution.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  GENERATOR_SIGNAL_LABELS,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import { SIMULATOR_PRESETS, SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  BroadbandLevelsSnapshot,
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import type { LayoutPreset } from './app-shell.js';

export interface TopbarViewProps {
  readonly layoutPreset: LayoutPreset;
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly audioDevices: readonly AudioDeviceOption[];
  readonly selectedDeviceId: string;
  readonly genConfig: SignalGeneratorConfig;
  readonly isPaused: boolean;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly delayEstimate?: DelayEstimate;
  readonly onLayoutPresetChange: (preset: LayoutPreset) => void;
  readonly onInputModeChange: (e: Event) => void;
  readonly onSimulatorPresetChange: (e: Event) => void;
  readonly onDeviceChange: (deviceId: string) => void;
  readonly onToggleGenerator: () => void;
  readonly onGeneratorTypeChange: (type: GeneratorSignalType) => void;
  readonly onFindAndApplyDelay: () => void;
  readonly onCaptureTrace: () => void;
  readonly onTogglePause: () => void;
  readonly onSplWeightingChange: (curve: WeightingCurve) => void;
  readonly onSplTimeChange: (time: MeterIntegrationTime) => void;
}

export function renderTopbar(props: TopbarViewProps): TemplateResult {
  const { levels, delayEstimate: delayEst } = props;
  const currentSpl = levels ? levels.levelsDb[props.splWeighting][props.splTime] : -40.0;
  const currentLeq = levels ? levels.levelsDb[props.splWeighting].Leq : -40.0;
  const currentPeak = levels ? levels.peaksDb[props.splWeighting] : -40.0;

  return html`
    <header class="topbar">
      <div class="brand">
        <span>WebSoundMeter</span>
        <select
          aria-label="Chart Layout"
          data-testid="select-layout"
          .value=${props.layoutPreset}
          @change=${(e: Event) =>
            props.onLayoutPresetChange((e.target as HTMLSelectElement).value as LayoutPreset)}
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
          .value=${props.audioInputMode}
          @change=${props.onInputModeChange}
        >
          <option value="simulator">Built-in Demo Simulator</option>
          <option value="hardware">Hardware Audio Input (Mic/Interface)</option>
        </select>

        ${props.audioInputMode === 'simulator'
          ? html`
              <select
                aria-label="Simulator Preset"
                data-testid="select-simulator-preset"
                .value=${props.simulatorPreset}
                @change=${props.onSimulatorPresetChange}
              >
                ${Object.values(SIMULATOR_PRESETS).map(
                  (p) => html`<option value=${p.id}>${p.name}</option>`
                )}
              </select>
            `
          : html`
              <select
                aria-label="Audio Device"
                .value=${props.selectedDeviceId}
                @change=${(e: Event) =>
                  props.onDeviceChange((e.target as HTMLSelectElement).value)}
              >
                <option value="">Default Input Device</option>
                ${props.audioDevices.map(
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
          class=${props.genConfig.enabled ? 'btn-accent' : ''}
          @click=${props.onToggleGenerator}
        >
          ${props.genConfig.enabled ? 'ON' : 'OFF'}
        </button>
        <select
          aria-label="Generator Signal Type"
          data-testid="select-generator-type"
          .value=${props.genConfig.type}
          @change=${(e: Event) =>
            props.onGeneratorTypeChange(
              (e.target as HTMLSelectElement).value as GeneratorSignalType
            )}
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
          <strong data-testid="estimated-delay-ms"
            >${delayEst ? `${delayEst.delayMs.toFixed(2)} ms` : '—'}</strong
          >
          ${delayEst && delayEst.polarity < 0
            ? html`<span style="color:#f43f5e">(−POL)</span>`
            : nothing}
        </span>
        <button
          class="btn-primary"
          data-testid="btn-apply-delay"
          title="Find propagation delay via cross-correlation and apply to Reference channel (Shortcut: D)"
          @click=${props.onFindAndApplyDelay}
        >
          Find & Apply Delay
        </button>
        <button
          data-testid="btn-capture-trace"
          title="Capture current trace into Stored Sources (Shortcut: Space / C)"
          @click=${props.onCaptureTrace}
        >
          Capture (Space)
        </button>
        <button
          data-testid="btn-pause"
          class=${props.isPaused ? 'btn-active' : ''}
          @click=${props.onTogglePause}
        >
          ${props.isPaused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <!-- Live Broadband SPL / Leq / Peak Meter Bar -->
      <div class="toolbar-group spl-readout" data-testid="spl-meter-bar">
        <select
          aria-label="SPL Weighting"
          data-testid="select-spl-weighting"
          .value=${props.splWeighting}
          @change=${(e: Event) =>
            props.onSplWeightingChange((e.target as HTMLSelectElement).value as WeightingCurve)}
        >
          <option value="A">dBA</option>
          <option value="C">dBC</option>
          <option value="Z">dBZ</option>
        </select>
        <select
          aria-label="SPL Integration Time"
          .value=${props.splTime}
          @change=${(e: Event) =>
            props.onSplTimeChange(
              (e.target as HTMLSelectElement).value as MeterIntegrationTime
            )}
        >
          <option value="Fast">Fast</option>
          <option value="Slow">Slow</option>
          <option value="Impulse">Impulse</option>
        </select>
        <div class="spl-main-value" data-testid="spl-main-value">
          ${currentSpl.toFixed(1)} dB${props.splWeighting}
        </div>
        <div class="spl-sub-value">
          <div>Leq: <strong>${currentLeq.toFixed(1)}</strong></div>
          <div>Pk: <strong>${currentPeak.toFixed(1)}</strong></div>
        </div>
      </div>
    </header>
  `;
}

