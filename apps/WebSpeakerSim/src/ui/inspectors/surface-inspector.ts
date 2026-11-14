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
      <div class="insp-header">
        <span class="insp-title">Audience / Stage Surface</span>
        <button
          class="btn btn-xs btn-danger"
          data-testid="btn-delete-entity"
          @click=${() => store.removeSurface(surf.id)}
        >
          Delete
        </button>
      </div>

      <div class="form-section">
        <div class="form-section-title">Classification</div>
        <div class="field-row">
          <span class="field-label">Name</span>
          <input
            type="text"
            .value=${surf.name}
            @change=${(ev: Event) =>
              store.updateSurface(surf.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>
        <div class="field-row">
          <span class="field-label">Surface Role</span>
          <select
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

      <div class="form-section">
        <div class="form-section-title">Plan & Section Geometry (m)</div>
        <div class="xy-grid" style="margin-bottom:6px">
          <label class="mini-field">
            <span>X Start (m)</span>
            <input
              type="number"
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
          <label class="mini-field">
            <span>X End (m)</span>
            <input
              type="number"
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

        <div class="xyz-grid" style="margin-bottom:6px">
          <label class="mini-field">
            <span>Y Center</span>
            <input
              type="number"
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
          <label class="mini-field">
            <span>Width Start</span>
            <input
              type="number"
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
          <label class="mini-field">
            <span>Width End</span>
            <input
              type="number"
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

        <div class="xyz-grid">
          <label class="mini-field">
            <span>Deck Z Start</span>
            <input
              type="number"
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
          <label class="mini-field">
            <span>Deck Z End</span>
            <input
              type="number"
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
          <label class="mini-field">
            <span>Ear Height</span>
            <input
              type="number"
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
