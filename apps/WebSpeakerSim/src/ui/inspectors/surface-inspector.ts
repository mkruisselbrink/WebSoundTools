// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for Audience Listening Planes and Stage Rejection Surfaces.
 */

import { numVal } from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { AudienceSurface } from '../../model/project-types.js';

export function renderSurfaceInspector(store: ProjectStore, surf: AudienceSurface): TemplateResult {
  return html`
    <div data-testid="inspector-surface">
      <div class="foh-insp-header">
        <span class="foh-insp-title">Audience / Stage Surface</span>
        <button
          class="foh-btn foh-btn-xs foh-btn-danger"
          data-testid="btn-delete-entity"
          @click=${() => store.removeSurface(surf.id)}
        >
          Delete
        </button>
      </div>

      <div class="foh-form-section">
        <div class="foh-form-section-title">Classification</div>
        <div class="field-row">
          <label class="field-label" for="surf-name-input">Name</label>
          <input
            type="text"
            id="surf-name-input"
            name="surf-name"
            .value=${surf.name}
            @change=${(ev: Event) =>
              store.updateSurface(surf.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>
        <div class="field-row">
          <label class="field-label" for="surf-role-select">Surface Role</label>
          <select
            id="surf-role-select"
            name="surf-role"
            .value=${surf.role}
            @change=${(ev: Event) =>
              store.updateSurface(surf.id, {
                role: (ev.target as HTMLSelectElement).value as AudienceSurface['role'],
              })}
          >
            <option value="audience" ?selected=${surf.role === 'audience'}>
              Audience Listening Plane
            </option>
            <option value="stage" ?selected=${surf.role === 'stage'}>
              Stage / Rejection Zone
            </option>
          </select>
        </div>
      </div>

      <div class="foh-form-section">
        <div class="foh-form-section-title">Plan & Section Geometry (m)</div>
        <div class="foh-xy-grid" style="margin-bottom:6px">
          <label class="foh-mini-field">
            <span>X Start (m)</span>
            <input
              type="number"
              name="surf-x-start"
              step="0.5"
              .value=${String(surf.xStart)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { xStart: numVal(ev, surf.xStart) },
                  `sf-x-${surf.id}`
                )}
            />
          </label>
          <label class="foh-mini-field">
            <span>X End (m)</span>
            <input
              type="number"
              name="surf-x-end"
              step="0.5"
              .value=${String(surf.xEnd)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { xEnd: numVal(ev, surf.xEnd) },
                  `sf-x-${surf.id}`
                )}
            />
          </label>
        </div>

        <div class="foh-xyz-grid" style="margin-bottom:6px">
          <label class="foh-mini-field">
            <span>Y Center</span>
            <input
              type="number"
              name="surf-y-center"
              step="0.5"
              .value=${String(surf.yCenter)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { yCenter: numVal(ev, surf.yCenter) },
                  `sf-w-${surf.id}`
                )}
            />
          </label>
          <label class="foh-mini-field">
            <span>Width Start</span>
            <input
              type="number"
              name="surf-width-start"
              step="0.5"
              min="1"
              .value=${String(surf.widthStart)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { widthStart: Math.max(1, numVal(ev, surf.widthStart)) },
                  `sf-w-${surf.id}`
                )}
            />
          </label>
          <label class="foh-mini-field">
            <span>Width End</span>
            <input
              type="number"
              name="surf-width-end"
              step="0.5"
              min="1"
              .value=${String(surf.widthEnd)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { widthEnd: Math.max(1, numVal(ev, surf.widthEnd)) },
                  `sf-w-${surf.id}`
                )}
            />
          </label>
        </div>

        <div class="foh-xyz-grid">
          <label class="foh-mini-field">
            <span>Deck Z Start</span>
            <input
              type="number"
              name="surf-z-start"
              step="0.2"
              .value=${String(surf.zStart)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { zStart: numVal(ev, surf.zStart) },
                  `sf-z-${surf.id}`
                )}
            />
          </label>
          <label class="foh-mini-field">
            <span>Deck Z End</span>
            <input
              type="number"
              name="surf-z-end"
              step="0.2"
              .value=${String(surf.zEnd)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { zEnd: numVal(ev, surf.zEnd) },
                  `sf-z-${surf.id}`
                )}
            />
          </label>
          <label class="foh-mini-field">
            <span>Ear Height</span>
            <input
              type="number"
              name="surf-ear-height"
              step="0.05"
              min="0"
              .value=${String(surf.earHeightM)}
              @input=${(ev: Event) =>
                store.updateSurface(
                  surf.id,
                  { earHeightM: Math.max(0, numVal(ev, surf.earHeightM)) },
                  `sf-z-${surf.id}`
                )}
            />
          </label>
        </div>
      </div>
    </div>
  `;
}
