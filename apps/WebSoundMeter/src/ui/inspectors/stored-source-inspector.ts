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
    <div
      class="foh-form-section"
      data-testid="inspector-stored-source"
      data-doc-region="stored-inspector"
    >
      <div class="foh-form-section-title">
        <span>Stored Trace</span>
        <div style="display:flex;gap:4px;">
          ${handlers.onExportFrd
            ? html`
                <button
                  type="button"
                  class="foh-btn foh-btn-xs"
                  data-testid="btn-export-stored-frd"
                  title="Export Magnitude + Phase trace as .frd file"
                  @click=${() => handlers.onExportFrd?.(stored)}
                >
                  Export .FRD
                </button>
              `
            : nothing}
          <button
            type="button"
            class="foh-btn foh-btn-xs foh-btn-danger"
            @click=${() => handlers.onDelete(stored.id)}
          >
            Delete
          </button>
        </div>
      </div>

      <div class="foh-xy-grid">
        <div class="foh-mini-field full-width">
          <label for="wsm-stored-name">Trace Name</label>
          <input
            type="text"
            id="wsm-stored-name"
            name="stored-trace-name"
            aria-label="Stored Trace Name"
            .value=${stored.name}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                name: (e.target as HTMLInputElement).value,
              })}
          />
        </div>

        <div class="foh-mini-field">
          <label for="wsm-stored-gain">Gain Offset (dB)</label>
          <input
            type="number"
            id="wsm-stored-gain"
            name="stored-gain-offset-db"
            step="0.5"
            aria-label="Stored Gain Offset (dB)"
            .value=${String(stored.gainOffsetDb)}
            @input=${(e: Event) =>
              handlers.onUpdateStored(stored.id, {
                gainOffsetDb: Number((e.target as HTMLInputElement).value),
              })}
          />
        </div>

        <div class="foh-mini-field">
          <label for="wsm-stored-delay">Delay Offset (ms)</label>
          <input
            type="number"
            id="wsm-stored-delay"
            name="stored-delay-offset-ms"
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
      ${stored.notes
        ? html`<div class="foh-insp-subtitle">${stored.notes}</div>`
        : nothing}
    </div>
  `;
}
