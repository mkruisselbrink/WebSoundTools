// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type PopoverParentRootLike,
  renderChevronDownSvg,
  renderSineWaveIconSvg,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
import { html, nothing, TemplateResult } from 'lit';
import { InputSourceMode } from '../../dsp/dsp.worker.js';
import {
  GENERATOR_SIGNAL_LABELS,
  GeneratorSignalType,
  SignalGeneratorConfig,
} from '../../dsp/signal-generator.js';

export interface GeneratorGroupProps {
  readonly audioInputMode: InputSourceMode;
  readonly availableOutputChannels: number;
  readonly generatorOutputChannel: number;
  readonly genConfig: SignalGeneratorConfig;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onToggleGenerator: () => void;
  readonly onGeneratorTypeChange: (type: GeneratorSignalType) => void;
  readonly onGeneratorLevelChange: (levelDbFs: number) => void;
  readonly onGeneratorOutputChannelChange: (outCh: number) => void;
}

const SHORT_SIGNAL_NAMES: Record<GeneratorSignalType, string> = {
  pink: 'Pink',
  white: 'White',
  brown: 'Brown',
  burst: 'Burst',
  sine: 'Sine',
  sweep: 'Sweep',
};

export function renderGeneratorGroup(props: GeneratorGroupProps): TemplateResult {
  const outputChannelIndices = Array.from(
    { length: props.availableOutputChannels },
    (_, i) => i
  );
  const shortSig = SHORT_SIGNAL_NAMES[props.genConfig.type] ?? 'Pink';
  const outSummary =
    props.audioInputMode === 'hardware'
      ? props.generatorOutputChannel === -1
        ? ' · Out 1+2'
        : props.generatorOutputChannel === -2
          ? ' · Muted'
          : ` · Out ${props.generatorOutputChannel + 1}`
      : '';

  return html`
    <div class="foh-topbar-zone" role="group" aria-label="Signal Generator">
      <div class="foh-split-pill">
        <button
          type="button"
          class="wsm-gen-toggle-btn"
          data-testid="btn-generator-toggle"
          data-variant="gen"
          aria-label="Signal Generator"
          aria-pressed=${String(props.genConfig.enabled)}
          title="Toggle Signal Generator On / Off"
          @click=${props.onToggleGenerator}
        >
          ${renderSineWaveIconSvg()}
          <span class="foh-hide-below-narrow"
            >Gen<span class="foh-hide-below-medium"
              >${props.genConfig.enabled ? ' ON' : ''}</span
            ></span
          >
        </button>
        <button
          type="button"
          class="wsm-gen-summary-btn"
          data-testid="btn-gen-popover"
          data-popover-trigger="wsm-gen-popover"
          popovertarget="wsm-gen-popover"
          aria-label="Signal Generator Settings"
          aria-expanded="false"
          title="Signal Generator Waveform, Level & Output Routing"
        >
          <span class="foh-hide-below-xlarge"
            >${shortSig} ${props.genConfig.levelDbFs}dB${outSummary}</span
          >
          ${renderChevronDownSvg()}
        </button>
      </div>

      <div
        id="wsm-gen-popover"
        popover="auto"
        class="foh-popover"
        data-doc-region="gen-popover"
        @toggle=${(ev: Event) => {
          if (props.popoverRoot) syncAnchoredPopoverToggle(ev, props.popoverRoot);
        }}
      >
        <div class="foh-popover-title">Signal Generator</div>
        <div class="foh-popover-grid">
          <div class="foh-popover-row">
            <label for="wsm-select-generator-type">Signal Waveform</label>
            <select
              id="wsm-select-generator-type"
              name="generator-signal-type"
              aria-label="Generator Signal Type"
              data-testid="select-generator-type"
              .value=${props.genConfig.type}
              @change=${(e: Event) =>
                props.onGeneratorTypeChange(
                  (e.target as HTMLSelectElement).value as GeneratorSignalType
                )}
            >
              ${Object.entries(GENERATOR_SIGNAL_LABELS).map(
                ([k, label]) =>
                  html`<option value=${k} ?selected=${props.genConfig.type === k}>
                    ${label}
                  </option>`
              )}
            </select>
          </div>

          <div class="foh-popover-row">
            <label for="wsm-select-generator-level">Output Level (dBFS)</label>
            <select
              id="wsm-select-generator-level"
              name="generator-level-dbfs"
              aria-label="Generator Level (dBFS)"
              data-testid="select-generator-level"
              .value=${String(props.genConfig.levelDbFs)}
              @change=${(e: Event) =>
                props.onGeneratorLevelChange(
                  Number((e.target as HTMLSelectElement).value)
                )}
            >
              <option value="0" ?selected=${props.genConfig.levelDbFs === 0}>
                0 dBFS (Hot)
              </option>
              <option value="-3" ?selected=${props.genConfig.levelDbFs === -3}>
                -3 dBFS
              </option>
              <option value="-6" ?selected=${props.genConfig.levelDbFs === -6}>
                -6 dBFS
              </option>
              <option value="-12" ?selected=${props.genConfig.levelDbFs === -12}>
                -12 dBFS
              </option>
              <option value="-18" ?selected=${props.genConfig.levelDbFs === -18}>
                -18 dBFS
              </option>
              <option value="-24" ?selected=${props.genConfig.levelDbFs === -24}>
                -24 dBFS
              </option>
            </select>
          </div>

          ${props.audioInputMode === 'hardware'
            ? html`
                <div class="foh-popover-row">
                  <label for="wsm-select-generator-output">Hardware Output Channel</label>
                  <select
                    id="wsm-select-generator-output"
                    name="generator-output-channel"
                    aria-label="Generator Output Channel"
                    data-testid="select-generator-output-channel"
                    .value=${String(props.generatorOutputChannel)}
                    @change=${(e: Event) =>
                      props.onGeneratorOutputChannelChange(
                        Number((e.target as HTMLSelectElement).value)
                      )}
                  >
                    <option value="-1" ?selected=${props.generatorOutputChannel === -1}>
                      Out Ch 1+2
                    </option>
                    ${outputChannelIndices.map(
                      (ch) =>
                        html`<option
                          value=${String(ch)}
                          ?selected=${ch === props.generatorOutputChannel}
                        >
                          Out Ch ${ch + 1}
                        </option>`
                    )}
                    <option value="-2" ?selected=${props.generatorOutputChannel === -2}>
                      Mute Out
                    </option>
                  </select>
                </div>
              `
            : nothing}
        </div>
      </div>
    </div>
  `;
}
