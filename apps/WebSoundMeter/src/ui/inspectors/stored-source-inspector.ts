// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { html, nothing, TemplateResult } from 'lit';
import { SourceData } from '../../sources/source-data.js';

export interface StoredInspectorHandlers {
  readonly onDelete: (id: string) => void;
  readonly onUpdateStored: (
    id: string,
    partial: Partial<Pick<SourceData, 'name' | 'gainOffsetDb' | 'delayOffsetMs' | 'invertPolarity'>>
  ) => void;
  readonly onExportFrd?: (stored: SourceData) => void;
}

export function renderStoredInspector(
  stored: SourceData,
  handlers: StoredInspectorHandlers
): TemplateResult {
  return html`
    <div class="section-card" data-testid="inspector-stored-source">
      <div class="section-header">
        <span>Stored Trace</span>
        <div style="display:flex;gap:4px;">
          ${handlers.onExportFrd
            ? html`
                <button
                  data-testid="btn-export-stored-frd"
                  title="Export Magnitude + Phase trace as .frd file"
                  @click=${() => handlers.onExportFrd?.(stored)}
                >
                  Export .FRD
                </button>
              `
            : nothing}
          <button style="color:#f43f5e;" @click=${() => handlers.onDelete(stored.id)}>
            Delete
          </button>
        </div>
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
