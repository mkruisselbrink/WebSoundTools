/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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

/**
 * Scene hierarchy sidebar (`src/ui/sidebar/sidebar-view.ts`).
 */

import { html, type TemplateResult } from 'lit';
import type { ProjectStore, SelectedEntity } from '../../model/project-store.js';

function isSel(sel: SelectedEntity | null, kind: SelectedEntity['kind'], id?: string): boolean {
  if (!sel || sel.kind !== kind) return false;
  if (sel.kind === 'environment') return true;
  return sel.id === id;
}

export function renderSceneSidebar(store: ProjectStore): TemplateResult {
  const scene = store.scene;
  const sel = store.selectedEntity;
  const groupColor = (groupId: string): string =>
    scene.dspGroups.find((g) => g.id === groupId)?.color ?? '#38bdf8';

  return html`
    <div class="scene-sidebar" data-testid="scene-sidebar">
      <!-- Point Sources -->
      <div class="tree-section">
        <div class="tree-header">
          <span>Point Sources (${scene.pointSources.length})</span>
          <button
            class="btn btn-xs"
            data-testid="btn-add-point-source"
            title="Add Point Source (P)"
            @click=${() => store.addPointSource()}
          >
            + Top
          </button>
        </div>
        <div class="tree-list">
          ${scene.pointSources.map(
            (ps) => html`
              <div
                class="tree-row"
                data-testid="tree-ps-${ps.id}"
                data-selected=${String(isSel(sel, 'point-source', ps.id))}
                @click=${() => store.setSelection({ kind: 'point-source', id: ps.id })}
              >
                <div class="tree-row-main">
                  <span class="swatch" style="background:${groupColor(ps.dspGroupId)}"></span>
                  <span class="tree-row-title">${ps.name}</span>
                  ${ps.mirrorLeftRight ? html`<span class="tree-badge">L/R</span>` : ''}
                </div>
                <button
                  class="btn btn-xs ${ps.muted ? 'btn-danger' : ''}"
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    store.updatePointSource(ps.id, { muted: !ps.muted });
                  }}
                >
                  ${ps.muted ? 'Muted' : 'On'}
                </button>
              </div>
            `
          )}
        </div>
      </div>

      <!-- Subwoofer Arrays -->
      <div class="tree-section">
        <div class="tree-header">
          <span>Subwoofer Arrays (${scene.subArrays.length})</span>
          <button
            class="btn btn-xs"
            data-testid="btn-add-sub-array"
            title="Add Subwoofer Array (S)"
            @click=${() => store.addSubArray()}
          >
            + Sub
          </button>
        </div>
        <div class="tree-list">
          ${scene.subArrays.map(
            (sa) => html`
              <div
                class="tree-row"
                data-testid="tree-sa-${sa.id}"
                data-selected=${String(isSel(sel, 'sub-array', sa.id))}
                @click=${() => store.setSelection({ kind: 'sub-array', id: sa.id })}
              >
                <div class="tree-row-main">
                  <span class="swatch" style="background:${groupColor(sa.dspGroupId)}"></span>
                  <span class="tree-row-title">${sa.name}</span>
                  <span class="tree-badge">${sa.boxCount}× ${sa.mode}</span>
                </div>
                <button
                  class="btn btn-xs ${sa.muted ? 'btn-danger' : ''}"
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    store.updateSubArray(sa.id, { muted: !sa.muted });
                  }}
                >
                  ${sa.muted ? 'Muted' : 'On'}
                </button>
              </div>
            `
          )}
        </div>
      </div>

      <!-- DSP Groups -->
      <div class="tree-section">
        <div class="tree-header">
          <span>DSP Groups (${scene.dspGroups.length})</span>
          <button
            class="btn btn-xs"
            data-testid="btn-add-dsp-group"
            @click=${() => store.addDspGroup()}
          >
            + Group
          </button>
        </div>
        <div class="tree-list">
          ${scene.dspGroups.map(
            (grp) => html`
              <div
                class="tree-row"
                data-testid="tree-grp-${grp.id}"
                data-selected=${String(isSel(sel, 'dsp-group', grp.id))}
                @click=${() => store.setSelection({ kind: 'dsp-group', id: grp.id })}
              >
                <div class="tree-row-main">
                  <span class="swatch" style="background:${grp.color}"></span>
                  <span class="tree-row-title">${grp.name}</span>
                  <span class="tree-badge">${grp.dsp.delayMs.toFixed(1)} ms</span>
                </div>
                <button
                  class="btn btn-xs ${grp.dsp.muted ? 'btn-danger' : ''}"
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    store.updateDspGroup(grp.id, { dsp: { muted: !grp.dsp.muted } });
                  }}
                >
                  ${grp.dsp.muted ? 'Muted' : 'On'}
                </button>
              </div>
            `
          )}
        </div>
      </div>

      <!-- Audience & Stage Surfaces -->
      <div class="tree-section">
        <div class="tree-header">
          <span>Audience & Stage Zones (${scene.surfaces.length})</span>
          <button
            class="btn btn-xs"
            data-testid="btn-add-surface"
            @click=${() => store.addSurface()}
          >
            + Zone
          </button>
        </div>
        <div class="tree-list">
          ${scene.surfaces.map(
            (sf) => html`
              <div
                class="tree-row"
                data-testid="tree-surf-${sf.id}"
                data-selected=${String(isSel(sel, 'surface', sf.id))}
                @click=${() => store.setSelection({ kind: 'surface', id: sf.id })}
              >
                <div class="tree-row-main">
                  <span
                    class="swatch"
                    style="background:${sf.role === 'stage' ? '#f59e0b' : '#22c55e'}"
                  ></span>
                  <span class="tree-row-title">${sf.name}</span>
                  <span class="tree-badge">${sf.role}</span>
                </div>
                <button
                  class="btn btn-xs"
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    store.updateSurface(sf.id, { enabled: !sf.enabled });
                  }}
                >
                  ${sf.enabled ? 'On' : 'Off'}
                </button>
              </div>
            `
          )}
        </div>
      </div>

      <!-- Virtual Microphones -->
      <div class="tree-section">
        <div class="tree-header">
          <span>Virtual Mics (${scene.virtualMics.length})</span>
          <button
            class="btn btn-xs"
            data-testid="btn-add-virtual-mic"
            title="Add Virtual Measurement Mic (M)"
            @click=${() => store.addVirtualMic()}
          >
            + Mic
          </button>
        </div>
        <div class="tree-list">
          ${scene.virtualMics.map(
            (mic) => html`
              <div
                class="tree-row"
                data-testid="tree-mic-${mic.id}"
                data-selected=${String(isSel(sel, 'virtual-mic', mic.id))}
                @click=${() => store.setSelection({ kind: 'virtual-mic', id: mic.id })}
              >
                <div class="tree-row-main">
                  <span class="swatch" style="background:${mic.color}"></span>
                  <span class="tree-row-title">${mic.name}</span>
                </div>
                <button
                  class="btn btn-xs"
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    store.updateVirtualMic(mic.id, { enabled: !mic.enabled });
                  }}
                >
                  ${mic.enabled ? 'On' : 'Off'}
                </button>
              </div>
            `
          )}
        </div>
      </div>

      <!-- Environment -->
      <div class="tree-section">
        <div
          class="tree-row"
          data-testid="tree-environment"
          data-selected=${String(isSel(sel, 'environment'))}
          @click=${() => store.setSelection({ kind: 'environment' })}
        >
          <div class="tree-row-main">
            <span class="swatch" style="background:#94a3b8"></span>
            <span class="tree-row-title">Atmosphere, Colormap & Venue Bounds</span>
          </div>
          <span class="tree-badge">${scene.atmosphere.temperatureCelsius}°C</span>
        </div>
      </div>
    </div>
  `;
}

