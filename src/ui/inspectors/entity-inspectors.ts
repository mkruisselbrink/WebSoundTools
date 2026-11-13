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
 * Context-sensitive property inspectors (`src/ui/inspectors/entity-inspectors.ts`)
 * for Point Sources, Subwoofer Arrays, DSP Groups, Audience/Stage Surfaces,
 * Virtual Microphones (including interactive Auto Time-Alignment), and Environment.
 */

import { html, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type {
  AudienceSurface,
  DspGroup,
  PointSourceInstance,
  SubArrayInstance,
  SubArrayMode,
  VirtualMicInstance,
} from '../../model/project-types.js';
import { computeSpeedOfSoundMpS } from '../../physics/atmosphere.js';
import {
  compileDspChain,
  evaluateCompiledDspAtFrequency,
  type BiquadFilterType,
  type CrossoverTopology,
  type ParametricEqBand,
} from '../../physics/biquad.js';
import type { SimulationSnapshot } from '../../physics/sim-controller.js';
import {
  computeQuarterWaveSpacingM,
  computeTimeAlignmentAtPoint,
  expandSubwooferArray,
} from '../../physics/sub-array-designer.js';
import { expandSceneRadiators } from '../../physics/summation-solver.js';
import { DEFAULT_GROUND_REFLECTOR } from '../../physics/transform3d.js';

export interface AlignmentUiState {
  readonly refGroupId: string;
  readonly targetGroupId: string;
  readonly alignFreqHz: number;
  readonly onChange: (patch: Partial<Omit<AlignmentUiState, 'onChange' | 'onNotify'>>) => void;
  readonly onNotify: (msg: string) => void;
}

const CROSSOVER_OPTIONS: readonly { readonly value: CrossoverTopology; readonly label: string }[] =
  [
    { value: 'off', label: 'Bypass (Off)' },
    { value: 'linkwitz-riley-24', label: 'LR24 (24 dB/oct)' },
    { value: 'linkwitz-riley-48', label: 'LR48 (48 dB/oct)' },
    { value: 'linkwitz-riley-12', label: 'LR12 (12 dB/oct)' },
    { value: 'butterworth-12', label: 'BW12 (12 dB/oct)' },
    { value: 'butterworth-18', label: 'BW18 (18 dB/oct)' },
    { value: 'butterworth-24', label: 'BW24 (24 dB/oct)' },
    { value: 'butterworth-48', label: 'BW48 (48 dB/oct)' },
  ];

const EQ_TYPES: readonly { readonly value: BiquadFilterType; readonly label: string }[] = [
  { value: 'peaking', label: 'Bell / Peaking' },
  { value: 'lowshelf', label: 'Low Shelf' },
  { value: 'highshelf', label: 'High Shelf' },
  { value: 'notch', label: 'Notch' },
  { value: 'allpass', label: '2nd-Order All-Pass' },
];

const SUB_ARRAY_MODES: readonly { readonly value: SubArrayMode; readonly label: string }[] = [
  { value: 'broadside', label: 'Broadside Line' },
  { value: 'cardioid-csa', label: 'Cardioid Stack (CSA)' },
  { value: 'end-fire', label: 'End-Fire Gradient' },
  { value: 'delay-arc', label: 'Electronic Delay Arc' },
];

function numVal(ev: Event, fallback: number): number {
  const n = Number((ev.target as HTMLInputElement).value);
  return Number.isFinite(n) ? n : fallback;
}

export function renderEntityInspector(
  store: ProjectStore,
  snapshot: SimulationSnapshot | null,
  alignUi: AlignmentUiState
): TemplateResult {
  const sel = store.selectedEntity;
  const scene = store.scene;

  if (!sel) {
    return renderEnvironmentInspector(store);
  }

  switch (sel.kind) {
    case 'point-source': {
      const ps = scene.pointSources.find((p) => p.id === sel.id);
      return ps ? renderPointSourceInspector(store, ps) : renderEnvironmentInspector(store);
    }
    case 'sub-array': {
      const sa = scene.subArrays.find((s) => s.id === sel.id);
      return sa ? renderSubArrayInspector(store, sa) : renderEnvironmentInspector(store);
    }
    case 'dsp-group': {
      const grp = scene.dspGroups.find((g) => g.id === sel.id);
      return grp ? renderDspGroupInspector(store, grp) : renderEnvironmentInspector(store);
    }
    case 'surface': {
      const surf = scene.surfaces.find((s) => s.id === sel.id);
      return surf ? renderSurfaceInspector(store, surf) : renderEnvironmentInspector(store);
    }
    case 'virtual-mic': {
      const mic = scene.virtualMics.find((m) => m.id === sel.id);
      return mic
        ? renderVirtualMicInspector(store, snapshot, mic, alignUi)
        : renderEnvironmentInspector(store);
    }
    case 'environment':
      return renderEnvironmentInspector(store);
  }
}

function renderPointSourceInspector(
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

function renderSubArrayInspector(store: ProjectStore, sa: SubArrayInstance): TemplateResult {
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
          <span class="field-label">Name</span>
          <input
            type="text"
            .value=${sa.name}
            @change=${(ev: Event) =>
              store.updateSubArray(sa.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>

        <div class="field-row">
          <span class="field-label">Array Mode</span>
          <select
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
          <span class="field-label">Sub Model</span>
          <select
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
          <span class="field-label">DSP Group</span>
          <select
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

function renderDspGroupInspector(store: ProjectStore, grp: DspGroup): TemplateResult {
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

  const patchEqBand = (bandId: string, patch: Partial<ParametricEqBand>, txKey?: string) => {
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
        <div class="form-section-title">Gain, Delay & Polarity</div>
        <div class="field-row">
          <span class="field-label">Group Name</span>
          <input
            type="text"
            .value=${grp.name}
            @change=${(ev: Event) =>
              store.updateDspGroup(grp.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>

        <div class="xy-grid" style="margin-top:6px">
          <label class="mini-field">
            <span>Gain (dB)</span>
            <input
              type="number"
              step="0.5"
              data-testid="grp-gain-db"
              .value=${String(dsp.gainDb)}
              @input=${(ev: Event) =>
                store.updateDspGroup(
                  grp.id,
                  { dsp: { gainDb: numVal(ev, dsp.gainDb) } },
                  `grp-gain-${grp.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Delay (ms)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              data-testid="grp-delay-ms"
              .value=${String(Number(dsp.delayMs.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateDspGroup(
                  grp.id,
                  { dsp: { delayMs: Math.max(0, numVal(ev, dsp.delayMs)) } },
                  `grp-dly-${grp.id}`
                )}
            />
          </label>
        </div>

        <div class="check-row">
          <label class="check-label">
            <input
              type="checkbox"
              data-testid="grp-polarity-checkbox"
              .checked=${dsp.invertPolarity}
              @change=${(ev: Event) =>
                store.updateDspGroup(grp.id, {
                  dsp: { invertPolarity: (ev.target as HTMLInputElement).checked },
                })}
            />
            Invert Polarity (Ø 180°)
          </label>
          <label class="check-label">
            <input
              type="checkbox"
              .checked=${dsp.muted}
              @change=${(ev: Event) =>
                store.updateDspGroup(grp.id, {
                  dsp: { muted: (ev.target as HTMLInputElement).checked },
                })}
            />
            Mute Group
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">High-Pass & Low-Pass Crossovers</div>
        <div class="xy-grid" style="margin-bottom:6px">
          <label class="mini-field">
            <span>HPF Slope</span>
            <select
              data-testid="grp-hpf-topology"
              .value=${dsp.highPass.topology}
              @change=${(ev: Event) =>
                store.updateDspGroup(grp.id, {
                  dsp: {
                    highPass: {
                      ...dsp.highPass,
                      topology: (ev.target as HTMLSelectElement).value as CrossoverTopology,
                    },
                  },
                })}
            >
              ${CROSSOVER_OPTIONS.map(
                (o) => html`
                  <option value=${o.value} ?selected=${o.value === dsp.highPass.topology}>
                    ${o.label}
                  </option>
                `
              )}
            </select>
          </label>
          <label class="mini-field">
            <span>HPF Freq (Hz)</span>
            <input
              type="number"
              min="20"
              max="20000"
              step="5"
              .value=${String(dsp.highPass.frequencyHz)}
              @input=${(ev: Event) =>
                store.updateDspGroup(
                  grp.id,
                  {
                    dsp: {
                      highPass: {
                        ...dsp.highPass,
                        frequencyHz: Math.max(20, numVal(ev, dsp.highPass.frequencyHz)),
                      },
                    },
                  },
                  `grp-hpf-${grp.id}`
                )}
            />
          </label>
        </div>

        <div class="xy-grid">
          <label class="mini-field">
            <span>LPF Slope</span>
            <select
              data-testid="grp-lpf-topology"
              .value=${dsp.lowPass.topology}
              @change=${(ev: Event) =>
                store.updateDspGroup(grp.id, {
                  dsp: {
                    lowPass: {
                      ...dsp.lowPass,
                      topology: (ev.target as HTMLSelectElement).value as CrossoverTopology,
                    },
                  },
                })}
            >
              ${CROSSOVER_OPTIONS.map(
                (o) => html`
                  <option value=${o.value} ?selected=${o.value === dsp.lowPass.topology}>
                    ${o.label}
                  </option>
                `
              )}
            </select>
          </label>
          <label class="mini-field">
            <span>LPF Freq (Hz)</span>
            <input
              type="number"
              min="30"
              max="20000"
              step="5"
              .value=${String(dsp.lowPass.frequencyHz)}
              @input=${(ev: Event) =>
                store.updateDspGroup(
                  grp.id,
                  {
                    dsp: {
                      lowPass: {
                        ...dsp.lowPass,
                        frequencyHz: Math.max(30, numVal(ev, dsp.lowPass.frequencyHz)),
                      },
                    },
                  },
                  `grp-lpf-${grp.id}`
                )}
            />
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">
          <span>Parametric EQ (${dsp.eqBands.length}/8)</span>
          <button
            class="btn btn-xs"
            data-testid="btn-add-eq-band"
            ?disabled=${dsp.eqBands.length >= 8}
            @click=${addEqBand}
          >
            + Add Band
          </button>
        </div>

        ${dsp.eqBands.map(
          (band, idx) => html`
            <div class="eq-card" data-testid="eq-band-${idx}">
              <div class="eq-card-top">
                <label class="check-label">
                  <input
                    type="checkbox"
                    .checked=${band.enabled}
                    @change=${(ev: Event) =>
                      patchEqBand(band.id, { enabled: (ev.target as HTMLInputElement).checked })}
                  />
                  #${idx + 1}
                </label>
                <select
                  .value=${band.type}
                  @change=${(ev: Event) =>
                    patchEqBand(band.id, {
                      type: (ev.target as HTMLSelectElement).value as BiquadFilterType,
                    })}
                >
                  ${EQ_TYPES.map(
                    (t) => html`
                      <option value=${t.value} ?selected=${t.value === band.type}>
                        ${t.label}
                      </option>
                    `
                  )}
                </select>
                <button
                  class="btn btn-xs btn-danger"
                  @click=${() =>
                    store.updateDspGroup(grp.id, {
                      dsp: { eqBands: dsp.eqBands.filter((b) => b.id !== band.id) },
                    })}
                >
                  ×
                </button>
              </div>
              <div class="xyz-grid">
                <label class="mini-field">
                  <span>Freq (Hz)</span>
                  <input
                    type="number"
                    min="20"
                    max="20000"
                    step="10"
                    .value=${String(band.frequencyHz)}
                    @input=${(ev: Event) =>
                      patchEqBand(
                        band.id,
                        { frequencyHz: Math.max(20, numVal(ev, band.frequencyHz)) },
                        `eq-f-${band.id}`
                      )}
                  />
                </label>
                <label class="mini-field">
                  <span>Gain (dB)</span>
                  <input
                    type="number"
                    min="-18"
                    max="15"
                    step="0.5"
                    .value=${String(band.gainDb)}
                    @input=${(ev: Event) =>
                      patchEqBand(
                        band.id,
                        { gainDb: numVal(ev, band.gainDb) },
                        `eq-g-${band.id}`
                      )}
                  />
                </label>
                <label class="mini-field">
                  <span>Q</span>
                  <input
                    type="number"
                    min="0.2"
                    max="20"
                    step="0.1"
                    .value=${String(band.q)}
                    @input=${(ev: Event) =>
                      patchEqBand(
                        band.id,
                        { q: Math.max(0.1, numVal(ev, band.q)) },
                        `eq-q-${band.id}`
                      )}
                  />
                </label>
              </div>
            </div>
          `
        )}
      </div>
    </div>
  `;
}

function renderSurfaceInspector(store: ProjectStore, surf: AudienceSurface): TemplateResult {
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

function renderVirtualMicInspector(
  store: ProjectStore,
  snapshot: SimulationSnapshot | null,
  mic: VirtualMicInstance,
  alignUi: AlignmentUiState
): TemplateResult {
  const scene = store.scene;
  const micRes = snapshot?.virtualMics.find((m) => m.micId === mic.id);
  const groups = scene.dspGroups;

  const refGroupId =
    groups.find((g) => g.id === alignUi.refGroupId)?.id ?? groups[0]?.id ?? '';
  const targetGroupId =
    groups.find((g) => g.id === alignUi.targetGroupId && g.id !== refGroupId)?.id ??
    groups.find((g) => g.id !== refGroupId)?.id ??
    refGroupId;

  // Compute live alignment recommendation between Reference and Target DSP groups
  const radiators = expandSceneRadiators(scene, store.getSpeakerMap());
  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  const refGroup = groups.find((g) => g.id === refGroupId);
  const tgtGroup = groups.find((g) => g.id === targetGroupId);

  const refSources = radiators
    .filter((r) => r.dspGroupId === refGroupId)
    .map((r) => ({
      position: r.position,
      electronicDelayMs: r.dspChain.delaySeconds * 1000,
    }));

  // Exclude target group's existing group delay so we calculate the clean total delay needed on targetGroup
  const tgtBaseDelayMs = tgtGroup?.dsp.delayMs ?? 0;
  const tgtSources = radiators
    .filter((r) => r.dspGroupId === targetGroupId)
    .map((r) => ({
      position: r.position,
      electronicDelayMs: Math.max(0, r.dspChain.delaySeconds * 1000 - tgtBaseDelayMs),
    }));

  let phaseDiffRad = 0;
  if (refGroup && tgtGroup) {
    const refChain = compileDspChain({ ...refGroup.dsp, delayMs: 0, invertPolarity: false });
    const tgtChain = compileDspChain({ ...tgtGroup.dsp, delayMs: 0, invertPolarity: false });
    const hRef = evaluateCompiledDspAtFrequency(refChain, alignUi.alignFreqHz);
    const hTgt = evaluateCompiledDspAtFrequency(tgtChain, alignUi.alignFreqHz);
    phaseDiffRad = Math.atan2(hRef.im, hRef.re) - Math.atan2(hTgt.im, hTgt.re);
  }

  const canAlign = refGroupId !== targetGroupId && refSources.length > 0 && tgtSources.length > 0;
  const rec = canAlign
    ? computeTimeAlignmentAtPoint(refSources, tgtSources, mic.position, c, phaseDiffRad)
    : null;

  const applyAutoAlignment = () => {
    if (!rec || !tgtGroup || !refGroup) return;
    if (rec.recommendedDeltaDelayMs >= 0) {
      const nextDelay = Math.round(rec.recommendedDeltaDelayMs * 100) / 100;
      store.updateDspGroup(tgtGroup.id, {
        dsp: { delayMs: nextDelay, invertPolarity: rec.recommendedInvertPolarity },
      });
      alignUi.onNotify(
        `Aligned "${tgtGroup.name}" to "${refGroup.name}" at ${mic.name}: ${nextDelay.toFixed(2)} ms${
          rec.recommendedInvertPolarity ? ' (Ø Inv)' : ''
        }`
      );
    } else {
      // Target is physically farther than Reference -> add extra delay onto Reference instead
      const extraRefDelay =
        Math.round((refGroup.dsp.delayMs + Math.abs(rec.recommendedDeltaDelayMs)) * 100) / 100;
      store.updateDspGroup(refGroup.id, { dsp: { delayMs: extraRefDelay } });
      store.updateDspGroup(tgtGroup.id, {
        dsp: { delayMs: 0, invertPolarity: rec.recommendedInvertPolarity },
      });
      alignUi.onNotify(
        `Delayed closer group "${refGroup.name}" to ${extraRefDelay.toFixed(2)} ms to match "${tgtGroup.name}" at ${mic.name}`
      );
    }
  };

  return html`
    <div data-testid="inspector-virtual-mic">
      <div class="insp-header">
        <span class="insp-title">Virtual Measurement Mic</span>
        <button
          class="btn btn-xs btn-danger"
          data-testid="btn-delete-entity"
          @click=${() => store.removeVirtualMic(mic.id)}
        >
          Delete
        </button>
      </div>

      <div class="form-section">
        <div class="form-section-title">Microphone Coordinates</div>
        <div class="field-row">
          <span class="field-label">Name</span>
          <input
            type="text"
            .value=${mic.name}
            @change=${(ev: Event) =>
              store.updateVirtualMic(mic.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>

        <div class="xyz-grid" style="margin-top:6px">
          <label class="mini-field">
            <span>X (m)</span>
            <input
              type="number"
              step="0.2"
              data-testid="mic-pos-x"
              .value=${String(Number(mic.position.x.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateVirtualMic(
                  mic.id,
                  { position: { ...mic.position, x: numVal(ev, mic.position.x) } },
                  `mic-pos-${mic.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Y (m)</span>
            <input
              type="number"
              step="0.2"
              data-testid="mic-pos-y"
              .value=${String(Number(mic.position.y.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateVirtualMic(
                  mic.id,
                  { position: { ...mic.position, y: numVal(ev, mic.position.y) } },
                  `mic-pos-${mic.id}`
                )}
            />
          </label>
          <label class="mini-field">
            <span>Z Ear (m)</span>
            <input
              type="number"
              step="0.05"
              data-testid="mic-pos-z"
              .value=${String(Number(mic.position.z.toFixed(2)))}
              @input=${(ev: Event) =>
                store.updateVirtualMic(
                  mic.id,
                  { position: { ...mic.position, z: Math.max(0.05, numVal(ev, mic.position.z)) } },
                  `mic-pos-${mic.id}`
                )}
            />
          </label>
        </div>
      </div>

      ${micRes
        ? html`
            <div class="form-section" data-testid="mic-predicted-readout">
              <div class="form-section-title">Predicted Level & Arrival</div>
              <div class="xyz-grid" style="font-family:var(--font-mono);font-size:11px">
                <div><strong>${micRes.broadbandSplADb.toFixed(1)}</strong> dBA</div>
                <div><strong>${micRes.broadbandSplCDb.toFixed(1)}</strong> dBC</div>
                <div><strong>${micRes.referenceDelayMs.toFixed(2)}</strong> ms</div>
              </div>
            </div>
          `
        : ''}

      <div class="form-section" data-testid="auto-time-align-panel">
        <div class="form-section-title">Auto Time-Alignment @ ${mic.name}</div>
        <div class="field-row">
          <span class="field-label">Reference</span>
          <select
            data-testid="align-ref-select"
            .value=${refGroupId}
            @change=${(ev: Event) =>
              alignUi.onChange({ refGroupId: (ev.target as HTMLSelectElement).value })}
          >
            ${groups.map(
              (g) => html`<option value=${g.id} ?selected=${g.id === refGroupId}>${g.name}</option>`
            )}
          </select>
        </div>

        <div class="field-row">
          <span class="field-label">Target</span>
          <select
            data-testid="align-target-select"
            .value=${targetGroupId}
            @change=${(ev: Event) =>
              alignUi.onChange({ targetGroupId: (ev.target as HTMLSelectElement).value })}
          >
            ${groups.map(
              (g) =>
                html`<option value=${g.id} ?selected=${g.id === targetGroupId}>${g.name}</option>`
            )}
          </select>
        </div>

        <div class="field-row">
          <span class="field-label">Align Freq (Hz)</span>
          <input
            type="number"
            min="30"
            max="4000"
            step="5"
            .value=${String(alignUi.alignFreqHz)}
            @input=${(ev: Event) =>
              alignUi.onChange({ alignFreqHz: Math.max(30, numVal(ev, alignUi.alignFreqHz)) })}
          />
        </div>

        ${rec
          ? html`
              <div
                style="margin:6px 0;font-family:var(--font-mono);font-size:10.5px;color:var(--text-secondary)"
              >
                Ref arrival: ${rec.referenceMeanArrivalMs.toFixed(2)} ms · Target raw:
                ${rec.targetMeanArrivalMs.toFixed(2)} ms<br />
                Recommended Δ:
                <strong style="color:var(--accent-bright)">
                  ${rec.recommendedDeltaDelayMs >= 0 ? '+' : ''}${rec.recommendedDeltaDelayMs.toFixed(
                    2
                  )}
                  ms
                </strong>
                · Polarity:
                <strong>${rec.recommendedInvertPolarity ? 'Invert (Ø)' : 'Normal (+)'}</strong>
              </div>
              <button
                class="btn btn-primary"
                style="width:100%"
                data-testid="btn-apply-alignment"
                @click=${applyAutoAlignment}
              >
                Apply Delay & Polarity
              </button>
            `
          : html`
              <div class="insp-subtitle" style="margin-top:4px">
                Select two distinct active DSP groups to compute time & phase alignment.
              </div>
            `}
      </div>
    </div>
  `;
}

function renderEnvironmentInspector(store: ProjectStore): TemplateResult {
  const scene = store.scene;
  const cmap = store.colormap;
  const speedOfSound = computeSpeedOfSoundMpS(scene.atmosphere);
  const ground = scene.reflectors.find((r) => r.id === DEFAULT_GROUND_REFLECTOR.id);

  return html`
    <div data-testid="inspector-environment">
      <div class="insp-header">
        <span class="insp-title">Atmosphere, Colormap & Venue</span>
      </div>

      <div class="form-section">
        <div class="form-section-title">Project & Drive Level</div>
        <div class="field-row">
          <span class="field-label">Project Name</span>
          <input
            type="text"
            .value=${scene.name}
            @change=${(ev: Event) =>
              store.updateScene((s) => ({
                ...s,
                name: (ev.target as HTMLInputElement).value,
              }))}
          />
        </div>
        <div class="field-row">
          <span class="field-label">Drive Offset (dB)</span>
          <input
            type="number"
            step="1"
            min="-40"
            max="6"
            .value=${String(scene.driveOffsetDb)}
            @input=${(ev: Event) =>
              store.setDriveOffsetDb(numVal(ev, scene.driveOffsetDb), 'env-drive')}
          />
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">
          <span>ISO 9613-1 Atmosphere</span>
          <span>c = ${speedOfSound.toFixed(1)} m/s</span>
        </div>
        <div class="xyz-grid">
          <label class="mini-field">
            <span>Temp (°C)</span>
            <input
              type="number"
              step="1"
              min="-20"
              max="50"
              data-testid="env-temp-c"
              .value=${String(scene.atmosphere.temperatureCelsius)}
              @input=${(ev: Event) =>
                store.setAtmosphere(
                  { temperatureCelsius: numVal(ev, scene.atmosphere.temperatureCelsius) },
                  'env-atm'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Humidity (%)</span>
            <input
              type="number"
              step="5"
              min="5"
              max="100"
              data-testid="env-rh-pct"
              .value=${String(scene.atmosphere.relativeHumidityPercent)}
              @input=${(ev: Event) =>
                store.setAtmosphere(
                  {
                    relativeHumidityPercent: Math.max(
                      5,
                      Math.min(100, numVal(ev, scene.atmosphere.relativeHumidityPercent))
                    ),
                  },
                  'env-atm'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Pressure (kPa)</span>
            <input
              type="number"
              step="0.5"
              .value=${String(scene.atmosphere.pressureKpa)}
              @input=${(ev: Event) =>
                store.setAtmosphere(
                  { pressureKpa: Math.max(70, numVal(ev, scene.atmosphere.pressureKpa)) },
                  'env-atm'
                )}
            />
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Ground-Plane Reflection (Z = 0)</div>
        <div class="field-row">
          <span class="field-label">ReflectFactor</span>
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            .value=${String(ground?.reflectionFactor ?? 0.9)}
            @input=${(ev: Event) =>
              store.setGroundReflection(
                ground?.enabled ?? true,
                Math.max(0, Math.min(1, numVal(ev, 0.9))),
                'env-gnd'
              )}
          />
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">SPL Colormap Scale</div>
        <div class="xy-grid">
          <label class="mini-field">
            <span>Min SPL (dB)</span>
            <input
              type="number"
              step="3"
              .value=${String(cmap.minSplDb)}
              @input=${(ev: Event) => store.setColormap({ minSplDb: numVal(ev, cmap.minSplDb) })}
            />
          </label>
          <label class="mini-field">
            <span>Max SPL (dB)</span>
            <input
              type="number"
              step="3"
              .value=${String(cmap.maxSplDb)}
              @input=${(ev: Event) => store.setColormap({ maxSplDb: numVal(ev, cmap.maxSplDb) })}
            />
          </label>
        </div>
        <div class="check-row">
          <label class="check-label">
            <input
              type="checkbox"
              .checked=${cmap.showOutsideSurfaces}
              @change=${(ev: Event) =>
                store.setColormap({
                  showOutsideSurfaces: (ev.target as HTMLInputElement).checked,
                })}
            />
            Show SPL Outside Audience Zones
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Side Section Slice</div>
        <div class="field-row">
          <span class="field-label">Slice Y (m)</span>
          <input
            type="number"
            step="0.5"
            data-testid="env-slice-y"
            .value=${String(Number(scene.sectionBounds.sliceYM.toFixed(2)))}
            @input=${(ev: Event) =>
              store.setSliceYM(numVal(ev, scene.sectionBounds.sliceYM), 'env-slice')}
          />
        </div>
      </div>
    </div>
  `;
}
