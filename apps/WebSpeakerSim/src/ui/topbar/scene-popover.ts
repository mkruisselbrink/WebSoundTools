// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Venue preset selector & project file actions popover (`#wss-scene-popover`)
 * rendered inside `<wss-topbar>` so `popovertarget` stays in the same Shadow Root.
 */

import {
  closePopoverById,
  syncAnchoredPopoverToggle,
  type PopoverParentRootLike,
} from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import { DEMO_VENUE_PRESETS } from '../../library/demo-presets.js';

export interface ScenePopoverProps {
  readonly activePresetId: string;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onOpenProjectsModal: () => void;
  readonly onSaveSnapshot?: () => void;
  readonly onTriggerImportProjectJson: () => void;
  readonly onExportProjectJson: () => void;
}

export function renderScenePopover(props: ScenePopoverProps): TemplateResult {
  const {
    activePresetId,
    popoverRoot,
    onSelectPreset,
    onOpenProjectsModal,
    onSaveSnapshot,
    onTriggerImportProjectJson,
    onExportProjectJson,
  } = props;

  return html`
    <div
      id="wss-scene-popover"
      popover="auto"
      class="foh-popover"
      @toggle=${(ev: Event) => {
        if (popoverRoot) syncAnchoredPopoverToggle(ev, popoverRoot);
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
              onSelectPreset((ev.target as HTMLSelectElement).value);
              closePopoverById(popoverRoot, 'wss-scene-popover');
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
              closePopoverById(popoverRoot, 'wss-scene-popover');
              onOpenProjectsModal();
            }}
          >
            Saved Projects
          </button>
          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-save-snapshot"
            @click=${() => {
              closePopoverById(popoverRoot, 'wss-scene-popover');
              onSaveSnapshot?.();
            }}
          >
            Save Snapshot
          </button>
          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-import-project"
            @click=${() => {
              closePopoverById(popoverRoot, 'wss-scene-popover');
              onTriggerImportProjectJson();
            }}
          >
            Import .json
          </button>
          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-export-project"
            @click=${() => {
              closePopoverById(popoverRoot, 'wss-scene-popover');
              onExportProjectJson();
            }}
          >
            Export .json
          </button>
        </div>
      </div>
    </div>
  `;
}
