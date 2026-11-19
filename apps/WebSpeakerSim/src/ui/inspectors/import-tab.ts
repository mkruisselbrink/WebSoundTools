// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Loudspeaker file importer tab (`.gll`, `.clf`, `.frd`, `.csv`, `.json`) for `<wss-speaker-library-modal>`.
 */

import { html, type TemplateResult } from 'lit';

export function renderImportTab(params: {
  readonly dragActive: boolean;
  readonly frdHDeg: number;
  readonly frdVDeg: number;
  readonly onSetDragActive: (active: boolean) => void;
  readonly onBrowseClick: () => void;
  readonly onFilesSelected: (files: FileList | null) => void;
  readonly onPatchFallbackDispersion: (patch: { frdHDeg?: number; frdVDeg?: number }) => void;
}): TemplateResult {
  const {
    dragActive,
    frdHDeg,
    frdVDeg,
    onSetDragActive,
    onBrowseClick,
    onFilesSelected,
    onPatchFallbackDispersion,
  } = params;

  return html`
    <div
      class="dropzone"
      data-drag=${String(dragActive)}
      @dragover=${(ev: DragEvent) => {
        ev.preventDefault();
        onSetDragActive(true);
      }}
      @dragleave=${() => onSetDragActive(false)}
      @drop=${(ev: DragEvent) => {
        ev.preventDefault();
        onSetDragActive(false);
        onFilesSelected(ev.dataTransfer?.files ?? null);
      }}
      @click=${onBrowseClick}
    >
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">
        Drop loudspeaker files here or click to browse
      </div>
      <div style="color:#94a3b8;font-size:11px">
        Supports binary <code>.gll</code> (e.g. manufacturer GLL files), polar text
        <code>.clf</code>, measured curves <code>.frd</code> / <code>.csv</code>, and
        <code>.json</code> speaker definitions.
      </div>
      <input
        id="speaker-file-input"
        name="speaker-file-input"
        aria-label="Import Loudspeaker Files"
        data-testid="speaker-file-input"
        type="file"
        multiple
        accept=".gll,.clf,.tab,.frd,.csv,.txt,.json"
        style="display:none"
        @click=${(ev: Event) => ev.stopPropagation()}
        @change=${(ev: Event) => {
          const input = ev.target as HTMLInputElement;
          onFilesSelected(input.files);
          input.value = '';
        }}
      />
    </div>

    <div class="form-grid">
      <div class="field">
        <label for="import-frd-h-deg">.frd/.csv Nominal Horizontal (°)</label>
        <input
          type="number"
          id="import-frd-h-deg"
          name="import-frd-h-deg"
          .value=${String(frdHDeg)}
          @input=${(ev: Event) =>
            onPatchFallbackDispersion({ frdHDeg: Number((ev.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="field">
        <label for="import-frd-v-deg">.frd/.csv Nominal Vertical (°)</label>
        <input
          type="number"
          id="import-frd-v-deg"
          name="import-frd-v-deg"
          .value=${String(frdVDeg)}
          @input=${(ev: Event) =>
            onPatchFallbackDispersion({ frdVDeg: Number((ev.target as HTMLInputElement).value) })}
        />
      </div>
    </div>
  `;
}
