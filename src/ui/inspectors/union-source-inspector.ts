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
import { SourceData } from '../../sources/source-data.js';
import {
  UNION_OPERATION_LABELS,
  UnionOperation,
  UnionSourceConfig,
} from '../../sources/union-source.js';

export interface UnionInspectorHandlers {
  readonly onUpdateUnion: (
    unionId: string,
    partial: Partial<Pick<UnionSourceConfig, 'operation' | 'sourceIds'>>
  ) => void;
  readonly onDelete?: (unionId: string) => void;
}

export function renderUnionInspector(
  union: UnionSourceConfig,
  allSources: readonly SourceData[],
  handlers: UnionInspectorHandlers
): TemplateResult {
  const candidates = allSources.filter((s) => s.id !== union.id);
  return html`
    <div class="section-card" data-testid="inspector-union-source">
      <div class="section-header">
        <span>${union.name}</span>
        ${handlers.onDelete
          ? html`
              <button
                style="color:#f43f5e;"
                @click=${() => handlers.onDelete?.(union.id)}
              >
                Delete
              </button>
            `
          : nothing}
      </div>

      <div class="prop-grid">
        <div class="prop-field full-width">
          <label>Math Operation</label>
          <select
            aria-label="Union Math Operation"
            .value=${union.operation}
            @change=${(e: Event) =>
              handlers.onUpdateUnion(union.id, {
                operation: (e.target as HTMLSelectElement).value as UnionOperation,
              })}
          >
            ${Object.entries(UNION_OPERATION_LABELS).map(
              ([k, label]) => html`<option value=${k}>${label}</option>`
            )}
          </select>
        </div>

        <div class="prop-field">
          <label>Source A</label>
          <select
            aria-label="Union Source A"
            .value=${union.sourceIds[0] ?? ''}
            @change=${(e: Event) => {
              const srcA = (e.target as HTMLSelectElement).value;
              handlers.onUpdateUnion(union.id, {
                sourceIds: [srcA, union.sourceIds[1] ?? srcA],
              });
            }}
          >
            ${candidates.map(
              (s) =>
                html`<option value=${s.id} ?selected=${s.id === union.sourceIds[0]}>
                  ${s.name}
                </option>`
            )}
          </select>
        </div>

        <div class="prop-field">
          <label>Source B</label>
          <select
            aria-label="Union Source B"
            .value=${union.sourceIds[1] ?? ''}
            @change=${(e: Event) => {
              const srcB = (e.target as HTMLSelectElement).value;
              handlers.onUpdateUnion(union.id, {
                sourceIds: [union.sourceIds[0] ?? srcB, srcB],
              });
            }}
          >
            ${candidates.map(
              (s) =>
                html`<option value=${s.id} ?selected=${s.id === union.sourceIds[1]}>
                  ${s.name}
                </option>`
            )}
          </select>
        </div>
      </div>
    </div>
  `;
}
