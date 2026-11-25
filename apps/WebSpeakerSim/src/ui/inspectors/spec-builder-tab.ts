// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Datasheet Spec Builder tab for synthesizing 3D directivity balloons from manufacturer specs.
 */

import { html, type TemplateResult } from 'lit';
import type { SpeakerCategory } from '../../library/speaker-schema.js';

export interface SpecBuilderDraft {
  readonly name: string;
  readonly manufacturer: string;
  readonly category: SpeakerCategory;
  readonly hDeg: number;
  readonly vDeg: number;
  readonly lowHz: number;
  readonly highHz: number;
  readonly maxSplDb: number;
  readonly lfPattern: 'omni' | 'cardioid';
}

export function renderSpecBuilderTab(params: {
  readonly draft: SpecBuilderDraft;
  readonly onPatchDraft: (patch: Partial<SpecBuilderDraft>) => void;
  readonly onCreate: () => void;
}): TemplateResult {
  const { draft, onPatchDraft, onCreate } = params;
  return html`
    <div class="form-grid" data-testid="spec-builder-form">
      <div class="field">
        <label for="spec-name-input">Model Name</label>
        <input
          type="text"
          id="spec-name-input"
          name="spec-model-name"
          data-testid="spec-name-input"
          .value=${draft.name}
          @input=${(ev: Event) => onPatchDraft({ name: (ev.target as HTMLInputElement).value })}
        />
      </div>
      <div class="field">
        <label for="spec-manufacturer-input">Manufacturer / Series</label>
        <input
          type="text"
          id="spec-manufacturer-input"
          name="spec-manufacturer"
          .value=${draft.manufacturer}
          @input=${(ev: Event) =>
            onPatchDraft({ manufacturer: (ev.target as HTMLInputElement).value })}
        />
      </div>
      <div class="field">
        <label for="spec-category-select">Enclosure Category</label>
        <select
          id="spec-category-select"
          name="spec-category"
          data-testid="spec-category-select"
          .value=${draft.category}
          @change=${(ev: Event) => {
            const cat = (ev.target as HTMLSelectElement).value as SpeakerCategory;
            onPatchDraft({
              category: cat,
              lowHz: cat === 'subwoofer' ? 34 : 55,
              highHz: cat === 'subwoofer' ? 110 : 19000,
            });
          }}
        >
          <option value="point-source">Point-Source Top / Fill</option>
          <option value="subwoofer">Subwoofer Enclosure</option>
        </select>
      </div>
      <div class="field">
        <label for="spec-lf-pattern-select">LF Enclosure Radiation</label>
        <select
          id="spec-lf-pattern-select"
          name="spec-lf-pattern"
          .value=${draft.lfPattern}
          @change=${(ev: Event) =>
            onPatchDraft({
              lfPattern: (ev.target as HTMLSelectElement).value as 'omni' | 'cardioid',
            })}
        >
          <option value="omni">Standard Omnidirectional LF</option>
          <option value="cardioid">Intrinsic Cardioid Enclosure</option>
        </select>
      </div>

      ${draft.category === 'point-source'
        ? html`
            <div class="field">
              <label for="spec-h-deg">Horizontal Dispersion -6 dB (°)</label>
              <input
                type="number"
                id="spec-h-deg"
                name="spec-h-deg"
                min="30"
                max="160"
                step="5"
                data-testid="spec-h-deg"
                .value=${String(draft.hDeg)}
                @input=${(ev: Event) =>
                  onPatchDraft({ hDeg: Number((ev.target as HTMLInputElement).value) })}
              />
            </div>
            <div class="field">
              <label for="spec-v-deg">Vertical Dispersion -6 dB (°)</label>
              <input
                type="number"
                id="spec-v-deg"
                name="spec-v-deg"
                min="20"
                max="140"
                step="5"
                data-testid="spec-v-deg"
                .value=${String(draft.vDeg)}
                @input=${(ev: Event) =>
                  onPatchDraft({ vDeg: Number((ev.target as HTMLInputElement).value) })}
              />
            </div>
          `
        : ''}

      <div class="field">
        <label for="spec-low-hz">Low -3 dB Cutoff (Hz)</label>
        <input
          type="number"
          id="spec-low-hz"
          name="spec-low-hz"
          min="20"
          max="500"
          .value=${String(draft.lowHz)}
          @input=${(ev: Event) =>
            onPatchDraft({ lowHz: Number((ev.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="field">
        <label for="spec-high-hz">High -3 dB Cutoff (Hz)</label>
        <input
          type="number"
          id="spec-high-hz"
          name="spec-high-hz"
          min="60"
          max="22000"
          .value=${String(draft.highHz)}
          @input=${(ev: Event) =>
            onPatchDraft({ highHz: Number((ev.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="field">
        <label for="spec-max-spl">Max Continuous SPL @ 1 m (dB)</label>
        <input
          type="number"
          id="spec-max-spl"
          name="spec-max-spl"
          min="95"
          max="150"
          step="0.5"
          data-testid="spec-max-spl"
          .value=${String(draft.maxSplDb)}
          @input=${(ev: Event) =>
            onPatchDraft({ maxSplDb: Number((ev.target as HTMLInputElement).value) })}
        />
      </div>
    </div>

    <div style="margin-top:14px;display:flex;justify-content:flex-end">
      <button
        type="button"
        class="foh-btn foh-btn-primary"
        data-testid="btn-create-spec-speaker"
        @click=${onCreate}
      >
        Synthesize 3D Balloon & Add to Library
      </button>
    </div>
  `;
}
