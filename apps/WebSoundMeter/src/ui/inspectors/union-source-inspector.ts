// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { html, nothing, TemplateResult } from 'lit';
import { SourceData } from '../../sources/source-data.js';
import {
  UNION_OPERATION_LABELS,
  UnionOperation,
  UnionSourceConfig,
} from '../../sources/union-source.js';

export interface UnionInspectorHandlers {
  readonly onUpdateUnion: (
    unionId: string,
    partial: Partial<Pick<UnionSourceConfig, 'operation' | 'sourceIds'>>
  ) => void;
  readonly onDelete?: (unionId: string) => void;
}

const ORDERED_BINARY_OPS: ReadonlySet<UnionOperation> = new Set([
  'diff-db',
  'subtract',
  'apply',
]);

export function renderUnionInspector(
  union: UnionSourceConfig,
  allSources: readonly SourceData[],
  handlers: UnionInspectorHandlers
): TemplateResult {
  const candidates = allSources.filter((s) => s.id !== union.id);
  const isBinaryOp = ORDERED_BINARY_OPS.has(union.operation);
  const selectedIds = new Set(union.sourceIds);

  return html`
    <div class="section-card" data-testid="inspector-union-source">
      <div class="section-header">
        <span>${union.name}</span>
        ${handlers.onDelete
          ? html`
              <button
                style="color:#f43f5e;"
                @click=${() => handlers.onDelete?.(union.id)}
              >
                Delete
              </button>
            `
          : nothing}
      </div>

      <div class="prop-grid">
        <div class="prop-field full-width">
          <label>Math Operation</label>
          <select
            aria-label="Union Math Operation"
            .value=${union.operation}
            @change=${(e: Event) => {
              const nextOp = (e.target as HTMLSelectElement).value as UnionOperation;
              if (ORDERED_BINARY_OPS.has(nextOp) && union.sourceIds.length !== 2) {
                const s0 = union.sourceIds[0] ?? candidates[0]?.id ?? '';
                const s1 =
                  union.sourceIds[1] ??
                  candidates.find((c) => c.id !== s0)?.id ??
                  s0;
                handlers.onUpdateUnion(union.id, {
                  operation: nextOp,
                  sourceIds: [s0, s1],
                });
              } else {
                handlers.onUpdateUnion(union.id, { operation: nextOp });
              }
            }}
          >
            ${Object.entries(UNION_OPERATION_LABELS).map(
              ([k, label]) =>
                html`<option value=${k} ?selected=${k === union.operation}>${label}</option>`
            )}
          </select>
        </div>

        ${isBinaryOp
          ? html`
              <div class="prop-field">
                <label>Source A</label>
                <select
                  aria-label="Union Source A"
                  .value=${union.sourceIds[0] ?? ''}
                  @change=${(e: Event) => {
                    const srcA = (e.target as HTMLSelectElement).value;
                    handlers.onUpdateUnion(union.id, {
                      sourceIds: [srcA, union.sourceIds[1] ?? srcA],
                    });
                  }}
                >
                  ${candidates.map(
                    (s) =>
                      html`<option value=${s.id} ?selected=${s.id === union.sourceIds[0]}>
                        ${s.name}
                      </option>`
                  )}
                </select>
              </div>

              <div class="prop-field">
                <label>Source B</label>
                <select
                  aria-label="Union Source B"
                  .value=${union.sourceIds[1] ?? ''}
                  @change=${(e: Event) => {
                    const srcB = (e.target as HTMLSelectElement).value;
                    handlers.onUpdateUnion(union.id, {
                      sourceIds: [union.sourceIds[0] ?? srcB, srcB],
                    });
                  }}
                >
                  ${candidates.map(
                    (s) =>
                      html`<option value=${s.id} ?selected=${s.id === union.sourceIds[1]}>
                        ${s.name}
                      </option>`
                  )}
                </select>
              </div>
            `
          : html`
              <div
                class="prop-field full-width"
                role="group"
                aria-label="Sources to Combine"
              >
                <label>Sources to Combine (${union.sourceIds.length} selected)</label>
                <div class="union-source-checklist" data-testid="union-source-checklist">
                  ${candidates.map((s) => {
                    const checked = selectedIds.has(s.id);
                    return html`
                      <label class="union-check-row">
                        <input
                          type="checkbox"
                          aria-label="Include ${s.name} in Union"
                          .checked=${checked}
                          @change=${(e: Event) => {
                            const nextChecked = (e.target as HTMLInputElement).checked;
                            const nextSet = new Set(union.sourceIds);
                            if (nextChecked) {
                              nextSet.add(s.id);
                            } else if (nextSet.size > 1) {
                              nextSet.delete(s.id);
                            } else {
                              (e.target as HTMLInputElement).checked = true;
                              return;
                            }
                            const ordered = candidates
                              .map((c) => c.id)
                              .filter((id) => nextSet.has(id));
                            handlers.onUpdateUnion(union.id, {
                              sourceIds: ordered.length > 0 ? ordered : [s.id],
                            });
                          }}
                        />
                        <span
                          class="source-color-dot"
                          style="background:${s.color}"
                        ></span>
                        <span class="source-name">${s.name}</span>
                      </label>
                    `;
                  })}
                </div>
              </div>
            `}
      </div>
    </div>
  `;
}
