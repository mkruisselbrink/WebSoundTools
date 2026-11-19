// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BiquadSpec, ParametricEqBand } from '@foh/dsp';
import { renderDspChainEditor } from '@foh/ui';
import { html, nothing, TemplateResult } from 'lit';
import {
  EqualizerSourceConfig,
  SourceDspPatch,
  resolveEqDspConfig,
} from '../../sources/eq-source.js';
import { SourceData } from '../../sources/source-data.js';

export interface EqInspectorHandlers {
  readonly onAutoFlatten: (eqId: string) => void;
  readonly onTargetSourceChange: (eqId: string, targetSourceId: string | null) => void;
  readonly onUpdateEqBand: (
    eqId: string,
    bandIdx: number,
    partial: Partial<BiquadSpec>
  ) => void;
  readonly onUpdateEqDsp?: (eqId: string, patch: SourceDspPatch, txKey?: string) => void;
  readonly onDelete?: (eqId: string) => void;
}

export function renderEqInspector(
  eq: EqualizerSourceConfig,
  allSources: readonly SourceData[],
  handlers: EqInspectorHandlers
): TemplateResult {
  const candidateTargets = allSources.filter(
    (s) => s.kind === 'measurement' || s.kind === 'stored'
  );
  const dsp = resolveEqDspConfig(eq);

  return html`
    <div class="section-card" data-testid="inspector-eq-source">
      <div class="section-header">
        <span>${eq.name}</span>
        <div style="display:flex;gap:4px;">
          <button
            class="btn-accent"
            data-testid="btn-auto-flatten-eq"
            title="Synthesize subtractive parametric EQ bands for broad resonances on the target trace"
            @click=${() => handlers.onAutoFlatten(eq.id)}
          >
            Auto-Match Room
          </button>
          ${handlers.onDelete
            ? html`
                <button
                  style="color:#f43f5e;"
                  @click=${() => handlers.onDelete?.(eq.id)}
                >
                  Delete
                </button>
              `
            : nothing}
        </div>
      </div>

      <div class="prop-field full-width">
        <label>Apply Virtual EQ To Source</label>
        <select
          aria-label="Apply Virtual EQ To Source"
          .value=${eq.targetSourceId ?? ''}
          @change=${(e: Event) => {
            const targetSourceId = (e.target as HTMLSelectElement).value || null;
            handlers.onTargetSourceChange(eq.id, targetSourceId);
          }}
        >
          <option value="" ?selected=${!eq.targetSourceId}>
            None (Show Filter Curve Only)
          </option>
          ${candidateTargets.map(
            (s) =>
              html`<option value=${s.id} ?selected=${s.id === eq.targetSourceId}>
                ${s.name}
              </option>`
          )}
        </select>
      </div>

      ${renderDspChainEditor({
        entityId: eq.id,
        dsp,
        maxEqBands: 12,
        allowNegativeDelay: true,
        muteLabel: 'Bypass / Mute Output',
        tipText: 'Tip: Drag EQ handles for Freq/Gain; Shift + Drag or Wheel for Q.',
        testIds: {
          gainDb: 'eq-dsp-gain',
          delayMs: 'eq-dsp-delay',
          invertPolarity: 'eq-dsp-polarity',
          muted: 'eq-dsp-muted',
          hpfTopology: 'eq-hpf-topology',
          hpfFrequency: 'eq-hpf-freq',
          lpfTopology: 'eq-lpf-topology',
          lpfFrequency: 'eq-lpf-freq',
          addEqBand: 'btn-add-eq-band',
          eqBandCardPrefix: 'eq-band-',
        },
        onPatchDsp: (patch, txKey) => handlers.onUpdateEqDsp?.(eq.id, patch, txKey),
        onPatchEqBand: (bandIdx, _bandId, patch, txKey) => {
          if (handlers.onUpdateEqDsp) {
            handlers.onUpdateEqDsp(
              eq.id,
              {
                eqBands: dsp.eqBands.map((b, i) =>
                  i === bandIdx ? { ...b, ...patch } : b
                ),
              },
              txKey
            );
          } else {
            handlers.onUpdateEqBand(eq.id, bandIdx, {
              enabled: patch.enabled,
              type: patch.type,
              frequency: patch.frequencyHz,
              gainDb: patch.gainDb,
              q: patch.q,
            });
          }
        },
        onAddEqBand: handlers.onUpdateEqDsp
          ? () => {
              if (dsp.eqBands.length >= 12) return;
              const nextBand: ParametricEqBand = {
                id: `band-${Date.now().toString(36)}-${dsp.eqBands.length + 1}`,
                enabled: true,
                type: 'peaking',
                frequencyHz: 1000,
                gainDb: 0,
                q: 2.0,
              };
              handlers.onUpdateEqDsp?.(eq.id, {
                eqBands: [...dsp.eqBands, nextBand],
              });
            }
          : undefined,
        onRemoveEqBand:
          handlers.onUpdateEqDsp && dsp.eqBands.length > 1
            ? (_idx, bandId) => {
                handlers.onUpdateEqDsp?.(eq.id, {
                  eqBands: dsp.eqBands.filter((b) => b.id !== bandId),
                });
              }
            : undefined,
      })}
    </div>
  `;
}
