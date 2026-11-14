// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { html, nothing, TemplateResult } from 'lit';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import { SIMULATOR_PRESETS, SimulatorPresetId } from '../dsp/synthetic-rig.js';
import { SourceData } from '../sources/source-data.js';

export interface SidebarViewProps {
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly allSources: readonly SourceData[];
  readonly selectedSourceId: string;
  readonly inspectorContent: TemplateResult;
  readonly onAddLiveSource?: () => void;
  readonly onAddEqSource: () => void;
  readonly onAddUnionSource: () => void;
  readonly onImportFrdFile?: (file: File) => void;
  readonly onSelectSource: (id: string) => void;
  readonly onToggleSourceVisibility: (id: string, visible: boolean) => void;
}

export function renderSidebar(props: SidebarViewProps): TemplateResult {
  return html`
    <aside class="sidebar">
      ${props.audioInputMode === 'simulator'
        ? html`
            <div class="sim-banner" data-testid="simulator-description">
              <strong>Demo Mode Active:</strong>
              ${SIMULATOR_PRESETS[props.simulatorPreset].description}
            </div>
          `
        : nothing}

      <!-- Sources List Card -->
      <div class="section-card">
        <div class="section-header">
          <span>Sources (${props.allSources.length})</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${props.onAddLiveSource
              ? html`
                  <button
                    data-testid="btn-add-meas"
                    title="Add Simultaneous Live Measurement Source (M)"
                    @click=${props.onAddLiveSource}
                  >
                    + Meas
                  </button>
                `
              : nothing}
            <button
              data-testid="btn-add-eq"
              title="Add Virtual Parametric EQ & Crossover Source"
              @click=${props.onAddEqSource}
            >
              + EQ
            </button>
            <button
              data-testid="btn-add-union"
              title="Add Math / Union Source"
              @click=${props.onAddUnionSource}
            >
              + Math
            </button>
            ${props.onImportFrdFile
              ? html`
                  <label
                    style="display:inline-flex;align-items:center;cursor:pointer;"
                    title="Import Predicted or Measured .FRD Curve as Stored Trace"
                  >
                    <input
                      type="file"
                      accept=".frd,.cal,.txt,.csv"
                      data-testid="input-import-frd"
                      style="display:none;"
                      @change=${(e: Event) => {
                        const input = e.target as HTMLInputElement;
                        const file = input.files?.[0];
                        if (file) {
                          props.onImportFrdFile?.(file);
                        }
                        input.value = '';
                      }}
                    />
                    <span
                      class="btn-like"
                      data-testid="btn-import-frd"
                      style="padding:3px 6px;border-radius:4px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;"
                    >
                      + .FRD
                    </span>
                  </label>
                `
              : nothing}
          </div>
        </div>

        <div class="source-list" data-testid="source-list">
          ${props.allSources.map(
            (src) => html`
              <div
                class="source-row ${props.selectedSourceId === src.id ? 'selected' : ''}"
                data-testid="source-item-${src.id}"
                @click=${() => props.onSelectSource(src.id)}
              >
                <div class="source-row-left">
                  <input
                    type="checkbox"
                    aria-label="Toggle visibility for ${src.name}"
                    .checked=${src.visible}
                    @click=${(e: Event) => e.stopPropagation()}
                    @change=${(e: Event) => {
                      const vis = (e.target as HTMLInputElement).checked;
                      props.onToggleSourceVisibility(src.id, vis);
                    }}
                  />
                  <span
                    class="source-color-dot"
                    style="background:${src.color}"
                  ></span>
                  <span class="source-name">${src.name}</span>
                </div>
                <span class="source-badge">${src.kind}</span>
              </div>
            `
          )}
        </div>
      </div>

      <!-- Context-Sensitive Inspector for Selected Source -->
      ${props.inspectorContent}
    </aside>
  `;
}
