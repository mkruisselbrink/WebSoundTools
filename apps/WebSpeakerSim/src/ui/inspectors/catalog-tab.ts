// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Built-in and custom loudspeaker catalog list tab for `<wss-speaker-library-modal>`.
 */

import { html, type TemplateResult } from 'lit';
import type { SpeakerDefinition } from '../../library/speaker-schema.js';

export function renderCatalogTab(params: {
  readonly allSpeakers: readonly SpeakerDefinition[];
  readonly onExportJson: (spk: SpeakerDefinition) => void;
  readonly onDeleteCustom: (speakerId: string) => void;
}): TemplateResult {
  const { allSpeakers, onExportJson, onDeleteCustom } = params;
  return html`
    <div class="spk-list" data-testid="catalog-speaker-list">
      ${allSpeakers.map(
        (spk) => html`
          <div class="spk-card" data-testid="catalog-item-${spk.id}">
            <div>
              <div>
                <strong>${spk.name}</strong>
                <span style="color:#94a3b8"> — ${spk.manufacturer}</span>
                <span class="badge">${spk.origin}</span>
                <span class="badge">${spk.category}</span>
              </div>
              <div class="spk-meta">
                ${spk.nominalDispersionDeg.horizontal}°×${spk.nominalDispersionDeg.vertical}° ·
                ${spk.passbandHz.low3dB}–${spk.passbandHz.high3dB} Hz · Max 1m:
                ${spk.maxContinuousSpl1mDb} dB SPL
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn" @click=${() => onExportJson(spk)}>JSON</button>
              ${spk.origin !== 'builtin'
                ? html`
                    <button
                      class="btn btn-danger"
                      data-testid="btn-delete-speaker-${spk.id}"
                      @click=${() => onDeleteCustom(spk.id)}
                    >
                      Delete
                    </button>
                  `
                : ''}
            </div>
          </div>
        `
      )}
    </div>
  `;
}
