// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for Virtual Measurement Microphones, predicted `.frd` export,
 * and interactive inter-group Auto Time-Alignment.
 */

import { downloadTextFile, numVal, slugifyFilename } from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { VirtualMicInstance } from '../../model/project-types.js';
import { computeGroupAlignmentPreview } from '../../physics/group-alignment.js';
import type { SimulationSnapshot } from '../../physics/sim-controller.js';
import { exportVirtualMicToFrd } from '../../physics/virtual-mic-solver.js';

export interface AlignmentUiState {
  readonly refGroupId: string;
  readonly targetGroupId: string;
  readonly alignFreqHz: number;
  readonly onChange: (patch: Partial<Omit<AlignmentUiState, 'onChange' | 'onNotify'>>) => void;
  readonly onNotify: (msg: string) => void;
}

export function renderVirtualMicInspector(
  store: ProjectStore,
  snapshot: SimulationSnapshot | null,
  mic: VirtualMicInstance,
  alignUi: AlignmentUiState
): TemplateResult {
  const scene = store.scene;
  const micRes = snapshot?.virtualMics.find((m) => m.micId === mic.id);
  const groups = scene.dspGroups;

  const preview = computeGroupAlignmentPreview(
    scene,
    store.getSpeakerMap(),
    alignUi.refGroupId,
    alignUi.targetGroupId,
    mic.position,
    alignUi.alignFreqHz
  );
  const { refGroup, targetGroup: tgtGroup, refGroupId, targetGroupId, recommendation: rec } =
    preview;

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
      <div class="foh-insp-header">
        <span class="foh-insp-title">Virtual Measurement Mic</span>
        <button
          class="foh-btn foh-btn-xs foh-btn-danger"
          data-testid="btn-delete-entity"
          @click=${() => store.removeVirtualMic(mic.id)}
        >
          Delete
        </button>
      </div>

      <div class="foh-form-section">
        <div class="foh-form-section-title">Microphone Coordinates</div>
        <div class="field-row">
          <label class="field-label" for="mic-name-input">Name</label>
          <input
            type="text"
            id="mic-name-input"
            name="mic-name"
            .value=${mic.name}
            @change=${(ev: Event) =>
              store.updateVirtualMic(mic.id, { name: (ev.target as HTMLInputElement).value })}
          />
        </div>

        <div class="foh-xyz-grid" style="margin-top:6px">
          <label class="foh-mini-field">
            <span>X (m)</span>
            <input
              type="number"
              name="mic-pos-x"
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
          <label class="foh-mini-field">
            <span>Y (m)</span>
            <input
              type="number"
              name="mic-pos-y"
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
          <label class="foh-mini-field">
            <span>Z Ear (m)</span>
            <input
              type="number"
              name="mic-pos-z"
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
            <div class="foh-form-section" data-testid="mic-predicted-readout">
              <div class="foh-form-section-title">Predicted Level & Arrival</div>
              <div class="foh-xyz-grid" style="font-family:var(--_foh-font-mono);font-size:11px">
                <div><strong>${micRes.broadbandSplADb.toFixed(1)}</strong> dBA</div>
                <div><strong>${micRes.broadbandSplCDb.toFixed(1)}</strong> dBC</div>
                <div><strong>${micRes.referenceDelayMs.toFixed(2)}</strong> ms</div>
              </div>
              <button
                class="foh-btn foh-btn-xs"
                style="width:100%;margin-top:8px"
                data-testid="btn-export-mic-frd"
                title="Export predicted Magnitude + Phase curve as .frd for WebSoundMeter comparison"
                @click=${() => {
                  const frdText = exportVirtualMicToFrd(micRes);
                  const slug = slugifyFilename(mic.name, 'virtual-mic');
                  downloadTextFile(
                    `${slug}-predicted.frd`,
                    frdText,
                    'text/plain;charset=utf-8'
                  );
                  alignUi.onNotify(`Exported "${mic.name}" predicted response (.frd)`);
                }}
              >
                Export Predicted .FRD
              </button>
            </div>
          `
        : ''}

      <div class="foh-form-section" data-testid="auto-time-align-panel">
        <div class="foh-form-section-title">Auto Time-Alignment @ ${mic.name}</div>
        <div class="field-row">
          <label class="field-label" for="align-ref-select">Reference</label>
          <select
            id="align-ref-select"
            name="align-ref-group"
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
          <label class="field-label" for="align-target-select">Target</label>
          <select
            id="align-target-select"
            name="align-target-group"
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
          <label class="field-label" for="align-freq-hz">Align Freq (Hz)</label>
          <input
            type="number"
            id="align-freq-hz"
            name="align-freq-hz"
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
                style="margin:6px 0;font-family:var(--_foh-font-mono);font-size:10.5px;color:var(--_foh-text-secondary)"
              >
                Ref arrival: ${rec.referenceMeanArrivalMs.toFixed(2)} ms · Target raw:
                ${rec.targetMeanArrivalMs.toFixed(2)} ms<br />
                Recommended Δ:
                <strong style="color:var(--_foh-accent-bright)">
                  ${rec.recommendedDeltaDelayMs >= 0 ? '+' : ''}${rec.recommendedDeltaDelayMs.toFixed(
                    2
                  )}
                  ms
                </strong>
                · Polarity:
                <strong>${rec.recommendedInvertPolarity ? 'Invert (Ø)' : 'Normal (+)'}</strong>
              </div>
              <button
                class="foh-btn foh-btn-primary"
                style="width:100%"
                data-testid="btn-apply-alignment"
                @click=${applyAutoAlignment}
              >
                Apply Delay & Polarity
              </button>
            `
          : html`
              <div class="foh-insp-subtitle">
                Select two distinct active DSP groups to compute time & phase alignment.
              </div>
            `}
      </div>
    </div>
  `;
}
