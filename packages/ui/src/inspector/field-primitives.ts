// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { html, nothing, type TemplateResult } from 'lit';

export function numVal(ev: Event, fallback: number): number {
  const raw = (ev.target as HTMLInputElement).value;
  if (raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface CoordinateFieldSpec {
  readonly label: string;
  readonly value: number;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly precision?: number;
  readonly testId?: string;
  readonly ariaLabel?: string;
  readonly onInput: (value: number) => void;
}

export function renderCoordinateGrid(
  fields: readonly CoordinateFieldSpec[]
): TemplateResult {
  const gridClass = fields.length <= 2 ? 'foh-xy-grid' : 'foh-xyz-grid';
  return html`
    <div class=${gridClass}>
      ${fields.map((field, idx) => {
        const displayValue =
          field.precision !== undefined
            ? String(Number(field.value.toFixed(field.precision)))
            : String(field.value);
        const fieldName =
          field.testId ??
          `coord-${field.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx}`;
        return html`
          <label class="foh-mini-field">
            <span>${field.label}</span>
            <input
              type="number"
              name=${fieldName}
              step=${field.step !== undefined ? String(field.step) : '0.1'}
              min=${field.min !== undefined ? String(field.min) : nothing}
              max=${field.max !== undefined ? String(field.max) : nothing}
              data-testid=${field.testId ?? nothing}
              aria-label=${field.ariaLabel ?? field.label}
              .value=${displayValue}
              @input=${(ev: Event) => {
                let next = numVal(ev, field.value);
                if (field.min !== undefined) next = Math.max(field.min, next);
                if (field.max !== undefined) next = Math.min(field.max, next);
                field.onInput(next);
              }}
            />
          </label>
        `;
      })}
    </div>
  `;
}
