// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for DSP Processor Groups using `@foh/ui` `renderDspChainEditor`.
 */

import type { ParametricEqBand } from '@foh/dsp';
import { renderDspChainEditor } from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { DspGroup } from '../../model/project-types.js';

export function renderDspGroupInspector(store: ProjectStore, grp: DspGroup): TemplateResult {
  const dsp = grp.dsp;
  const canDelete = store.scene.dspGroups.length > 1;

  const addEqBand = () => {
    if (dsp.eqBands.length >= 8) return;
    const nextBand: ParametricEqBand = {
      id: `eq-${Date.now().toString(36)}-${dsp.eqBands.length + 1}`,
      enabled: true,
      type: 'peaking',
      frequencyHz: 250 * Math.pow(2, dsp.eqBands.length % 4),
      gainDb: -3,
      q: 2.0,
    };
    store.updateDspGroup(grp.id, { dsp: { eqBands: [...dsp.eqBands, nextBand] } });
  };

  const patchEqBand = (
    _bandIndex: number,
    bandId: string,
    patch: Partial<ParametricEqBand>,
    txKey?: string
  ) => {
    store.updateDspGroup(
      grp.id,
      {
        dsp: {
          eqBands: dsp.eqBands.map((b) => (b.id === bandId ? { ...b, ...patch } : b)),
        },
      },
      txKey
    );
  };

  return html`
    <div data-testid="inspector-dsp-group">
      <div class="insp-header">
        <span class="insp-title">DSP Processor Group</span>
        <button
          class="btn btn-xs btn-danger"
          ?disabled=${!canDelete}
          @click=${() => store.removeDspGroup(grp.id)}
        >
          Delete
        </button>
      </div>

      <div class="form-section">
        <div class="form-section-title">Group Identity</div>
        <div class="field-row">
          <label class="field-label" for="dsp-group-name-input">Group Name</label>
          <input
            type="text"
            id="dsp-group-name-input"
            name="dsp-group-name"
            .value=${grp.name}
            @change=${(ev: Event) =>
              store.updateDspGroup(grp.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>
      </div>

      ${renderDspChainEditor({
        entityId: grp.id,
        dsp,
        maxEqBands: 8,
        muteLabel: 'Mute Group',
        tipText: 'Tip: Drag EQ handles on Magnitude chart; Shift + Drag or Wheel for Q.',
        testIds: {
          gainDb: 'grp-gain-db',
          delayMs: 'grp-delay-ms',
          invertPolarity: 'grp-polarity-checkbox',
          hpfTopology: 'grp-hpf-topology',
          lpfTopology: 'grp-lpf-topology',
          addEqBand: 'btn-add-eq-band',
          eqBandCardPrefix: 'eq-band-',
        },
        onPatchDsp: (patch, txKey) => store.updateDspGroup(grp.id, { dsp: patch }, txKey),
        onPatchEqBand: patchEqBand,
        onAddEqBand: addEqBand,
        onRemoveEqBand: (_idx, bandId) =>
          store.updateDspGroup(grp.id, {
            dsp: { eqBands: dsp.eqBands.filter((b) => b.id !== bandId) },
          }),
      })}
    </div>
  `;
}
