// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type PopoverParentRootLike,
  closePopoverById,
  renderChevronDownSvg,
  renderHelpQuestionSvg,
  renderMeterWaveIconSvg,
  renderRedoIconSvg,
  renderSlidersIconSvg,
  renderUndoIconSvg,
  renderWsmAppMarkSvg,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
import { html, nothing, TemplateResult } from 'lit';
import type { LayoutPreset } from '../app-shell.js';
import { WorkspaceMode } from '../url-state.js';
import { GeneratorGroupProps, renderGeneratorGroup } from './generator-group.js';
import {
  InputRoutingGroupProps,
  renderInputRoutingGroup,
} from './input-routing-group.js';
import { renderSplMeterGroup, SplMeterGroupProps } from './spl-meter-group.js';

export interface TopbarViewProps
  extends InputRoutingGroupProps,
    GeneratorGroupProps,
    SplMeterGroupProps {
  readonly workspaceMode?: WorkspaceMode;
  readonly layoutPreset: LayoutPreset;
  readonly isMobileShow?: boolean;
  readonly wcoVisible?: boolean;
  readonly updateReady?: boolean;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  readonly onLayoutPresetChange: (preset: LayoutPreset) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onOpenHelp?: () => void;
}

function layoutPanelCount(preset: LayoutPreset): 1 | 2 | 3 {
  if (preset === 'single') return 1;
  if (preset === 'pa-triple' || preset === 'show-triple') return 3;
  return 2;
}

export function renderTopbar(props: TopbarViewProps): TemplateResult {
  const mode = props.workspaceMode ?? 'tuning';
  const activeCount = layoutPanelCount(props.layoutPreset);
  const selectCountPreset = (count: 1 | 2 | 3) => {
    const isShow = mode === 'show';
    const next: LayoutPreset =
      count === 1
        ? 'single'
        : count === 2
          ? isShow
            ? 'show-dual'
            : 'tf-dual'
          : isShow
            ? 'show-triple'
            : 'pa-triple';
    props.onLayoutPresetChange(next);
  };

  return html`
    <header
      class="foh-topbar"
      role="toolbar"
      aria-label="WebSoundMeter Workspace Toolbar"
      data-testid="app-topbar"
      data-doc-region="topbar"
      data-wco-visible=${String(Boolean(props.wcoVisible))}
    >
      <div class="foh-topbar-track">
        <!-- Zone 1: Brand + Mode Switcher + History -->
        <div class="foh-topbar-zone">
          <div class="foh-brand">
            <span class="foh-brand-mark">${renderWsmAppMarkSvg()}</span>
            <span class="foh-brand-name">WebSoundMeter</span>
          </div>

          <div class="foh-segmented" role="group" aria-label="Workspace Mode">
            <button
              type="button"
              class="foh-seg-btn"
              aria-pressed=${String(mode === 'tuning')}
              data-testid="btn-mode-tuning"
              title="System Tuning & Alignment Mode"
              @click=${() => props.onWorkspaceModeChange?.('tuning')}
            >
              ${renderSlidersIconSvg()}
              <span>Tuning</span>
            </button>
            <button
              type="button"
              class="foh-seg-btn"
              data-variant="show"
              aria-pressed=${String(mode === 'show')}
              data-testid="btn-mode-show"
              title="Live Show Monitoring Mode (locks out Hardware Generator & expands SPL / Feedback Watch)"
              @click=${() => props.onWorkspaceModeChange?.('show')}
            >
              ${renderMeterWaveIconSvg()}
              <span>Show</span>
            </button>
          </div>

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
              aria-disabled=${String(!props.canUndo)}
              title="Undo (Cmd/Ctrl+Z)"
              @click=${() => {
                if (props.canUndo) props.onUndo?.();
              }}
            >
              ${renderUndoIconSvg()}
            </button>
            <button
              type="button"
              class="foh-seg-btn"
              data-testid="btn-redo"
              aria-label="Redo"
              aria-disabled=${String(!props.canRedo)}
              title="Redo (Cmd/Ctrl+Shift+Z)"
              @click=${() => {
                if (props.canRedo) props.onRedo?.();
              }}
            >
              ${renderRedoIconSvg()}
            </button>
          </div>
        </div>

        <div class="foh-topbar-spacer" aria-hidden="true"></div>

        <!-- Zone 2: Transport, Audio Input & Reference, Signal Generator & Recessed SPL LCD -->
        <div class="foh-topbar-zone">
          ${renderInputRoutingGroup(props)}
          ${mode === 'show' && props.audioInputMode === 'hardware'
            ? nothing
            : renderGeneratorGroup(props)}
          ${props.isMobileShow ? nothing : renderSplMeterGroup(props)}
        </div>

        <div class="foh-topbar-spacer" aria-hidden="true"></div>

        <!-- Zone 3: Chart Stack Layout & Help -->
        <div class="foh-topbar-zone">
          ${props.isMobileShow
            ? nothing
            : html`
                <div class="foh-segmented" role="group" aria-label="Chart Layout">
                  <button
                    type="button"
                    class="foh-seg-btn"
                    data-testid="btn-layout-1x"
                    aria-pressed=${String(activeCount === 1)}
                    title="Single Chart Layout (1)"
                    @click=${() => selectCountPreset(1)}
                  >
                    1x
                  </button>
                  <button
                    type="button"
                    class="foh-seg-btn"
                    data-testid="btn-layout-2x"
                    aria-pressed=${String(activeCount === 2)}
                    title="Dual Chart Layout (2)"
                    @click=${() => selectCountPreset(2)}
                  >
                    2x
                  </button>
                  <button
                    type="button"
                    class="foh-seg-btn"
                    data-testid="btn-layout-3x"
                    aria-pressed=${String(activeCount === 3)}
                    title="Triple Chart Layout (3)"
                    @click=${() => selectCountPreset(3)}
                  >
                    3x
                  </button>
                  <button
                    type="button"
                    class="foh-seg-btn"
                    data-testid="btn-layout-popover"
                    data-popover-trigger="wsm-layout-popover"
                    popovertarget="wsm-layout-popover"
                    aria-label="More Chart Layout Presets"
                    aria-expanded="false"
                    title="Choose Named Chart Layout Preset"
                  >
                    ${renderChevronDownSvg()}
                  </button>
                </div>

                <div
                  id="wsm-layout-popover"
                  popover="auto"
                  class="foh-popover"
                  data-doc-region="layout-popover"
                  @toggle=${(ev: Event) => {
                    if (props.popoverRoot) syncAnchoredPopoverToggle(ev, props.popoverRoot);
                  }}
                >
                  <div class="foh-popover-title">Chart Layout Preset</div>
                  <div class="foh-popover-grid">
                    <div class="foh-popover-row">
                      <label for="wsm-select-layout">Active Preset</label>
                      <select
                        id="wsm-select-layout"
                        name="chart-layout"
                        aria-label="Chart Layout"
                        data-testid="select-layout"
                        .value=${props.layoutPreset}
                        @change=${(e: Event) => {
                          props.onLayoutPresetChange(
                            (e.target as HTMLSelectElement).value as LayoutPreset
                          );
                          closePopoverById(props.popoverRoot, 'wsm-layout-popover');
                        }}
                      >
                        <optgroup label="Live Show Monitoring">
                          <option value="show-dual" ?selected=${props.layoutPreset === 'show-dual'}>
                            Live Show 2x (RTA + SPL History)
                          </option>
                          <option
                            value="show-triple"
                            ?selected=${props.layoutPreset === 'show-triple'}
                          >
                            Live Show 3x (RTA + Mag + SPL History)
                          </option>
                          <option value="rta-mix" ?selected=${props.layoutPreset === 'rta-mix'}>
                            Live Mixing 2x (RTA + Magnitude)
                          </option>
                        </optgroup>
                        <optgroup label="System Tuning & Alignment">
                          <option value="pa-triple" ?selected=${props.layoutPreset === 'pa-triple'}>
                            PA Alignment 3x (Mag + Phase + Impulse)
                          </option>
                          <option value="tf-dual" ?selected=${props.layoutPreset === 'tf-dual'}>
                            Transfer Function 2x (Mag + Phase)
                          </option>
                          <option value="single" ?selected=${props.layoutPreset === 'single'}>
                            Single Chart 1x
                          </option>
                        </optgroup>
                      </select>
                    </div>
                  </div>
                </div>
              `}

          <button
            type="button"
            class="foh-tb-pill foh-tb-icon-btn"
            data-testid="btn-help"
            data-update-ready=${String(Boolean(props.updateReady))}
            aria-label=${props.updateReady
              ? 'Help, Keyboard Shortcuts and App Update Ready'
              : 'Help, Keyboard Shortcuts and User Guide'}
            title=${props.updateReady
              ? 'Update Ready — Open Help, Shortcuts & Apply Update (?)'
              : 'Help, Keyboard Shortcuts, User Guide & Report Issue (?)'}
            @click=${() => props.onOpenHelp?.()}
          >
            ${renderHelpQuestionSvg()}
            ${props.updateReady
              ? html`<span class="foh-update-dot" aria-hidden="true"></span>`
              : nothing}
          </button>
        </div>
      </div>
    </header>
  `;
}
