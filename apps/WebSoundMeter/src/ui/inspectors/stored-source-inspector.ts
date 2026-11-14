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
import { SourceData } from '../../sources/source-data.js';

export interface StoredInspectorHandlers {
  readonly onDelete: (id: string) => void;
  readonly onUpdateStored: (
    id: string,
    partial: Partial<Pick<SourceData, 'name' | 'gainOffsetDb' | 'delayOffsetMs'>>
  ) => void;
}

export function renderStoredInspector(
  stored: SourceData,
  handlers: StoredInspectorHandlers
): TemplateResult {
  return html`
    <div class="section-card" data-testid="inspector-stored-source">
      <div class="section-header">
        <span>Stored Trace</span>
        <button style="color:#f43f5e;" @click=${() => handlers.onDelete(stored.id)}>
          Delete
        </button>
      </div>

      <div class="prop-grid">
        <div class="prop-field full-width">
          <label>Trace Name</label>
          <input
            type="text"
            aria-label="Stored Trace Name"
            .value=${stored.name}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                name: (e.target as HTMLInputElement).value,
              })}
          />
        </div>

        <div class="prop-field">
          <label>Gain Offset (dB)</label>
          <input
            type="number"
            step="0.5"
            aria-label="Stored Gain Offset (dB)"
            .value=${String(stored.gainOffsetDb)}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                gainOffsetDb: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>

        <div class="prop-field">
          <label>Delay Offset (ms)</label>
          <input
            type="number"
            step="0.1"
            aria-label="Stored Delay Offset (ms)"
            .value=${String(stored.delayOffsetMs)}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                delayOffsetMs: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>
      </div>
      <div style="font-size:11px;color:#94a3b8;">${stored.notes}</div>
    </div>
  `;
}

