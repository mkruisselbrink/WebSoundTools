// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Single-row 3-Zone Topbar template view (`src/ui/topbar/topbar-view.ts`),
 * composing `scene-popover.ts`, `heatmap-popover.ts`, and `analysis-band-options.ts`.
 */

import {
  type PopoverParentRootLike,
  type WcoSafeInsets,
  renderChevronDownSvg,
  renderGroundBounceIconSvg,
  renderHelpQuestionSvg,
  renderRedoIconSvg,
  renderSpeakerCabinetIconSvg,
  renderUndoIconSvg,
  renderWssAppMarkSvg,
} from '@foh/ui';
import { html, nothing, type TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { ViewportLayoutMode } from '../../model/url-state.js';
import type { SimulationSnapshot } from '../../physics/sim-controller.js';
import { DEFAULT_GROUND_REFLECTOR } from '../../physics/transform3d.js';
import {
  ANALYSIS_BAND_OPTIONS,
  SINGLE_BAND_FREQUENCIES_HZ,
  matchBandOptionKey,
  type BandOptionEntry,
  type BandOptionKey,
  type SingleBandHz,
} from './analysis-band-options.js';
import {
  PALETTE_SWATCH_CSS,
  SHORT_RANGE_LABELS,
  renderHeatmapPopover,
} from './heatmap-popover.js';
import { renderScenePopover } from './scene-popover.js';

export {
  ANALYSIS_BAND_OPTIONS,
  SINGLE_BAND_FREQUENCIES_HZ,
  matchBandOptionKey,
  type BandOptionEntry,
  type BandOptionKey,
  type SingleBandHz,
};

export interface TopbarRenderCallbacks {
  readonly wcoVisible?: boolean;
  readonly wcoInsets?: WcoSafeInsets;
  readonly updateReady?: boolean;
  readonly isSceneModified?: boolean;
  readonly activeFileName?: string;
  readonly hasUnsavedFileChanges?: boolean;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onOpenProjectsModal: () => void;
  readonly onSaveSnapshot?: () => void;
  readonly onSaveProjectFile?: () => void;
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

  const wcoStyle =
    cb.wcoVisible && cb.wcoInsets
      ? `--foh-wco-left:${cb.wcoInsets.left}px;--foh-wco-right:${cb.wcoInsets.right}px;--foh-wco-top:${cb.wcoInsets.top}px;--foh-wco-height:${cb.wcoInsets.height}px`
      : '';

  return html`
    <header
      class="foh-topbar"
      role="toolbar"
      aria-label="WebSpeakerSim Workspace Toolbar"
      data-testid="app-topbar"
      data-doc-region="topbar"
      data-wco-visible=${String(Boolean(cb.wcoVisible))}
      style=${wcoStyle || nothing}
    >
      <div class="foh-topbar-track">
        <!-- Zone 1: Brand + Scene/Project Menu + Undo/Redo -->
        <div class="foh-topbar-zone foh-topbar-zone-shrink">
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

          ${renderScenePopover({
            activePresetId,
            activeFileName: cb.activeFileName,
            hasUnsavedFileChanges: cb.hasUnsavedFileChanges,
            popoverRoot: cb.popoverRoot,
            onSelectPreset: cb.onSelectPreset,
            onOpenProjectsModal: cb.onOpenProjectsModal,
            onSaveSnapshot: cb.onSaveSnapshot,
            onSaveProjectFile: cb.onSaveProjectFile,
            onTriggerImportProjectJson: cb.onTriggerImportProjectJson,
            onExportProjectJson: cb.onExportProjectJson,
          })}

          <div
            class="foh-segmented foh-hide-below-wide"
            role="group"
            aria-label="Edit History"
          >
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
        <div class="foh-topbar-zone foh-topbar-zone-shrink">
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

          ${renderHeatmapPopover({
            store,
            computeTimeMs: snapshot?.computeTimeMs ?? 0,
            popoverRoot: cb.popoverRoot,
          })}

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
            <span class="foh-lcd-sep foh-hide-below-narrow" aria-hidden="true"></span>
            <span class="foh-lcd-kv foh-hide-below-narrow">
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
            data-update-ready=${String(Boolean(cb.updateReady))}
            aria-label=${cb.updateReady
              ? 'Help, Keyboard Shortcuts and App Update Ready'
              : 'Help, Keyboard Shortcuts and User Guide'}
            title=${cb.updateReady
              ? 'Update Ready — Open Help, Shortcuts & Apply Update (?)'
              : 'Help, Keyboard Shortcuts, User Guide & Report Issue (?)'}
            @click=${cb.onOpenHelp}
          >
            ${renderHelpQuestionSvg()}
            ${cb.updateReady
              ? html`<span class="foh-update-dot" aria-hidden="true"></span>`
              : nothing}
          </button>
        </div>
      </div>
    </header>
  `;
}
