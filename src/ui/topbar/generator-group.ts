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

import { html, TemplateResult } from 'lit';
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
  readonly onToggleGenerator: () => void;
  readonly onGeneratorTypeChange: (type: GeneratorSignalType) => void;
  readonly onGeneratorLevelChange: (levelDbFs: number) => void;
  readonly onGeneratorOutputChannelChange: (outCh: number) => void;
}

export function renderGeneratorGroup(props: GeneratorGroupProps): TemplateResult {
  const outputChannelIndices = Array.from({ length: props.availableOutputChannels }, (_, i) => i);

  return html`
    <div class="toolbar-group">
      <span class="toolbar-label">Gen</span>
      <button
        data-testid="btn-generator-toggle"
        class="btn-toggle-gen ${props.genConfig.enabled ? 'btn-accent' : ''}"
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
      <select
        aria-label="Generator Level (dBFS)"
        data-testid="select-generator-level"
        title="Generator Output Level (dBFS)"
        .value=${String(props.genConfig.levelDbFs)}
        @change=${(e: Event) =>
          props.onGeneratorLevelChange(Number((e.target as HTMLSelectElement).value))}
      >
        <option value="-6">-6 dBFS</option>
        <option value="-12">-12 dBFS</option>
        <option value="-18">-18 dBFS</option>
        <option value="-24">-24 dBFS</option>
      </select>
      ${props.audioInputMode === 'hardware'
        ? html`
            <span class="toolbar-label" title="Hardware Audio Output Channel for Signal Generator"
              >Out:</span
            >
            <select
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
          `
        : ''}
    </div>
  `;
}

