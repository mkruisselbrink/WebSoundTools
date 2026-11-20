// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { renderEntityTreeSection } from '@foh/ui';
import { html, nothing, TemplateResult } from 'lit';
import { SourceData } from '../sources/source-data.js';

export interface SidebarViewProps {
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
      <div class="section-card">
        ${renderEntityTreeSection({
          title: `Sources (${props.allSources.length})`,
          listTestId: 'source-list',
          headerActions: html`
            ${props.onAddLiveSource
              ? html`
                  <button
                    class="foh-btn foh-btn-xs"
                    data-testid="btn-add-meas"
                    title="Add Simultaneous Live Measurement Source (M)"
                    @click=${props.onAddLiveSource}
                  >
                    + Meas
                  </button>
                `
              : nothing}
            <button
              class="foh-btn foh-btn-xs"
              data-testid="btn-add-eq"
              title="Add Virtual Parametric EQ & Crossover Source"
              @click=${props.onAddEqSource}
            >
              + EQ
            </button>
            <button
              class="foh-btn foh-btn-xs"
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
                      id="wsm-input-import-frd"
                      name="import-frd-file"
                      aria-label="Import .FRD Trace File"
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
                      class="foh-btn foh-btn-xs"
                      data-testid="btn-import-frd"
                    >
                      + .FRD
                    </span>
                  </label>
                `
              : nothing}
          `,
          items: props.allSources.map((src) => ({
            id: src.id,
            title: src.name,
            selected: props.selectedSourceId === src.id,
            color: src.color,
            badge: src.kind,
            testId: `source-item-${src.id}`,
            toggle: {
              kind: 'checkbox',
              active: src.visible,
              ariaLabel: `Toggle visibility for ${src.name}`,
              onToggle: (vis) => props.onToggleSourceVisibility(src.id, vis),
            },
            onSelect: () => props.onSelectSource(src.id),
          })),
        })}
      </div>

      ${props.inspectorContent}
    </aside>
  `;
}
