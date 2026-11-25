// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * SPL Heatmap range, palette, contour interval, and stepped-isobar popover
 * (`#wss-heatmap-popover`) rendered inside `<wss-topbar>`.
 */

import { syncAnchoredPopoverToggle, type PopoverParentRootLike } from '@foh/ui';
import { html, nothing, type TemplateResult } from 'lit';
import type {
  ColormapPaletteId,
  ColormapRangeMode,
  IsolineStepDb,
  ProjectStore,
} from '../../model/project-store.js';

export const SHORT_RANGE_LABELS: Record<ColormapRangeMode, string> = {
  'auto-6': '±3dB',
  'auto-12': '±6dB',
  'auto-21': '21dB',
  'auto-36': '36dB',
  manual: 'Man',
};

export const PALETTE_SWATCH_CSS: Record<ColormapPaletteId, string> = {
  turbo: 'linear-gradient(90deg, #3b82f6 0%, #10b981 48%, #ef4444 100%)',
  inferno: 'linear-gradient(90deg, #311068 0%, #dc2626 52%, #fde047 100%)',
  viridis: 'linear-gradient(90deg, #440154 0%, #21918c 50%, #fde725 100%)',
};

export interface HeatmapPopoverProps {
  readonly store: ProjectStore;
  readonly computeTimeMs: number;
  readonly popoverRoot?: PopoverParentRootLike;
}

export function renderHeatmapPopover(props: HeatmapPopoverProps): TemplateResult {
  const { store, computeTimeMs, popoverRoot } = props;
  const cmap = store.colormap;

  return html`
    <div
      id="wss-heatmap-popover"
      popover="auto"
      class="foh-popover"
      data-doc-region="heatmap-popover"
      @toggle=${(ev: Event) => {
        if (popoverRoot) syncAnchoredPopoverToggle(ev, popoverRoot);
      }}
    >
      <div class="foh-popover-title">SPL Heatmap &amp; Contours</div>
      <div class="foh-popover-grid">
        <div class="foh-popover-row">
          <label for="colormap-range-select">SPL Color Window</label>
          <select
            id="colormap-range-select"
            name="colormap-range-mode"
            data-testid="colormap-range-select"
            title="SPL color window — choose Auto ±3 dB or ±6 dB to highlight small coverage differences"
            .value=${cmap.rangeMode}
            @change=${(ev: Event) => {
              const rangeMode = (ev.target as HTMLSelectElement).value as ColormapRangeMode;
              store.setColormap({ rangeMode });
            }}
          >
            <option value="auto-6" ?selected=${cmap.rangeMode === 'auto-6'}>
              Auto ±3 dB (Tight Homogeneity)
            </option>
            <option value="auto-12" ?selected=${cmap.rangeMode === 'auto-12'}>
              Auto ±6 dB
            </option>
            <option value="auto-21" ?selected=${cmap.rangeMode === 'auto-21'}>
              Auto 21 dB
            </option>
            <option value="auto-36" ?selected=${cmap.rangeMode === 'auto-36'}>
              Auto 36 dB (Wide Throw / Subs)
            </option>
            <option value="manual" ?selected=${cmap.rangeMode === 'manual'}>
              Manual Min / Max
            </option>
          </select>
        </div>

        ${cmap.rangeMode === 'manual'
          ? html`
              <div class="foh-xy-grid">
                <div class="foh-popover-row">
                  <label for="topbar-min-spl">Min SPL (dB)</label>
                  <input
                    type="number"
                    id="topbar-min-spl"
                    name="topbar-min-spl"
                    aria-label="Manual Min SPL (dB)"
                    step="3"
                    data-testid="topbar-min-spl"
                    .value=${String(cmap.minSplDb)}
                    @input=${(ev: Event) => {
                      const v = Number((ev.target as HTMLInputElement).value);
                      if (Number.isFinite(v)) {
                        store.setColormap({ minSplDb: v, rangeMode: 'manual' });
                      }
                    }}
                  />
                </div>
                <div class="foh-popover-row">
                  <label for="topbar-max-spl">Max SPL (dB)</label>
                  <input
                    type="number"
                    id="topbar-max-spl"
                    name="topbar-max-spl"
                    aria-label="Manual Max SPL (dB)"
                    step="3"
                    data-testid="topbar-max-spl"
                    .value=${String(cmap.maxSplDb)}
                    @input=${(ev: Event) => {
                      const v = Number((ev.target as HTMLInputElement).value);
                      if (Number.isFinite(v)) {
                        store.setColormap({ maxSplDb: v, rangeMode: 'manual' });
                      }
                    }}
                  />
                </div>
              </div>
            `
          : nothing}

        <div class="foh-xy-grid">
          <div class="foh-popover-row">
            <label for="colormap-palette-select">Color Palette</label>
            <select
              id="colormap-palette-select"
              name="colormap-palette"
              data-testid="colormap-palette-select"
              .value=${cmap.palette}
              @change=${(ev: Event) => {
                const palette = (ev.target as HTMLSelectElement).value as ColormapPaletteId;
                store.setColormap({ palette });
              }}
            >
              <option value="turbo" ?selected=${cmap.palette === 'turbo'}>Rainbow</option>
              <option value="inferno" ?selected=${cmap.palette === 'inferno'}>Thermal</option>
              <option value="viridis" ?selected=${cmap.palette === 'viridis'}>Viridis</option>
            </select>
          </div>

          <div class="foh-popover-row">
            <label for="isoline-select">Isobar Contours</label>
            <select
              id="isoline-select"
              name="colormap-contours"
              data-testid="isoline-select"
              .value=${String(cmap.isolineStepDb)}
              @change=${(ev: Event) => {
                const step = Number((ev.target as HTMLSelectElement).value) as IsolineStepDb;
                store.setColormap({ isolineStepDb: step });
              }}
            >
              <option value="1" ?selected=${cmap.isolineStepDb === 1}>1 dB</option>
              <option value="2" ?selected=${cmap.isolineStepDb === 2}>2 dB</option>
              <option value="3" ?selected=${cmap.isolineStepDb === 3}>3 dB</option>
              <option value="6" ?selected=${cmap.isolineStepDb === 6}>6 dB</option>
              <option value="0" ?selected=${cmap.isolineStepDb === 0}>Off</option>
            </select>
          </div>
        </div>

        <div class="wss-popover-footer">
          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-colormap-stepped"
            aria-pressed=${String(cmap.stepped)}
            title="Toggle discrete dB isobar color bands vs. smooth gradient"
            @click=${() => store.setColormap({ stepped: !cmap.stepped })}
          >
            Stepped Isobars: ${cmap.stepped ? 'ON' : 'OFF'}
          </button>
          <span class="wss-sim-time">Solver: ${computeTimeMs.toFixed(0)} ms</span>
        </div>
      </div>
    </div>
  `;
}
