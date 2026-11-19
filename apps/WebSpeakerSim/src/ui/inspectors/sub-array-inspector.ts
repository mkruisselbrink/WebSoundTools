// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector and enclosure schedule for Subwoofer Arrays.
 */

import { computeSpeedOfSoundMpS } from '@foh/acoustics';
import { numVal } from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { SubArrayInstance, SubArrayMode } from '../../model/project-types.js';
import {
  computeQuarterWaveSpacingM,
  expandSubwooferArray,
} from '../../physics/sub-array-designer.js';

const SUB_ARRAY_MODES: readonly { readonly value: SubArrayMode; readonly label: string }[] = [
  { value: 'broadside', label: 'Broadside Line' },
  { value: 'cardioid-csa', label: 'Cardioid Stack (CSA)' },
  { value: 'end-fire', label: 'End-Fire Gradient' },
  { value: 'delay-arc', label: 'Electronic Delay Arc' },
];

export function renderSubArrayInspector(store: ProjectStore, sa: SubArrayInstance): TemplateResult {
  const scene = store.scene;
  const speedOfSound = computeSpeedOfSoundMpS(scene.atmosphere);
  const subSpeakers = store.getAllSpeakers().filter((s) => s.category === 'subwoofer');
  const allSpeakers = subSpeakers.length > 0 ? subSpeakers : store.getAllSpeakers();
  const expanded = expandSubwooferArray(sa, speedOfSound);
  const quarterWaveM = computeQuarterWaveSpacingM(sa.tuningFrequencyHz, speedOfSound);

  return html`
    <div data-testid="inspector-sub-array">
      <div class="insp-header">
        <span class="insp-title">Subwoofer Array Designer</span>
        <button
          class="btn btn-xs btn-danger"
          data-testid="btn-delete-entity"
          @click=${() => store.removeSubArray(sa.id)}
        >
          Delete
        </button>
      </div>

      <div class="form-section">
        <div class="form-section-title">Topology & Model</div>
        <div class="field-row">
          <label class="field-label" for="sa-name-input">Name</label>
          <input
            type="text"
            id="sa-name-input"
            name="sa-name"
            .value=${sa.name}
            @change=${(ev: Event) =>
              store.updateSubArray(sa.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>

        <div class="field-row">
          <label class="field-label" for="sa-mode-select">Array Mode</label>
          <select
            id="sa-mode-select"
            name="sa-mode"
            data-testid="sa-mode-select"
            .value=${sa.mode}
            @change=${(ev: Event) =>
              store.updateSubArray(sa.id, {
                mode: (ev.target as HTMLSelectElement).value as SubArrayMode,
              })}
          >
            ${SUB_ARRAY_MODES.map(
              (m) =>
                html`<option value=${m.value} ?selected=${m.value === sa.mode}>${m.label}</option>`
            )}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label" for="sa-speaker-select">Sub Model</label>
          <select
            id="sa-speaker-select"
            name="sa-speaker"
            data-testid="sa-speaker-select"
            .value=${sa.speakerId}
            @change=${(ev: Event) =>
              store.updateSubArray(sa.id, {
                speakerId: (ev.target as HTMLSelectElement).value,
              })}
          >
            ${allSpeakers.map(
              (spk) => html`
                <option value=${spk.id} ?selected=${spk.id === sa.speakerId}>${spk.name}</option>
              `
            )}
          </select>
        </div>

        <div class="field-row">
          <label class="field-label" for="sa-group-select">DSP Group</label>
          <select
            id="sa-group-select"
            name="sa-dsp-group"
            .value=${sa.dspGroupId}
            @change=${(ev: Event) =>
              store.updateSubArray(sa.id, {
                dspGroupId: (ev.target as HTMLSelectElement).value,
              })}
          >
            ${scene.dspGroups.map(
              (g) => html`
                <option value=${g.id} ?selected=${g.id === sa.dspGroupId}>${g.name}</option>
              `
            )}
          </select>
        </div>

        <div class="xy-grid" style="margin-top:6px">
          <label class="mini-field">
            <span>Enclosures (1–24)</span>
            <input
              type="number"
              name="sa-box-count"
              min="1"
              max="24"
              step="1"
              data-testid="sa-box-count"
              .value=${String(sa.boxCount)}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { boxCount: Math.max(1, Math.min(24, Math.round(numVal(ev, sa.boxCount)))) },
                  `sa-cnt-${sa.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Tune Freq (Hz)</span>
            <input
              type="number"
              name="sa-tuning-hz"
              min="25"
              max="160"
              step="1"
              data-testid="sa-tuning-hz"
              .value=${String(sa.tuningFrequencyHz)}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { tuningFrequencyHz: Math.max(25, Math.min(160, numVal(ev, sa.tuningFrequencyHz))) },
                  `sa-tune-${sa.id}`
                )}
            />
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">
          <span>Geometry & Spacing</span>
          <button
            class="btn btn-xs"
            data-testid="btn-sa-quarter-wave"
            title="Set spacing to quarter-wavelength at Tune Freq (${quarterWaveM.toFixed(2)} m)"
            @click=${() =>
              store.updateSubArray(sa.id, {
                spacingM: Number(quarterWaveM.toFixed(2)),
                cardioidDepthOffsetM:
                  sa.mode === 'cardioid-csa'
                    ? Number(quarterWaveM.toFixed(2))
                    : sa.cardioidDepthOffsetM,
              })}
          >
            Set λ/4 (${quarterWaveM.toFixed(2)}m)
          </button>
        </div>

        <div class="xyz-grid" style="margin-bottom:6px">
          <label class="mini-field">
            <span>Origin X (m)</span>
            <input
              type="number"
              name="sa-origin-x"
              step="0.1"
              .value=${String(Number(sa.origin.x.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { origin: { ...sa.origin, x: numVal(ev, sa.origin.x) } },
                  `sa-pos-${sa.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Origin Y (m)</span>
            <input
              type="number"
              name="sa-origin-y"
              step="0.1"
              .value=${String(Number(sa.origin.y.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { origin: { ...sa.origin, y: numVal(ev, sa.origin.y) } },
                  `sa-pos-${sa.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Origin Z (m)</span>
            <input
              type="number"
              name="sa-origin-z"
              step="0.05"
              .value=${String(Number(sa.origin.z.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { origin: { ...sa.origin, z: Math.max(0.05, numVal(ev, sa.origin.z)) } },
                  `sa-pos-${sa.id}`
                )}
            />
          </label>
        </div>

        <div class="xyz-grid">
          <label class="mini-field">
            <span>Spacing (m)</span>
            <input
              type="number"
              name="sa-spacing-m"
              step="0.05"
              min="0.3"
              .value=${String(sa.spacingM)}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { spacingM: Math.max(0.2, numVal(ev, sa.spacingM)) },
                  `sa-spc-${sa.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Azimuth (°)</span>
            <input
              type="number"
              name="sa-azimuth-deg"
              step="1"
              .value=${String(sa.azimuthDeg)}
              @input=${(ev: Event) =>
                store.updateSubArray(
                  sa.id,
                  { azimuthDeg: numVal(ev, sa.azimuthDeg) },
                  `sa-az-${sa.id}`
                )}
            />
          </label>
          ${sa.mode === 'cardioid-csa'
            ? html`
                <label class="mini-field">
                  <span>CSA Depth (m)</span>
                  <input
                    type="number"
                    name="sa-csa-depth-m"
                    step="0.05"
                    min="0.3"
                    .value=${String(sa.cardioidDepthOffsetM)}
                    @input=${(ev: Event) =>
                      store.updateSubArray(
                        sa.id,
                        {
                          cardioidDepthOffsetM: Math.max(
                            0.2,
                            numVal(ev, sa.cardioidDepthOffsetM)
                          ),
                        },
                        `sa-csa-${sa.id}`
                      )}
                  />
                </label>
              `
            : sa.mode === 'delay-arc'
              ? html`
                  <label class="mini-field">
                    <span>Arc Angle (°)</span>
                    <input
                      type="number"
                      name="sa-arc-angle-deg"
                      step="5"
                      min="0"
                      max="160"
                      .value=${String(sa.arcAngleDeg)}
                      @input=${(ev: Event) =>
                        store.updateSubArray(
                          sa.id,
                          { arcAngleDeg: Math.max(0, Math.min(160, numVal(ev, sa.arcAngleDeg))) },
                          `sa-arc-${sa.id}`
                        )}
                    />
                  </label>
                `
              : html`<div></div>`}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Generated Enclosure Schedule (${expanded.length})</div>
        <table class="cabinet-table">
          <thead>
            <tr>
              <th>Box</th>
              <th>X / Y (m)</th>
              <th>Delay</th>
              <th>Pol</th>
            </tr>
          </thead>
          <tbody>
            ${expanded.slice(0, 12).map(
              (cab, idx) => html`
                <tr>
                  <td>#${idx + 1}</td>
                  <td>${cab.position.x.toFixed(2)}, ${cab.position.y.toFixed(2)}</td>
                  <td>${cab.trimDelayMs.toFixed(2)} ms</td>
                  <td>${cab.invertPolarity ? 'Ø Inv' : '+ Norm'}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
