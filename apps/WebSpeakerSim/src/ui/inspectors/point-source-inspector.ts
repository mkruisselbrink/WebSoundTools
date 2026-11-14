// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for Point Source loudspeaker enclosures.
 */

import { numVal } from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { PointSourceInstance } from '../../model/project-types.js';

export function renderPointSourceInspector(
  store: ProjectStore,
  ps: PointSourceInstance
): TemplateResult {
  const scene = store.scene;
  const speakers = store.getAllSpeakers();
  const activeSpk = store.getSpeakerById(ps.speakerId);

  return html`
    <div data-testid="inspector-point-source">
      <div class="insp-header">
        <span class="insp-title">Point Source</span>
        <button
          class="btn btn-xs btn-danger"
          data-testid="btn-delete-entity"
          @click=${() => store.removePointSource(ps.id)}
        >
          Delete
        </button>
      </div>

      <div class="form-section">
        <div class="form-section-title">Enclosure & Routing</div>
        <div class="field-row">
          <span class="field-label">Name</span>
          <input
            type="text"
            data-testid="ps-name-input"
            .value=${ps.name}
            @change=${(ev: Event) =>
              store.updatePointSource(ps.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>

        <div class="field-row">
          <span class="field-label">Loudspeaker</span>
          <select
            data-testid="ps-speaker-select"
            .value=${ps.speakerId}
            @change=${(ev: Event) =>
              store.updatePointSource(ps.id, {
                speakerId: (ev.target as HTMLSelectElement).value,
              })}
          >
            ${speakers.map(
              (spk) => html`
                <option value=${spk.id} ?selected=${spk.id === ps.speakerId}>
                  ${spk.name} (${spk.nominalDispersionDeg.horizontal}°×${spk.nominalDispersionDeg
                    .vertical}°)
                </option>
              `
            )}
          </select>
        </div>

        ${activeSpk
          ? html`
              <div class="insp-subtitle">
                Max SPL @ 1m: ${activeSpk.maxContinuousSpl1mDb} dB · Passband:
                ${activeSpk.passbandHz.low3dB}–${activeSpk.passbandHz.high3dB} Hz
              </div>
            `
          : ''}

        <div class="field-row">
          <span class="field-label">DSP Group</span>
          <select
            data-testid="ps-group-select"
            .value=${ps.dspGroupId}
            @change=${(ev: Event) =>
              store.updatePointSource(ps.id, {
                dspGroupId: (ev.target as HTMLSelectElement).value,
              })}
          >
            ${scene.dspGroups.map(
              (g) => html`
                <option value=${g.id} ?selected=${g.id === ps.dspGroupId}>${g.name}</option>
              `
            )}
          </select>
        </div>

        <div class="check-row">
          <label class="check-label">
            <input
              type="checkbox"
              data-testid="ps-mirror-checkbox"
              .checked=${ps.mirrorLeftRight}
              @change=${(ev: Event) =>
                store.updatePointSource(ps.id, {
                  mirrorLeftRight: (ev.target as HTMLInputElement).checked,
                })}
            />
            Symmetric L/R Pair
          </label>
          <label class="check-label">
            <input
              type="checkbox"
              .checked=${ps.muted}
              @change=${(ev: Event) =>
                store.updatePointSource(ps.id, {
                  muted: (ev.target as HTMLInputElement).checked,
                })}
            />
            Mute
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">3D Position & Aiming</div>
        <div class="xyz-grid" style="margin-bottom:6px">
          <label class="mini-field">
            <span>X Throw (m)</span>
            <input
              type="number"
              step="0.1"
              data-testid="ps-pos-x"
              .value=${String(Number(ps.position.x.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  { position: { ...ps.position, x: numVal(ev, ps.position.x) } },
                  `ps-pos-${ps.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Y Lateral (m)</span>
            <input
              type="number"
              step="0.1"
              data-testid="ps-pos-y"
              .value=${String(Number(ps.position.y.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  { position: { ...ps.position, y: numVal(ev, ps.position.y) } },
                  `ps-pos-${ps.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Z Height (m)</span>
            <input
              type="number"
              step="0.1"
              data-testid="ps-pos-z"
              .value=${String(Number(ps.position.z.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  { position: { ...ps.position, z: Math.max(0.05, numVal(ev, ps.position.z)) } },
                  `ps-pos-${ps.id}`
                )}
            />
          </label>
        </div>

        <div class="xyz-grid">
          <label class="mini-field">
            <span>Azimuth (°)</span>
            <input
              type="number"
              step="1"
              data-testid="ps-azimuth"
              .value=${String(Number(ps.orientation.azimuthDeg.toFixed(1)))}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  {
                    orientation: {
                      ...ps.orientation,
                      azimuthDeg: numVal(ev, ps.orientation.azimuthDeg),
                    },
                  },
                  `ps-aim-${ps.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Tilt (°)</span>
            <input
              type="number"
              step="1"
              data-testid="ps-tilt"
              .value=${String(Number(ps.orientation.tiltDeg.toFixed(1)))}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  {
                    orientation: {
                      ...ps.orientation,
                      tiltDeg: Math.max(-85, Math.min(85, numVal(ev, ps.orientation.tiltDeg))),
                    },
                  },
                  `ps-aim-${ps.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Roll (°)</span>
            <input
              type="number"
              step="5"
              .value=${String(Number(ps.orientation.rollDeg.toFixed(1)))}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  {
                    orientation: {
                      ...ps.orientation,
                      rollDeg: numVal(ev, ps.orientation.rollDeg),
                    },
                  },
                  `ps-aim-${ps.id}`
                )}
            />
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Cabinet Trim</div>
        <div class="xy-grid">
          <label class="mini-field">
            <span>Trim Gain (dB)</span>
            <input
              type="number"
              step="0.5"
              .value=${String(ps.trimGainDb)}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  { trimGainDb: numVal(ev, ps.trimGainDb) },
                  `ps-trim-${ps.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Trim Delay (ms)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              .value=${String(ps.trimDelayMs)}
              @input=${(ev: Event) =>
                store.updatePointSource(
                  ps.id,
                  { trimDelayMs: Math.max(0, numVal(ev, ps.trimDelayMs)) },
                  `ps-trim-${ps.id}`
                )}
            />
          </label>
        </div>
        <div class="check-row">
          <label class="check-label">
            <input
              type="checkbox"
              .checked=${ps.invertPolarity}
              @change=${(ev: Event) =>
                store.updatePointSource(ps.id, {
                  invertPolarity: (ev.target as HTMLInputElement).checked,
                })}
            />
            Invert Cabinet Polarity (Ø)
          </label>
        </div>
      </div>
    </div>
  `;
}
