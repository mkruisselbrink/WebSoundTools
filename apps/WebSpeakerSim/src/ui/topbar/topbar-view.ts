// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Single-row 3-Zone Topbar template view (`src/ui/topbar/topbar-view.ts`).
 */

import {
  FOH_GITHUB_REPO_URL,
  type PopoverParentRootLike,
  closePopoverById,
  renderChevronDownSvg,
  renderGithubMarkSvg,
  renderGroundBounceIconSvg,
  renderHelpQuestionSvg,
  renderRedoIconSvg,
  renderSpeakerCabinetIconSvg,
  renderUndoIconSvg,
  renderWssAppMarkSvg,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
import { html, nothing, type TemplateResult } from 'lit';
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

export const SINGLE_BAND_FREQUENCIES_HZ = [
  31.5, 63, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

export type SingleBandHz = (typeof SINGLE_BAND_FREQUENCIES_HZ)[number];

export type BandOptionKey =
  | 'pink-A'
  | 'pink-C'
  | 'pink-Z'
  | 'music-A'
  | 'music-C'
  | 'sub-band'
  | `hz-${SingleBandHz}`;

export interface BandOptionEntry {
  readonly key: BandOptionKey;
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
  ...SINGLE_BAND_FREQUENCIES_HZ.map(
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

const SHORT_RANGE_LABELS: Record<ColormapRangeMode, string> = {
  'auto-6': '±3dB',
  'auto-12': '±6dB',
  'auto-21': '21dB',
  'auto-36': '36dB',
  manual: 'Man',
};

const PALETTE_SWATCH_CSS: Record<ColormapPaletteId, string> = {
  turbo: 'linear-gradient(90deg, #3b82f6 0%, #10b981 48%, #ef4444 100%)',
  inferno: 'linear-gradient(90deg, #311068 0%, #dc2626 52%, #fde047 100%)',
  viridis: 'linear-gradient(90deg, #440154 0%, #21918c 50%, #fde725 100%)',
};

export interface TopbarRenderCallbacks {
  readonly wcoVisible?: boolean;
  readonly isSceneModified?: boolean;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onOpenProjectsModal: () => void;
  readonly onSaveSnapshot?: () => void;
  readonly onExportProjectJson: () => void;
  readonly onTriggerImportProjectJson: () => void;
  readonly onOpenSpeakerLibrary: () => void;
  readonly onSetLayoutMode: (mode: ViewportLayoutMode) => void;
  readonly onToggleChartDrawer: () => void;
  readonly onOpenHelp: () => void;
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
  const hasStats = Boolean(stats && stats.audienceSampleCount > 0);
  const groundRef = scene.reflectors.find((r) => r.id === DEFAULT_GROUND_REFLECTOR.id);
  const groundEnabled = groundRef?.enabled ?? false;
  const activeBandKey = matchBandOptionKey(scene.bandSelection);

  const rangeShort = SHORT_RANGE_LABELS[cmap.rangeMode];
  const contourShort = cmap.isolineStepDb > 0 ? `${cmap.isolineStepDb}dB` : 'Off';

  return html`
    <header
      class="foh-topbar"
      role="toolbar"
      aria-label="WebSpeakerSim Workspace Toolbar"
      data-testid="app-topbar"
      data-wco-visible=${String(Boolean(cb.wcoVisible))}
    >
      <div class="foh-topbar-track">
        <!-- Zone 1: Brand + Scene/Project Menu + Undo/Redo -->
        <div class="foh-topbar-zone">
          <div class="foh-brand">
            <span class="foh-brand-mark">${renderWssAppMarkSvg()}</span>
            <span class="foh-brand-name">WebSpeakerSim</span>
          </div>

          <button
            type="button"
            class="foh-tb-pill wss-scene-pill"
            data-testid="btn-scene-popover"
            data-popover-trigger="wss-scene-popover"
            popovertarget="wss-scene-popover"
            aria-expanded="false"
            title="Switch Demo Venue Preset, Save/Load Projects, or Import/Export .wss-project.json"
          >
            <span class="foh-pill-k foh-hide-below-medium">Scene</span>
            <span class="foh-pill-val">${scene.name}</span>
            ${cb.isSceneModified
              ? html`<span
                  class="foh-dirty-dot"
                  title="Modified scene (autosaved to local browser session)"
                ></span>`
              : nothing}
            ${renderChevronDownSvg()}
          </button>

          <div
            id="wss-scene-popover"
            popover="auto"
            class="foh-popover"
            @toggle=${(ev: Event) => {
              if (cb.popoverRoot) syncAnchoredPopoverToggle(ev, cb.popoverRoot);
            }}
          >
            <div class="foh-popover-title">Venue Scene &amp; Project File</div>
            <div class="foh-popover-grid">
              <div class="foh-popover-row">
                <label for="preset-select">Load Demo Venue Preset</label>
                <select
                  id="preset-select"
                  name="venue-preset"
                  data-testid="preset-select"
                  .value=${activePresetId}
                  @change=${(ev: Event) => {
                    cb.onSelectPreset((ev.target as HTMLSelectElement).value);
                    closePopoverById(cb.popoverRoot, 'wss-scene-popover');
                  }}
                >
                  ${DEMO_VENUE_PRESETS.map(
                    (p) =>
                      html`<option value=${p.id} ?selected=${p.id === activePresetId}>
                        ${p.name}
                      </option>`
                  )}
                </select>
              </div>

              <div class="foh-popover-actions">
                <button
                  type="button"
                  class="foh-tb-pill"
                  data-testid="btn-projects"
                  @click=${() => {
                    closePopoverById(cb.popoverRoot, 'wss-scene-popover');
                    cb.onOpenProjectsModal();
                  }}
                >
                  Saved Projects
                </button>
                <button
                  type="button"
                  class="foh-tb-pill"
                  data-testid="btn-save-snapshot"
                  @click=${() => {
                    closePopoverById(cb.popoverRoot, 'wss-scene-popover');
                    cb.onSaveSnapshot?.();
                  }}
                >
                  Save Snapshot
                </button>
                <button
                  type="button"
                  class="foh-tb-pill"
                  data-testid="btn-import-project"
                  @click=${() => {
                    closePopoverById(cb.popoverRoot, 'wss-scene-popover');
                    cb.onTriggerImportProjectJson();
                  }}
                >
                  Import .json
                </button>
                <button
                  type="button"
                  class="foh-tb-pill"
                  data-testid="btn-export-project"
                  @click=${() => {
                    closePopoverById(cb.popoverRoot, 'wss-scene-popover');
                    cb.onExportProjectJson();
                  }}
                >
                  Export .json
                </button>
              </div>
            </div>
          </div>

          <div class="foh-segmented" role="group" aria-label="Edit History">
            <button
              type="button"
              class="foh-seg-btn"
              data-testid="btn-undo"
              aria-label="Undo"
              aria-disabled=${String(!store.canUndo)}
              title="Undo (Cmd/Ctrl+Z)"
              @click=${() => {
                if (store.canUndo) store.undo();
              }}
            >
              ${renderUndoIconSvg()}
            </button>
            <button
              type="button"
              class="foh-seg-btn"
              data-testid="btn-redo"
              aria-label="Redo"
              aria-disabled=${String(!store.canRedo)}
              title="Redo (Cmd/Ctrl+Shift+Z)"
              @click=${() => {
                if (store.canRedo) store.redo();
              }}
            >
              ${renderRedoIconSvg()}
            </button>
          </div>
        </div>

        <div class="foh-topbar-spacer" aria-hidden="true"></div>

        <!-- Zone 2: Primary Band + Ground Bounce / Heatmap Split-Pill + Zero-Jitter Coverage LCD -->
        <div class="foh-topbar-zone">
          <select
            id="band-select"
            name="analysis-band"
            aria-label="Analysis Frequency Band"
            data-testid="band-select"
            class="foh-tb-select wss-band-select"
            title="Acoustic Analysis Frequency Band"
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

          <div class="foh-split-pill" role="group" aria-label="Ground Reflection and Heatmap Display">
            <button
              type="button"
              class="wss-bounce-btn"
              data-testid="btn-ground-bounce"
              aria-pressed=${String(groundEnabled)}
              title="Toggle 1st-Order Ground Reflection (G)"
              @click=${() => store.setGroundReflection(!groundEnabled)}
            >
              ${renderGroundBounceIconSvg()}
              <span class="foh-hide-below-medium">Bounce</span>
            </button>
            <button
              type="button"
              class="wss-heatmap-btn"
              data-testid="btn-heatmap-popover"
              data-popover-trigger="wss-heatmap-popover"
              popovertarget="wss-heatmap-popover"
              aria-label="Heatmap Scale, Palette and Contours"
              aria-expanded="false"
              title="Configure SPL Color Window, Palette, Isobar Contours & Stepped Bands"
            >
              <span
                class="wss-palette-swatch"
                style="background:${PALETTE_SWATCH_CSS[cmap.palette]}"
                aria-hidden="true"
              ></span>
              <span class="foh-hide-below-medium">${rangeShort} · ${contourShort}</span>
              ${renderChevronDownSvg()}
            </button>
          </div>

          <div
            id="wss-heatmap-popover"
            popover="auto"
            class="foh-popover"
            @toggle=${(ev: Event) => {
              if (cb.popoverRoot) syncAnchoredPopoverToggle(ev, cb.popoverRoot);
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
                    <div class="xy-grid">
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

              <div class="xy-grid">
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
                <span class="wss-sim-time">
                  Solver: ${(snapshot?.computeTimeMs ?? 0).toFixed(0)} ms
                </span>
              </div>
            </div>
          </div>

          <div
            class="foh-lcd"
            data-testid="coverage-metrics"
            role="group"
            aria-label="Audience Coverage Telemetry"
          >
            <span class="foh-lcd-kv">
              <span class="foh-lcd-k">Mean</span>
              <span
                class="foh-lcd-v"
                style="inline-size:7.4ch;color:var(--_foh-accent-bright, #38bdf8)"
              >
                ${hasStats && stats ? `${stats.meanAudienceSplDb.toFixed(1)} dB` : '—'}
              </span>
            </span>
            <span class="foh-lcd-sep" aria-hidden="true"></span>
            <span class="foh-lcd-kv">
              <span class="foh-lcd-k">±3dB</span>
              <span
                class="foh-lcd-v ${hasStats && stats && stats.homogeneityPlusMinus3DbPercent >= 75
                  ? 'good'
                  : ''}"
                style="inline-size:3.8ch"
              >
                ${hasStats && stats ? `${stats.homogeneityPlusMinus3DbPercent.toFixed(0)}%` : '—'}
              </span>
            </span>
            <span class="foh-lcd-sep foh-hide-below-full" aria-hidden="true"></span>
            <span class="foh-lcd-kv foh-hide-below-full">
              <span class="foh-lcd-k">Stage Rej</span>
              <span class="foh-lcd-v" style="inline-size:6.6ch">
                ${hasStats && stats && stats.audienceToStageRejectionDb !== null
                  ? `${stats.audienceToStageRejectionDb.toFixed(1)} dB`
                  : '—'}
              </span>
            </span>
          </div>
        </div>

        <div class="foh-topbar-spacer" aria-hidden="true"></div>

        <!-- Zone 3: Speaker Library + Viewport Layout + Charts + Help -->
        <div class="foh-topbar-zone">
          <button
            type="button"
            class="foh-tb-pill foh-tb-primary"
            data-testid="btn-speaker-library"
            title="Open Loudspeaker Library, Spec Builder & .gll/.clf/.frd Importer (L)"
            @click=${cb.onOpenSpeakerLibrary}
          >
            ${renderSpeakerCabinetIconSvg()}
            <span class="foh-hide-below-medium">Speakers</span>
          </button>

          <div class="foh-segmented" role="group" aria-label="Viewport layout">
            <button
              type="button"
              class="foh-seg-btn"
              data-testid="layout-split"
              aria-pressed=${String(layoutMode === 'split')}
              @click=${() => cb.onSetLayoutMode('split')}
            >
              Split
            </button>
            <button
              type="button"
              class="foh-seg-btn"
              data-testid="layout-plan"
              aria-pressed=${String(layoutMode === 'plan')}
              @click=${() => cb.onSetLayoutMode('plan')}
            >
              Plan
            </button>
            <button
              type="button"
              class="foh-seg-btn"
              data-testid="layout-section"
              aria-pressed=${String(layoutMode === 'section')}
              @click=${() => cb.onSetLayoutMode('section')}
            >
              Section
            </button>
          </div>

          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-toggle-charts"
            aria-pressed=${String(chartDrawerExpanded)}
            title="Toggle Frequency Response & Histogram Drawer"
            @click=${cb.onToggleChartDrawer}
          >
            Charts
          </button>

          <button
            type="button"
            class="foh-tb-pill foh-tb-icon-btn"
            data-testid="btn-help"
            aria-label="Help, Keyboard Shortcuts and User Guide"
            title="Help, Keyboard Shortcuts, User Guide & Report Issue (?)"
            @click=${cb.onOpenHelp}
          >
            ${renderHelpQuestionSvg()}
          </button>
          <a
            class="foh-tb-pill foh-tb-icon-btn foh-hide-below-medium"
            href=${FOH_GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-github"
            aria-label="View source code on GitHub"
            title="View source code & file issues on GitHub"
          >
            ${renderGithubMarkSvg()}
          </a>
        </div>
      </div>
    </header>
  `;
}
