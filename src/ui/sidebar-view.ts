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

import { html, nothing, TemplateResult } from 'lit';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import { SIMULATOR_PRESETS, SimulatorPresetId } from '../dsp/synthetic-rig.js';
import { SourceData } from '../sources/source-data.js';

export interface SidebarViewProps {
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly allSources: readonly SourceData[];
  readonly selectedSourceId: string;
  readonly inspectorContent: TemplateResult;
  readonly onAddEqSource: () => void;
  readonly onAddUnionSource: () => void;
  readonly onSelectSource: (id: string) => void;
  readonly onToggleSourceVisibility: (id: string, visible: boolean) => void;
}

export function renderSidebar(props: SidebarViewProps): TemplateResult {
  return html`
    <aside class="sidebar">
      ${props.audioInputMode === 'simulator'
        ? html`
            <div class="sim-banner" data-testid="simulator-description">
              <strong>Demo Mode Active:</strong>
              ${SIMULATOR_PRESETS[props.simulatorPreset].description}
            </div>
          `
        : nothing}

      <!-- Sources List Card -->
      <div class="section-card">
        <div class="section-header">
          <span>Sources (${props.allSources.length})</span>
          <div style="display:flex;gap:4px;">
            <button
              data-testid="btn-add-eq"
              title="Add Virtual Parametric EQ Source"
              @click=${props.onAddEqSource}
            >
              + EQ
            </button>
            <button
              data-testid="btn-add-union"
              title="Add Math / Union Source"
              @click=${props.onAddUnionSource}
            >
              + Math
            </button>
          </div>
        </div>

        <div class="source-list" data-testid="source-list">
          ${props.allSources.map(
            (src) => html`
              <div
                class="source-row ${props.selectedSourceId === src.id ? 'selected' : ''}"
                data-testid="source-item-${src.id}"
                @click=${() => props.onSelectSource(src.id)}
              >
                <div class="source-row-left">
                  <input
                    type="checkbox"
                    aria-label="Toggle visibility for ${src.name}"
                    .checked=${src.visible}
                    @click=${(e: Event) => e.stopPropagation()}
                    @change=${(e: Event) => {
                      const vis = (e.target as HTMLInputElement).checked;
                      props.onToggleSourceVisibility(src.id, vis);
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
      ${props.inspectorContent}
    </aside>
  `;
}
