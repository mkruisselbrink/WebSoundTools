// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Venue preset selector & `.wss-project.json` direct file Save / Open / Snapshot popover
 * (`#wss-scene-popover`) rendered inside `<wss-topbar>` so `popovertarget` stays in the same Shadow Root.
 */

import {
  closePopoverById,
  syncAnchoredPopoverToggle,
  type PopoverParentRootLike,
} from '@foh/ui';
import { html, nothing, type TemplateResult } from 'lit';
import { DEMO_VENUE_PRESETS } from '../../library/demo-presets.js';

export interface ScenePopoverProps {
  readonly activePresetId: string;
  readonly activeFileName?: string;
  readonly hasUnsavedFileChanges?: boolean;
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onOpenProjectsModal: () => void;
  readonly onSaveSnapshot?: () => void;
  readonly onSaveProjectFile?: () => void;
  readonly onTriggerImportProjectJson: () => void;
  readonly onExportProjectJson: () => void;
}

export function renderScenePopover(props: ScenePopoverProps): TemplateResult {
  const {
    activePresetId,
    activeFileName,
    hasUnsavedFileChanges,
    popoverRoot,
    onSelectPreset,
    onOpenProjectsModal,
    onSaveSnapshot,
    onSaveProjectFile,
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

        ${activeFileName
          ? html`
              <div class="wss-sim-time">
                File: <strong>${activeFileName}</strong>${hasUnsavedFileChanges
                  ? ' (unsaved edits)'
                  : ' (saved)'}
              </div>
            `
          : nothing}

        <div class="foh-popover-actions">
          <button
            type="button"
            class="foh-tb-pill ${activeFileName && hasUnsavedFileChanges ? 'foh-tb-primary' : ''}"
            data-testid="btn-save-project-file"
            title="Save directly to .wss-project.json file (Cmd/Ctrl+S)"
            @click=${() => {
              closePopoverById(popoverRoot, 'wss-scene-popover');
              if (onSaveProjectFile) {
                onSaveProjectFile();
              } else {
                onExportProjectJson();
              }
            }}
          >
            Save .json
          </button>
          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-import-project"
            title="Open or import a .wss-project.json bundle"
            @click=${() => {
              closePopoverById(popoverRoot, 'wss-scene-popover');
              onTriggerImportProjectJson();
            }}
          >
            Open .json
          </button>
          <button
            type="button"
            class="foh-tb-pill"
            data-testid="btn-export-project"
            title="Save a copy / export .wss-project.json bundle"
            @click=${() => {
              closePopoverById(popoverRoot, 'wss-scene-popover');
              onExportProjectJson();
            }}
          >
            ${activeFileName ? 'Save As…' : 'Export .json'}
          </button>
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
        </div>
      </div>
    </div>
  `;
}
