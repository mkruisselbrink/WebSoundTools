// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Topbar template view (`src/ui/topbar/topbar-view.ts`).
 */

import { html, type TemplateResult } from 'lit';
import { DEMO_VENUE_PRESETS } from '../../library/demo-presets.js';
import type {
  ColormapPaletteId,
  ColormapRangeMode,
  IsolineStepDb,
  ProjectStore,
} from '../../model/project-store.js';
import type { AnalysisBandSelection } from '../../model/project-types.js';
import type { ViewportLayoutMode } from '../../model/url-state.js';
import type { SimulationSnapshot } from '../../physics/sim-controller.js';
import { DEFAULT_GROUND_REFLECTOR } from '../../physics/transform3d.js';

export interface BandOptionEntry {
  readonly key: string;
  readonly label: string;
  readonly selection: AnalysisBandSelection;
}

export const ANALYSIS_BAND_OPTIONS: readonly BandOptionEntry[] = [
  {
    key: 'pink-A',
    label: 'Broadband Pink (dBA)',
    selection: {
      kind: 'band-average',
      label: 'Broadband Pink (A-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'A',
      spectrumShape: 'pink',
    },
  },
  {
    key: 'pink-C',
    label: 'Broadband Pink (dBC)',
    selection: {
      kind: 'band-average',
      label: 'Broadband Pink (C-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'C',
      spectrumShape: 'pink',
    },
  },
  {
    key: 'pink-Z',
    label: 'Broadband Pink (dBZ)',
    selection: {
      kind: 'band-average',
      label: 'Broadband Pink (Z-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'Z',
      spectrumShape: 'pink',
    },
  },
  {
    key: 'music-A',
    label: 'Live Music Contour (dBA)',
    selection: {
      kind: 'band-average',
      label: 'Live Music Contour (A-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'A',
      spectrumShape: 'music',
    },
  },
  {
    key: 'music-C',
    label: 'Live Music Contour (dBC)',
    selection: {
      kind: 'band-average',
      label: 'Live Music Contour (C-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'C',
      spectrumShape: 'music',
    },
  },
  {
    key: 'sub-band',
    label: 'Subband Average (31.5–100 Hz dBC)',
    selection: {
      kind: 'band-average',
      label: 'Subband (31.5–100 Hz dBC)',
      minHz: 31.5,
      maxHz: 100,
      weighting: 'C',
      spectrumShape: 'pink',
    },
  },
  ...[31.5, 63, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(
    (hz): BandOptionEntry => ({
      key: `hz-${hz}`,
      label: `${hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`} (Single Band)`,
      selection: { kind: 'single', frequencyHz: hz },
    })
  ),
];

export function matchBandOptionKey(sel: AnalysisBandSelection): string {
  if (sel.kind === 'single') {
    const exact = ANALYSIS_BAND_OPTIONS.find(
      (o) => o.selection.kind === 'single' && o.selection.frequencyHz === sel.frequencyHz
    );
    return exact ? exact.key : 'hz-1000';
  }
  if (sel.maxHz <= 125) {
    return 'sub-band';
  }
  return `${sel.spectrumShape}-${sel.weighting}`;
}

export interface TopbarRenderCallbacks {
  readonly onSelectPreset: (presetId: string) => void;
  readonly onOpenProjectsModal: () => void;
  readonly onExportProjectJson: () => void;
  readonly onTriggerImportProjectJson: () => void;
  readonly onOpenSpeakerLibrary: () => void;
  readonly onSetLayoutMode: (mode: ViewportLayoutMode) => void;
  readonly onToggleChartDrawer: () => void;
}

export function renderTopbar(
  store: ProjectStore,
  snapshot: SimulationSnapshot | null,
  activePresetId: string,
  layoutMode: ViewportLayoutMode,
  chartDrawerExpanded: boolean,
  cb: TopbarRenderCallbacks
): TemplateResult {
  const scene = store.scene;
  const cmap = store.colormap;
  const stats = snapshot?.planGrid?.stats;
  const groundRef = scene.reflectors.find((r) => r.id === DEFAULT_GROUND_REFLECTOR.id);
  const groundEnabled = groundRef?.enabled ?? false;
  const activeBandKey = matchBandOptionKey(scene.bandSelection);

  return html`
    <header class="topbar" data-testid="app-topbar">
      <div class="topbar-group">
        <div class="brand">
          <span class="brand-dot"></span>
          <span>WebSpeakerSim</span>
        </div>

        <label class="tb-label" for="preset-select">Venue:</label>
        <select
          id="preset-select"
          data-testid="preset-select"
          .value=${activePresetId}
          @change=${(ev: Event) => cb.onSelectPreset((ev.target as HTMLSelectElement).value)}
        >
          ${DEMO_VENUE_PRESETS.map(
            (p) => html`<option value=${p.id} ?selected=${p.id === activePresetId}>${p.name}</option>`
          )}
        </select>

        <button class="btn" data-testid="btn-projects" @click=${cb.onOpenProjectsModal}>
          Projects
        </button>
        <button class="btn" data-testid="btn-export-project" @click=${cb.onExportProjectJson}>
          Export
        </button>
        <button class="btn" data-testid="btn-import-project" @click=${cb.onTriggerImportProjectJson}>
          Import
        </button>

        <span class="tb-divider"></span>

        <button
          class="btn"
          data-testid="btn-undo"
          ?disabled=${!store.canUndo}
          title="Undo (Cmd/Ctrl+Z)"
          @click=${() => store.undo()}
        >
          Undo
        </button>
        <button
          class="btn"
          data-testid="btn-redo"
          ?disabled=${!store.canRedo}
          title="Redo (Cmd/Ctrl+Shift+Z)"
          @click=${() => store.redo()}
        >
          Redo
        </button>
      </div>

      <div class="topbar-group">
        <label class="tb-label" for="band-select">Band:</label>
        <select
          id="band-select"
          data-testid="band-select"
          .value=${activeBandKey}
          @change=${(ev: Event) => {
            const key = (ev.target as HTMLSelectElement).value;
            const found = ANALYSIS_BAND_OPTIONS.find((o) => o.key === key);
            if (found) store.setBandSelection(found.selection);
          }}
        >
          ${ANALYSIS_BAND_OPTIONS.map(
            (opt) =>
              html`<option value=${opt.key} ?selected=${opt.key === activeBandKey}>
                ${opt.label}
              </option>`
          )}
        </select>

        <label class="tb-label" for="colormap-range-select">Scale:</label>
        <select
          id="colormap-range-select"
          data-testid="colormap-range-select"
          title="SPL color window — choose Auto ±3 dB or ±6 dB to highlight small coverage differences"
          .value=${cmap.rangeMode}
          @change=${(ev: Event) => {
            const rangeMode = (ev.target as HTMLSelectElement).value as ColormapRangeMode;
            store.setColormap({ rangeMode });
          }}
        >
          <option value="auto-6" ?selected=${cmap.rangeMode === 'auto-6'}>Auto ±3 dB</option>
          <option value="auto-12" ?selected=${cmap.rangeMode === 'auto-12'}>Auto ±6 dB</option>
          <option value="auto-21" ?selected=${cmap.rangeMode === 'auto-21'}>Auto 21 dB</option>
          <option value="auto-36" ?selected=${cmap.rangeMode === 'auto-36'}>Auto 36 dB</option>
          <option value="manual" ?selected=${cmap.rangeMode === 'manual'}>Manual</option>
        </select>

        ${cmap.rangeMode === 'manual'
          ? html`
              <input
                type="number"
                step="3"
                style="width:52px"
                data-testid="topbar-min-spl"
                title="Manual Min SPL (dB)"
                .value=${String(cmap.minSplDb)}
                @input=${(ev: Event) => {
                  const v = Number((ev.target as HTMLInputElement).value);
                  if (Number.isFinite(v)) store.setColormap({ minSplDb: v, rangeMode: 'manual' });
                }}
              />
              <input
                type="number"
                step="3"
                style="width:52px"
                data-testid="topbar-max-spl"
                title="Manual Max SPL (dB)"
                .value=${String(cmap.maxSplDb)}
                @input=${(ev: Event) => {
                  const v = Number((ev.target as HTMLInputElement).value);
                  if (Number.isFinite(v)) store.setColormap({ maxSplDb: v, rangeMode: 'manual' });
                }}
              />
            `
          : ''}

        <label class="tb-label" for="colormap-palette-select">Palette:</label>
        <select
          id="colormap-palette-select"
          data-testid="colormap-palette-select"
          title="Heatmap color palette"
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

        <label class="tb-label" for="isoline-select">Contours:</label>
        <select
          id="isoline-select"
          data-testid="isoline-select"
          title="Equal-SPL contour line spacing"
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

        <button
          class="btn"
          data-testid="btn-colormap-stepped"
          data-active=${String(cmap.stepped)}
          title="Toggle discrete dB isobar color bands vs. smooth gradient"
          @click=${() => store.setColormap({ stepped: !cmap.stepped })}
        >
          Stepped
        </button>

        <button
          class="btn"
          data-testid="btn-ground-bounce"
          data-active=${String(groundEnabled)}
          title="Toggle 1st-Order Ground Reflection (G)"
          @click=${() => store.setGroundReflection(!groundEnabled)}
        >
          Ground Bounce: ${groundEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          class="btn btn-primary"
          data-testid="btn-speaker-library"
          title="Open Loudspeaker Library, Spec Builder & .gll/.clf/.frd Importer (L)"
          @click=${cb.onOpenSpeakerLibrary}
        >
          Speaker Library / Import
        </button>
      </div>

      <div class="topbar-group">
        ${stats && stats.audienceSampleCount > 0
          ? html`
              <div class="metrics-strip" data-testid="coverage-metrics">
                <div class="metric-item">
                  <span class="metric-k">Mean</span>
                  <span class="metric-v">${stats.meanAudienceSplDb.toFixed(1)} dB</span>
                </div>
                <div class="metric-item">
                  <span class="metric-k">±3dB</span>
                  <span class="metric-v ${stats.homogeneityPlusMinus3DbPercent >= 75 ? 'good' : ''}">
                    ${stats.homogeneityPlusMinus3DbPercent.toFixed(0)}%
                  </span>
                </div>
                ${stats.audienceToStageRejectionDb !== null
                  ? html`
                      <div class="metric-item">
                        <span class="metric-k">Stage Rej</span>
                        <span class="metric-v">${stats.audienceToStageRejectionDb.toFixed(1)} dB</span>
                      </div>
                    `
                  : ''}
                <div class="metric-item">
                  <span class="metric-k">Sim</span>
                  <span class="metric-v">${(snapshot?.computeTimeMs ?? 0).toFixed(0)} ms</span>
                </div>
              </div>
            `
          : ''}

        <button
          class="btn"
          data-testid="layout-split"
          data-active=${String(layoutMode === 'split')}
          @click=${() => cb.onSetLayoutMode('split')}
        >
          Split
        </button>
        <button
          class="btn"
          data-testid="layout-plan"
          data-active=${String(layoutMode === 'plan')}
          @click=${() => cb.onSetLayoutMode('plan')}
        >
          Plan
        </button>
        <button
          class="btn"
          data-testid="layout-section"
          data-active=${String(layoutMode === 'section')}
          @click=${() => cb.onSetLayoutMode('section')}
        >
          Section
        </button>
        <button
          class="btn"
          data-testid="btn-toggle-charts"
          data-active=${String(chartDrawerExpanded)}
          @click=${cb.onToggleChartDrawer}
        >
          Charts
        </button>
      </div>
    </header>
  `;
}

