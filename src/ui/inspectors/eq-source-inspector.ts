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
import { BiquadFilterType, BiquadSpec } from '../../dsp/biquad.js';
import { EqualizerSourceConfig } from '../../sources/eq-source.js';
import { SourceData } from '../../sources/source-data.js';

export interface EqInspectorHandlers {
  readonly onAutoFlatten: (eqId: string) => void;
  readonly onTargetSourceChange: (eqId: string, targetSourceId: string | null) => void;
  readonly onUpdateEqBand: (
    eqId: string,
    bandIdx: number,
    partial: Partial<BiquadSpec>
  ) => void;
}

export function renderEqInspector(
  eq: EqualizerSourceConfig,
  allSources: readonly SourceData[],
  handlers: EqInspectorHandlers
): TemplateResult {
  const candidateTargets = allSources.filter(
    (s) => s.kind === 'measurement' || s.kind === 'stored'
  );
  return html`
    <div class="section-card" data-testid="inspector-eq-source">
      <div class="section-header">
        <span>${eq.name}</span>
        <button
          class="btn-accent"
          data-testid="btn-auto-flatten-eq"
          title="Load corrective inverse EQ matching the PA Room Modes simulator preset"
          @click=${() => handlers.onAutoFlatten(eq.id)}
        >
          Auto-Match Room
        </button>
      </div>

      <div class="prop-field full-width">
        <label>Apply Virtual EQ To Source</label>
        <select
          aria-label="Apply Virtual EQ To Source"
          .value=${eq.targetSourceId ?? ''}
          @change=${(e: Event) => {
            const targetSourceId = (e.target as HTMLSelectElement).value || null;
            handlers.onTargetSourceChange(eq.id, targetSourceId);
          }}
        >
          <option value="">None (Show Filter Curve Only)</option>
          ${candidateTargets.map(
            (s) =>
              html`<option value=${s.id} ?selected=${s.id === eq.targetSourceId}>
                ${s.name}
              </option>`
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
              aria-label="Enable EQ Band ${idx + 1}"
              .checked=${b.enabled !== false}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  enabled: (e.target as HTMLInputElement).checked,
                })}
            />
            <select
              aria-label="EQ Band ${idx + 1} Type"
              .value=${b.type}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  type: (e.target as HTMLSelectElement).value as BiquadFilterType,
                })}
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
              aria-label="EQ Band ${idx + 1} Frequency (Hz)"
              title="Frequency (Hz)"
              .value=${String(b.frequency)}
              @input=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  frequency: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              type="number"
              step="0.5"
              aria-label="EQ Band ${idx + 1} Gain (dB)"
              title="Gain (dB)"
              .value=${String(b.gainDb ?? 0)}
              @input=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  gainDb: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              type="number"
              step="0.1"
              aria-label="EQ Band ${idx + 1} Q Factor"
              title="Q Factor"
              .value=${String(b.q ?? 0.7)}
              @input=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  q: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>
        `
      )}
    </div>
  `;
}
