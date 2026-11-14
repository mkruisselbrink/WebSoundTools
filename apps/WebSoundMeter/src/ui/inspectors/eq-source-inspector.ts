// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { BiquadFilterType, BiquadSpec, CrossoverTopology } from '@foh/dsp';
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

const CROSSOVER_OPTIONS: ReadonlyArray<{ readonly value: CrossoverTopology; readonly label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'butterworth-12', label: 'BW 12 dB/oct' },
  { value: 'butterworth-18', label: 'BW 18 dB/oct' },
  { value: 'butterworth-24', label: 'BW 24 dB/oct' },
  { value: 'butterworth-48', label: 'BW 48 dB/oct' },
  { value: 'linkwitz-riley-12', label: 'LR 12 dB/oct' },
  { value: 'linkwitz-riley-24', label: 'LR 24 dB/oct' },
  { value: 'linkwitz-riley-48', label: 'LR 48 dB/oct' },
];

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
            title="Load corrective inverse EQ matching the PA Room Modes simulator preset"
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
          <option value="">None (Show Filter Curve Only)</option>
          ${candidateTargets.map(
            (s) => html`<option value=${s.id}>${s.name}</option>`
          )}
        </select>
      </div>

      ${handlers.onUpdateEqDsp
        ? html`
            <div class="prop-grid">
              <div class="prop-field">
                <label>Gain (dB)</label>
                <input
                  type="number"
                  step="0.5"
                  aria-label="Virtual EQ Gain (dB)"
                  data-testid="eq-dsp-gain"
                  .value=${String(dsp.gainDb)}
                  @input=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(
                      eq.id,
                      { gainDb: Number((e.target as HTMLInputElement).value) || 0 },
                      `eq-gain-${eq.id}`
                    )}
                />
              </div>

              <div class="prop-field">
                <label>Delay (ms)</label>
                <input
                  type="number"
                  step="0.1"
                  aria-label="Virtual EQ Delay (ms)"
                  data-testid="eq-dsp-delay"
                  .value=${String(dsp.delayMs)}
                  @input=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(
                      eq.id,
                      { delayMs: Number((e.target as HTMLInputElement).value) || 0 },
                      `eq-delay-${eq.id}`
                    )}
                />
              </div>

              <div class="prop-field">
                <label>HPF Crossover</label>
                <select
                  aria-label="Virtual EQ HPF Topology"
                  data-testid="eq-hpf-topology"
                  .value=${dsp.highPass.topology}
                  @change=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(eq.id, {
                      highPass: {
                        topology: (e.target as HTMLSelectElement).value as CrossoverTopology,
                      },
                    })}
                >
                  ${CROSSOVER_OPTIONS.map(
                    (o) => html`<option value=${o.value}>${o.label}</option>`
                  )}
                </select>
              </div>

              <div class="prop-field">
                <label>HPF Freq (Hz)</label>
                <input
                  type="number"
                  min="15"
                  max="20000"
                  aria-label="Virtual EQ HPF Frequency (Hz)"
                  data-testid="eq-hpf-freq"
                  .value=${String(dsp.highPass.frequencyHz)}
                  @change=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(eq.id, {
                      highPass: {
                        frequencyHz: Math.max(
                          15,
                          Number((e.target as HTMLInputElement).value) || 80
                        ),
                      },
                    })}
                />
              </div>

              <div class="prop-field">
                <label>LPF Crossover</label>
                <select
                  aria-label="Virtual EQ LPF Topology"
                  data-testid="eq-lpf-topology"
                  .value=${dsp.lowPass.topology}
                  @change=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(eq.id, {
                      lowPass: {
                        topology: (e.target as HTMLSelectElement).value as CrossoverTopology,
                      },
                    })}
                >
                  ${CROSSOVER_OPTIONS.map(
                    (o) => html`<option value=${o.value}>${o.label}</option>`
                  )}
                </select>
              </div>

              <div class="prop-field">
                <label>LPF Freq (Hz)</label>
                <input
                  type="number"
                  min="20"
                  max="20000"
                  aria-label="Virtual EQ LPF Frequency (Hz)"
                  data-testid="eq-lpf-freq"
                  .value=${String(dsp.lowPass.frequencyHz)}
                  @change=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(eq.id, {
                      lowPass: {
                        frequencyHz: Math.max(
                          20,
                          Number((e.target as HTMLInputElement).value) || 120
                        ),
                      },
                    })}
                />
              </div>
            </div>

            <div style="display:flex;gap:12px;align-items:center;font-size:11px;color:#cbd5e1;">
              <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
                <input
                  type="checkbox"
                  data-testid="eq-dsp-polarity"
                  .checked=${dsp.invertPolarity}
                  @change=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(eq.id, {
                      invertPolarity: (e.target as HTMLInputElement).checked,
                    })}
                />
                Invert Polarity (Ø)
              </label>
              <label style="display:flex;gap:4px;align-items:center;cursor:pointer;">
                <input
                  type="checkbox"
                  data-testid="eq-dsp-muted"
                  .checked=${dsp.muted}
                  @change=${(e: Event) =>
                    handlers.onUpdateEqDsp?.(eq.id, {
                      muted: (e.target as HTMLInputElement).checked,
                    })}
                />
                Bypass / Mute Output
              </label>
            </div>
          `
        : nothing}

      <div style="font-size:10px;color:#94a3b8;">
        Tip: Drag green EQ handles directly on the Magnitude chart!
      </div>

      ${eq.bands.map(
        (b, idx) => html`
          <div class="eq-band-row">
            <input
              type="checkbox"
              aria-label="Enable EQ Band ${idx + 1}"
              .checked=${b.enabled !== false}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  enabled: (e.target as HTMLInputElement).checked,
                })}
            />
            <select
              aria-label="EQ Band ${idx + 1} Type"
              .value=${b.type}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  type: (e.target as HTMLSelectElement).value as BiquadFilterType,
                })}
            >
              <option value="peaking">Bell</option>
              <option value="lowshelf">LShelf</option>
              <option value="highshelf">HShelf</option>
              <option value="highpass">HPF</option>
              <option value="lowpass">LPF</option>
              <option value="notch">Notch</option>
              <option value="bandpass">BandPass</option>
              <option value="allpass">AllPass</option>
            </select>
            <input
              type="number"
              aria-label="EQ Band ${idx + 1} Frequency (Hz)"
              title="Frequency (Hz)"
              .value=${String(b.frequency)}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  frequency: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              type="number"
              step="0.5"
              aria-label="EQ Band ${idx + 1} Gain (dB)"
              title="Gain (dB)"
              .value=${String(b.gainDb ?? 0)}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  gainDb: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              type="number"
              step="0.1"
              aria-label="EQ Band ${idx + 1} Q Factor"
              title="Q Factor"
              .value=${String(b.q ?? 0.7)}
              @change=${(e: Event) =>
                handlers.onUpdateEqBand(eq.id, idx, {
                  q: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>
        `
      )}
    </div>
  `;
}
