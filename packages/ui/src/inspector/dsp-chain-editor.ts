// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  BiquadFilterType,
  CrossoverTopology,
  ParametricEqBand,
  SourceDspConfig,
  SourceDspConfigPatch,
} from '@foh/dsp';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohControlsCss } from '../styles/controls.css.js';
import { fohPanelsCss } from '../styles/panels.css.js';
import { fohTokensCss } from '../styles/tokens.css.js';
import { numVal } from './field-primitives.js';

export const CROSSOVER_TOPOLOGY_OPTIONS: ReadonlyArray<{
  readonly value: CrossoverTopology;
  readonly label: string;
}> = [
  { value: 'off', label: 'Off (Bypass)' },
  { value: 'butterworth-12', label: 'BW 12 dB/oct' },
  { value: 'butterworth-18', label: 'BW 18 dB/oct' },
  { value: 'butterworth-24', label: 'BW 24 dB/oct' },
  { value: 'butterworth-48', label: 'BW 48 dB/oct' },
  { value: 'linkwitz-riley-12', label: 'LR 12 dB/oct' },
  { value: 'linkwitz-riley-24', label: 'LR 24 dB/oct' },
  { value: 'linkwitz-riley-48', label: 'LR 48 dB/oct' },
];

export const EQ_FILTER_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: BiquadFilterType;
  readonly label: string;
}> = [
  { value: 'peaking', label: 'Peaking (Bell)' },
  { value: 'lowshelf', label: 'Low Shelf' },
  { value: 'highshelf', label: 'High Shelf' },
  { value: 'highpass', label: 'High-Pass (Q)' },
  { value: 'lowpass', label: 'Low-Pass (Q)' },
  { value: 'notch', label: 'Notch' },
  { value: 'bandpass', label: 'Band-Pass' },
  { value: 'allpass', label: 'All-Pass (Phase)' },
];

export interface DspChainEditorTestIds {
  readonly gainDb?: string;
  readonly delayMs?: string;
  readonly invertPolarity?: string;
  readonly muted?: string;
  readonly hpfTopology?: string;
  readonly hpfFrequency?: string;
  readonly lpfTopology?: string;
  readonly lpfFrequency?: string;
  readonly addEqBand?: string;
  readonly eqBandCardPrefix?: string;
}

export interface DspChainEditorProps {
  readonly entityId: string;
  readonly dsp: SourceDspConfig;
  readonly maxEqBands?: number;
  readonly allowNegativeDelay?: boolean;
  readonly muteLabel?: string;
  readonly tipText?: string;
  readonly testIds?: DspChainEditorTestIds;
  readonly onPatchDsp: (patch: SourceDspConfigPatch, transactionKey?: string) => void;
  readonly onPatchEqBand: (
    bandIndex: number,
    bandId: string,
    patch: Partial<ParametricEqBand>,
    transactionKey?: string
  ) => void;
  readonly onAddEqBand?: () => void;
  readonly onRemoveEqBand?: (bandIndex: number, bandId: string) => void;
}

export function renderDspChainEditor(props: DspChainEditorProps): TemplateResult {
  const { dsp, entityId, testIds } = props;
  const maxBands = props.maxEqBands ?? 8;
  const minDelay = props.allowNegativeDelay ? undefined : 0;

  return html`
    <div class="foh-form-section">
      <div class="foh-form-section-title">Gain, Delay & Polarity</div>
      <div class="foh-xy-grid">
        <label class="foh-mini-field">
          <span>Gain (dB)</span>
          <input
            type="number"
            step="0.5"
            aria-label="Gain (dB)"
            data-testid=${testIds?.gainDb ?? 'foh-dsp-gain'}
            .value=${String(dsp.gainDb)}
            @input=${(ev: Event) =>
              props.onPatchDsp(
                { gainDb: numVal(ev, dsp.gainDb) },
                `dsp-gain-${entityId}`
              )}
          />
        </label>
        <label class="foh-mini-field">
          <span>Delay (ms)</span>
          <input
            type="number"
            step="0.1"
            min=${minDelay !== undefined ? String(minDelay) : nothing}
            aria-label="Delay (ms)"
            data-testid=${testIds?.delayMs ?? 'foh-dsp-delay'}
            .value=${String(Number(dsp.delayMs.toFixed(2)))}
            @input=${(ev: Event) => {
              const raw = numVal(ev, dsp.delayMs);
              const clamped = minDelay !== undefined ? Math.max(minDelay, raw) : raw;
              props.onPatchDsp({ delayMs: clamped }, `dsp-dly-${entityId}`);
            }}
          />
        </label>
      </div>

      <div class="foh-check-row">
        <label class="foh-check-label">
          <input
            type="checkbox"
            aria-label="Invert Polarity"
            data-testid=${testIds?.invertPolarity ?? 'foh-dsp-polarity'}
            .checked=${dsp.invertPolarity}
            @change=${(ev: Event) =>
              props.onPatchDsp({
                invertPolarity: (ev.target as HTMLInputElement).checked,
              })}
          />
          Invert Polarity (Ø 180°)
        </label>
        <label class="foh-check-label">
          <input
            type="checkbox"
            aria-label=${props.muteLabel ?? 'Mute'}
            data-testid=${testIds?.muted ?? 'foh-dsp-muted'}
            .checked=${dsp.muted}
            @change=${(ev: Event) =>
              props.onPatchDsp({
                muted: (ev.target as HTMLInputElement).checked,
              })}
          />
          ${props.muteLabel ?? 'Mute'}
        </label>
      </div>
    </div>

    <div class="foh-form-section">
      <div class="foh-form-section-title">High-Pass & Low-Pass Crossovers</div>
      <div class="foh-xy-grid" style="margin-bottom:6px">
        <label class="foh-mini-field">
          <span>HPF Slope</span>
          <select
            aria-label="HPF Topology"
            data-testid=${testIds?.hpfTopology ?? 'foh-hpf-topology'}
            .value=${dsp.highPass.topology}
            @change=${(ev: Event) =>
              props.onPatchDsp({
                highPass: {
                  ...dsp.highPass,
                  topology: (ev.target as HTMLSelectElement).value as CrossoverTopology,
                },
              })}
          >
            ${CROSSOVER_TOPOLOGY_OPTIONS.map(
              (o) => html`
                <option value=${o.value} ?selected=${o.value === dsp.highPass.topology}>
                  ${o.label}
                </option>
              `
            )}
          </select>
        </label>
        <label class="foh-mini-field">
          <span>HPF Freq (Hz)</span>
          <input
            type="number"
            min="15"
            max="20000"
            step="5"
            aria-label="HPF Frequency (Hz)"
            data-testid=${testIds?.hpfFrequency ?? 'foh-hpf-freq'}
            .value=${String(dsp.highPass.frequencyHz)}
            @input=${(ev: Event) =>
              props.onPatchDsp(
                {
                  highPass: {
                    ...dsp.highPass,
                    frequencyHz: Math.max(15, numVal(ev, dsp.highPass.frequencyHz)),
                  },
                },
                `dsp-hpf-${entityId}`
              )}
          />
        </label>
      </div>

      <div class="foh-xy-grid">
        <label class="foh-mini-field">
          <span>LPF Slope</span>
          <select
            aria-label="LPF Topology"
            data-testid=${testIds?.lpfTopology ?? 'foh-lpf-topology'}
            .value=${dsp.lowPass.topology}
            @change=${(ev: Event) =>
              props.onPatchDsp({
                lowPass: {
                  ...dsp.lowPass,
                  topology: (ev.target as HTMLSelectElement).value as CrossoverTopology,
                },
              })}
          >
            ${CROSSOVER_TOPOLOGY_OPTIONS.map(
              (o) => html`
                <option value=${o.value} ?selected=${o.value === dsp.lowPass.topology}>
                  ${o.label}
                </option>
              `
            )}
          </select>
        </label>
        <label class="foh-mini-field">
          <span>LPF Freq (Hz)</span>
          <input
            type="number"
            min="20"
            max="20000"
            step="5"
            aria-label="LPF Frequency (Hz)"
            data-testid=${testIds?.lpfFrequency ?? 'foh-lpf-freq'}
            .value=${String(dsp.lowPass.frequencyHz)}
            @input=${(ev: Event) =>
              props.onPatchDsp(
                {
                  lowPass: {
                    ...dsp.lowPass,
                    frequencyHz: Math.max(20, numVal(ev, dsp.lowPass.frequencyHz)),
                  },
                },
                `dsp-lpf-${entityId}`
              )}
          />
        </label>
      </div>
    </div>

    <div class="foh-form-section">
      <div class="foh-form-section-title">
        <span>Parametric EQ (${dsp.eqBands.length}${props.onAddEqBand ? `/${maxBands}` : ''})</span>
        ${props.onAddEqBand
          ? html`
              <button
                class="foh-btn foh-btn-xs"
                data-testid=${testIds?.addEqBand ?? 'btn-add-eq-band'}
                ?disabled=${dsp.eqBands.length >= maxBands}
                @click=${props.onAddEqBand}
              >
                + Add Band
              </button>
            `
          : nothing}
      </div>

      ${props.tipText ? html`<div class="foh-eq-tip">${props.tipText}</div>` : nothing}

      ${dsp.eqBands.map(
        (band, idx) => html`
          <div
            class="foh-eq-card"
            data-testid="${testIds?.eqBandCardPrefix ?? 'eq-band-'}${idx}"
          >
            <div class="foh-eq-card-top">
              <label class="foh-check-label">
                <input
                  type="checkbox"
                  aria-label="Enable EQ Band ${idx + 1}"
                  .checked=${band.enabled}
                  @change=${(ev: Event) =>
                    props.onPatchEqBand(idx, band.id, {
                      enabled: (ev.target as HTMLInputElement).checked,
                    })}
                />
                #${idx + 1}
              </label>
              <select
                aria-label="EQ Band ${idx + 1} Type"
                .value=${band.type}
                @change=${(ev: Event) =>
                  props.onPatchEqBand(idx, band.id, {
                    type: (ev.target as HTMLSelectElement).value as BiquadFilterType,
                  })}
              >
                ${EQ_FILTER_TYPE_OPTIONS.map(
                  (t) => html`
                    <option value=${t.value} ?selected=${t.value === band.type}>
                      ${t.label}
                    </option>
                  `
                )}
              </select>
              ${props.onRemoveEqBand
                ? html`
                    <button
                      class="foh-btn foh-btn-xs foh-btn-danger"
                      aria-label="Remove EQ Band ${idx + 1}"
                      @click=${() => props.onRemoveEqBand?.(idx, band.id)}
                    >
                      ×
                    </button>
                  `
                : nothing}
            </div>
            <div class="foh-xyz-grid">
              <label class="foh-mini-field">
                <span>Freq (Hz)</span>
                <input
                  type="number"
                  min="20"
                  max="20000"
                  step="10"
                  aria-label="EQ Band ${idx + 1} Frequency (Hz)"
                  .value=${String(band.frequencyHz)}
                  @input=${(ev: Event) =>
                    props.onPatchEqBand(
                      idx,
                      band.id,
                      { frequencyHz: Math.max(20, numVal(ev, band.frequencyHz)) },
                      `eq-f-${entityId}-${band.id}`
                    )}
                />
              </label>
              <label class="foh-mini-field">
                <span>Gain (dB)</span>
                <input
                  type="number"
                  min="-24"
                  max="18"
                  step="0.5"
                  aria-label="EQ Band ${idx + 1} Gain (dB)"
                  .value=${String(band.gainDb)}
                  @input=${(ev: Event) =>
                    props.onPatchEqBand(
                      idx,
                      band.id,
                      { gainDb: numVal(ev, band.gainDb) },
                      `eq-g-${entityId}-${band.id}`
                    )}
                />
              </label>
              <label class="foh-mini-field">
                <span>Q</span>
                <input
                  type="number"
                  min="0.1"
                  max="30"
                  step="0.1"
                  aria-label="EQ Band ${idx + 1} Q Factor"
                  .value=${String(band.q)}
                  @input=${(ev: Event) =>
                    props.onPatchEqBand(
                      idx,
                      band.id,
                      { q: Math.max(0.1, numVal(ev, band.q)) },
                      `eq-q-${entityId}-${band.id}`
                    )}
                />
              </label>
            </div>
          </div>
        `
      )}
    </div>
  `;
}

@customElement('foh-dsp-chain-editor')
export class FohDspChainEditor extends LitElement {
  static styles = [fohTokensCss, fohControlsCss, fohPanelsCss];

  @property({ attribute: false })
  public config!: DspChainEditorProps;

  protected render() {
    if (!this.config) return nothing;
    return renderDspChainEditor(this.config);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-dsp-chain-editor': FohDspChainEditor;
  }
}
