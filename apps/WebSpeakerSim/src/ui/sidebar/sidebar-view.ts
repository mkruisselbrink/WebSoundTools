// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Scene hierarchy sidebar rendering Point Sources, Subwoofer Arrays, DSP Groups,
 * Audience/Stage Surfaces, Virtual Microphones, and Venue Environment.
 */

import { renderEntityTreeSection } from '@foh/ui';
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
      ${renderEntityTreeSection({
        title: `Point Sources (${scene.pointSources.length})`,
        headerActions: html`
          <button
            class="foh-btn foh-btn-xs"
            data-testid="btn-add-point-source"
            title="Add Point Source (P)"
            @click=${() => store.addPointSource()}
          >
            + Top
          </button>
        `,
        items: scene.pointSources.map((ps) => ({
          id: ps.id,
          title: ps.name,
          selected: isSel(sel, 'point-source', ps.id),
          color: groupColor(ps.dspGroupId),
          badge: ps.mirrorLeftRight ? 'L/R' : undefined,
          testId: `tree-ps-${ps.id}`,
          toggle: {
            kind: 'button',
            active: !ps.muted,
            activeLabel: 'On',
            inactiveLabel: 'Muted',
            dangerWhenInactive: true,
            onToggle: (nextActive) => store.updatePointSource(ps.id, { muted: !nextActive }),
          },
          onSelect: () => store.setSelection({ kind: 'point-source', id: ps.id }),
        })),
      })}

      ${renderEntityTreeSection({
        title: `Subwoofer Arrays (${scene.subArrays.length})`,
        headerActions: html`
          <button
            class="foh-btn foh-btn-xs"
            data-testid="btn-add-sub-array"
            title="Add Subwoofer Array (S)"
            @click=${() => store.addSubArray()}
          >
            + Sub
          </button>
        `,
        items: scene.subArrays.map((sa) => ({
          id: sa.id,
          title: sa.name,
          selected: isSel(sel, 'sub-array', sa.id),
          color: groupColor(sa.dspGroupId),
          badge: `${sa.boxCount}× ${sa.mode}`,
          testId: `tree-sa-${sa.id}`,
          toggle: {
            kind: 'button',
            active: !sa.muted,
            activeLabel: 'On',
            inactiveLabel: 'Muted',
            dangerWhenInactive: true,
            onToggle: (nextActive) => store.updateSubArray(sa.id, { muted: !nextActive }),
          },
          onSelect: () => store.setSelection({ kind: 'sub-array', id: sa.id }),
        })),
      })}

      ${renderEntityTreeSection({
        title: `DSP Groups (${scene.dspGroups.length})`,
        headerActions: html`
          <button
            class="foh-btn foh-btn-xs"
            data-testid="btn-add-dsp-group"
            @click=${() => store.addDspGroup()}
          >
            + Group
          </button>
        `,
        items: scene.dspGroups.map((grp) => ({
          id: grp.id,
          title: grp.name,
          selected: isSel(sel, 'dsp-group', grp.id),
          color: grp.color,
          badge: `${grp.dsp.delayMs.toFixed(1)} ms`,
          testId: `tree-grp-${grp.id}`,
          toggle: {
            kind: 'button',
            active: !grp.dsp.muted,
            activeLabel: 'On',
            inactiveLabel: 'Muted',
            dangerWhenInactive: true,
            onToggle: (nextActive) =>
              store.updateDspGroup(grp.id, { dsp: { muted: !nextActive } }),
          },
          onSelect: () => store.setSelection({ kind: 'dsp-group', id: grp.id }),
        })),
      })}

      ${renderEntityTreeSection({
        title: `Audience & Stage Zones (${scene.surfaces.length})`,
        headerActions: html`
          <button
            class="foh-btn foh-btn-xs"
            data-testid="btn-add-surface"
            @click=${() => store.addSurface()}
          >
            + Zone
          </button>
        `,
        items: scene.surfaces.map((sf) => ({
          id: sf.id,
          title: sf.name,
          selected: isSel(sel, 'surface', sf.id),
          color: sf.role === 'stage' ? '#f59e0b' : '#22c55e',
          badge: sf.role,
          testId: `tree-surf-${sf.id}`,
          toggle: {
            kind: 'button',
            active: sf.enabled,
            activeLabel: 'On',
            inactiveLabel: 'Off',
            onToggle: (nextActive) => store.updateSurface(sf.id, { enabled: nextActive }),
          },
          onSelect: () => store.setSelection({ kind: 'surface', id: sf.id }),
        })),
      })}

      ${renderEntityTreeSection({
        title: `Virtual Mics (${scene.virtualMics.length})`,
        headerActions: html`
          <button
            class="foh-btn foh-btn-xs"
            data-testid="btn-add-virtual-mic"
            title="Add Virtual Measurement Mic (M)"
            @click=${() => store.addVirtualMic()}
          >
            + Mic
          </button>
        `,
        items: scene.virtualMics.map((mic) => ({
          id: mic.id,
          title: mic.name,
          selected: isSel(sel, 'virtual-mic', mic.id),
          color: mic.color,
          testId: `tree-mic-${mic.id}`,
          toggle: {
            kind: 'button',
            active: mic.enabled,
            activeLabel: 'On',
            inactiveLabel: 'Off',
            onToggle: (nextActive) => store.updateVirtualMic(mic.id, { enabled: nextActive }),
          },
          onSelect: () => store.setSelection({ kind: 'virtual-mic', id: mic.id }),
        })),
      })}

      ${renderEntityTreeSection({
        items: [
          {
            id: 'environment',
            title: 'Atmosphere, Colormap & Venue Bounds',
            selected: isSel(sel, 'environment'),
            color: '#94a3b8',
            badge: `${scene.atmosphere.temperatureCelsius}°C`,
            testId: 'tree-environment',
            onSelect: () => store.setSelection({ kind: 'environment' }),
          },
        ],
      })}
    </div>
  `;
}
