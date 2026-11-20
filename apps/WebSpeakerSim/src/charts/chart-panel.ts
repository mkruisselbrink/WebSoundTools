// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `<wss-chart-panel>` Lit 3 Web Component rendering Virtual Microphone Magnitude,
 * Phase, Group Delay, Impulse Arrivals, Audience SPL Histogram, and live draggable
 * DSP Group EQ handles via `@foh/charts`.
 */

import {
  FohChartPanelBase,
  fohChartPanelStyles,
  type ChartScene,
  type CursorReadoutModel,
  type EqBandDragDetail,
  type MagnitudeSpanMode,
} from '@foh/charts';
import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ProjectStore } from '../model/project-store.js';
import type { DspGroup } from '../model/project-types.js';
import type { SimulationSnapshot } from '../physics/sim-controller.js';
import {
  buildWssChartScene,
  buildWssCursorReadoutModel,
  type SimPlotType,
} from './wss-chart-adapter.js';

const PLOT_TABS: readonly { readonly id: SimPlotType; readonly shortLabel: string }[] = [
  { id: 'magnitude', shortLabel: 'Magnitude (dB)' },
  { id: 'phase', shortLabel: 'Phase (°)' },
  { id: 'group-delay', shortLabel: 'Group Delay' },
  { id: 'arrivals', shortLabel: 'Arrivals' },
  { id: 'histogram', shortLabel: 'SPL Histogram' },
];

@customElement('wss-chart-panel')
export class WssChartPanel extends FohChartPanelBase {
  static styles = [
    fohChartPanelStyles,
    css`
      .chart-header {
        min-height: 29px;
        height: 30px;
        padding: 4px 10px;
        font-size: 11px;
      }

      .tab-group {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .tab-btn {
        padding: 2px 8px;
        font-size: 10.5px;
      }

      .span-select {
        padding: 1px 22px 1px 6px;
        background-position: right 6px center;
        font-size: 10.5px;
        margin-left: 4px;
      }

      .span-label {
        color: var(--foh-text-muted, #94a3b8);
        font-size: 10px;
        margin-left: 6px;
      }

      .legend-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 10.5px;
        color: var(--foh-text-secondary, #cbd5e1);
        font-family: var(--foh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        min-width: 0;
        overflow-x: auto;
        white-space: nowrap;
        scrollbar-width: none;
      }

      .legend-bar::-webkit-scrollbar {
        display: none;
      }
    `,
  ];

  @property({ attribute: false })
  public store!: ProjectStore;

  @property({ attribute: false })
  public snapshot: SimulationSnapshot | null = null;

  @property({ type: Number })
  public revision = 0;

  @state()
  public plotType: SimPlotType = 'magnitude';

  @state()
  private magSpanMode: MagnitudeSpanMode = 'auto-60';

  private subscribedStore: ProjectStore | null = null;
  private unsubscribeStore: (() => void) | null = null;

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
      this.subscribedStore = null;
    }
  }

  protected updated(changed: Map<string, unknown>): void {
    if (this.store !== this.subscribedStore) {
      if (this.unsubscribeStore) {
        this.unsubscribeStore();
        this.unsubscribeStore = null;
      }
      this.subscribedStore = this.store ?? null;
      if (this.subscribedStore) {
        this.unsubscribeStore = this.subscribedStore.subscribe(() => {
          this.requestUpdate();
          this.requestChartRepaint();
        });
      }
    }
    super.updated(changed);
  }

  private getSelectedDspGroup(): DspGroup | null {
    if (!this.store || this.store.selectedEntity?.kind !== 'dsp-group') {
      return null;
    }
    const groupId = this.store.selectedEntity.id;
    return this.store.scene.dspGroups.find((g) => g.id === groupId) ?? null;
  }

  protected onEqBandDrag(detail: EqBandDragDetail): void {
    const grp = this.getSelectedDspGroup();
    if (!grp) return;
    const nextBands = grp.dsp.eqBands.map((b, idx) =>
      idx === detail.bandIndex
        ? {
            ...b,
            frequencyHz: detail.frequency,
            gainDb: detail.gainDb,
            ...(detail.q !== undefined ? { q: detail.q } : {}),
          }
        : b
    );
    this.store.updateDspGroup(
      grp.id,
      { dsp: { eqBands: nextBands } },
      `chart-eq:${grp.id}:${detail.bandIndex}`
    );
  }

  protected onEqBandDragEnd(): void {
    this.store?.endTransaction();
    super.onEqBandDragEnd();
  }

  protected buildChartScene(): ChartScene {
    return buildWssChartScene({
      plotType: this.plotType,
      magSpanMode: this.magSpanMode,
      mics: this.store?.scene.virtualMics ?? [],
      responses: this.snapshot?.virtualMics ?? [],
      planGrid: this.snapshot?.planGrid ?? null,
      activeDspGroup: this.getSelectedDspGroup(),
    });
  }

  protected buildCursorReadout(
    domainX: number,
    scene: ChartScene
  ): CursorReadoutModel | null {
    return buildWssCursorReadoutModel(
      this.plotType,
      domainX,
      this.store?.scene.virtualMics ?? [],
      this.snapshot?.virtualMics ?? [],
      this.snapshot?.planGrid ?? null,
      scene.axis.bounds
    );
  }

  private handleTablistKeyDown = (ev: KeyboardEvent): void => {
    if (typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype) {
      return;
    }
    const count = PLOT_TABS.length;
    const currentIdx = PLOT_TABS.findIndex((t) => t.id === this.plotType);
    let nextIdx = -1;
    if (ev.key === 'ArrowRight') {
      nextIdx = (currentIdx + 1) % count;
    } else if (ev.key === 'ArrowLeft') {
      nextIdx = (currentIdx - 1 + count) % count;
    } else if (ev.key === 'Home') {
      nextIdx = 0;
    } else if (ev.key === 'End') {
      nextIdx = count - 1;
    }
    if (nextIdx < 0) return;
    ev.preventDefault();
    this.plotType = PLOT_TABS[nextIdx].id;
    this.clearCursor();
    void this.updateComplete.then(() => {
      const buttons = this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons[nextIdx]?.focus();
    });
  };

  protected renderHeader(): TemplateResult {
    const responses = this.snapshot?.virtualMics ?? [];
    const mics = this.store?.scene.virtualMics ?? [];
    const colorMap = new Map(mics.map((m) => [m.id, m.color]));

    return html`
      <div class="chart-header">
        <div class="header-left">
          <div
            class="tab-group"
            role="tablist"
            focusgroup="tablist nomemory"
            aria-label="Acoustic response plot view"
            @keydown=${this.handleTablistKeyDown}
          >
            ${PLOT_TABS.map((tab) => {
              const selected = this.plotType === tab.id;
              return html`
                <button
                  type="button"
                  role="tab"
                  class="tab-btn"
                  aria-selected=${String(selected)}
                  data-active=${String(selected)}
                  ?focusgroupstart=${selected}
                  tabindex=${selected ? '0' : '-1'}
                  @click=${() => {
                    this.plotType = tab.id;
                    this.clearCursor();
                  }}
                >
                  ${tab.shortLabel}
                </button>
              `;
            })}
          </div>
          ${this.plotType === 'magnitude'
            ? html`
                <label class="span-label" for="wss-mag-span-select">Span:</label>
                <select
                  id="wss-mag-span-select"
                  name="chart-mag-span"
                  class="span-select"
                  data-testid="chart-mag-span-select"
                  title="Vertical dB span for Magnitude plot"
                  .value=${this.magSpanMode}
                  @change=${(ev: Event) => {
                    this.magSpanMode = (ev.target as HTMLSelectElement)
                      .value as MagnitudeSpanMode;
                  }}
                >
                  <option value="auto-30" ?selected=${this.magSpanMode === 'auto-30'}>
                    30 dB (Zoom)
                  </option>
                  <option value="auto-60" ?selected=${this.magSpanMode === 'auto-60'}>
                    60 dB (Std)
                  </option>
                  <option value="auto-80" ?selected=${this.magSpanMode === 'auto-80'}>
                    80 dB (Wide)
                  </option>
                </select>
              `
            : nothing}
        </div>
        <div class="legend-bar">
          ${responses.map(
            (r) => html`
              <span class="legend-item">
                <span class="dot" aria-hidden="true" style="background:${colorMap.get(r.micId) ?? '#38bdf8'}"></span>
                ${r.micName} (${r.broadbandSplADb.toFixed(1)} dBA · t₀ ${r.referenceDelayMs.toFixed(1)} ms)
              </span>
            `
          )}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-chart-panel': WssChartPanel;
  }
}
