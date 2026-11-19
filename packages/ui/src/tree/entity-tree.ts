// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohControlsCss } from '../styles/controls.css.js';
import { fohPanelsCss } from '../styles/panels.css.js';
import { fohTokensCss } from '../styles/tokens.css.js';

export interface EntityTreeToggleConfig {
  readonly kind: 'checkbox' | 'button';
  readonly active: boolean;
  readonly activeLabel?: string;
  readonly inactiveLabel?: string;
  readonly dangerWhenInactive?: boolean;
  readonly ariaLabel?: string;
  readonly onToggle: (nextActive: boolean) => void;
}

export interface EntityTreeRowItem {
  readonly id: string;
  readonly title: string;
  readonly selected: boolean;
  readonly color?: string;
  readonly badge?: string;
  readonly testId?: string;
  readonly toggle?: EntityTreeToggleConfig;
  readonly onSelect: () => void;
}

export interface EntityTreeSectionProps {
  readonly title?: string;
  readonly headerActions?: TemplateResult | typeof nothing;
  readonly listTestId?: string;
  readonly items: readonly EntityTreeRowItem[];
}

export function renderEntityTreeSection(
  props: EntityTreeSectionProps
): TemplateResult {
  return html`
    <div class="foh-tree-section">
      ${props.title || props.headerActions
        ? html`
            <div class="foh-tree-header">
              <span>${props.title ?? ''}</span>
              ${props.headerActions
                ? html`<div class="foh-tree-actions">${props.headerActions}</div>`
                : nothing}
            </div>
          `
        : nothing}

      <div
        class="foh-tree-list"
        data-testid=${props.listTestId ?? nothing}
      >
        ${props.items.map((item) => {
          const toggleLabel = item.toggle?.active
            ? (item.toggle.activeLabel ?? 'On')
            : (item.toggle?.inactiveLabel ?? 'Off');

          return html`
            <div
              class="foh-tree-row"
              data-testid=${item.testId ?? nothing}
              data-selected=${String(item.selected)}
              @click=${(ev: MouseEvent) => {
                if (ev.target === ev.currentTarget) item.onSelect();
              }}
            >
              ${item.toggle?.kind === 'checkbox'
                ? html`
                    <input
                      type="checkbox"
                      aria-label=${item.toggle.ariaLabel ?? `Toggle ${item.title}`}
                      .checked=${item.toggle.active}
                      @click=${(ev: Event) => ev.stopPropagation()}
                      @change=${(ev: Event) =>
                        item.toggle?.onToggle((ev.target as HTMLInputElement).checked)}
                    />
                  `
                : nothing}

              <button
                type="button"
                class="foh-tree-row-select"
                aria-pressed=${String(item.selected)}
                @click=${item.onSelect}
              >
                ${item.color
                  ? html`<span
                      class="foh-swatch"
                      aria-hidden="true"
                      style="background:${item.color}"
                    ></span>`
                  : nothing}
                <span class="foh-tree-row-title">${item.title}</span>
                ${item.badge
                  ? html`<span class="foh-badge">${item.badge}</span>`
                  : nothing}
              </button>

              ${item.toggle?.kind === 'button'
                ? html`
                    <button
                      type="button"
                      class="foh-btn foh-btn-xs foh-tree-toggle-btn ${!item.toggle.active &&
                      item.toggle.dangerWhenInactive
                        ? 'foh-btn-danger'
                        : ''}"
                      aria-pressed=${String(item.toggle.active)}
                      aria-label=${item.toggle.ariaLabel ?? nothing}
                      @click=${(ev: Event) => {
                        ev.stopPropagation();
                        item.toggle?.onToggle(!item.toggle.active);
                      }}
                    >
                      ${toggleLabel}${item.toggle.ariaLabel
                        ? nothing
                        : html`<span class="foh-sr-only"> (${item.title})</span>`}
                    </button>
                  `
                : nothing}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

@customElement('foh-entity-tree')
export class FohEntityTree extends LitElement {
  static styles = [fohTokensCss, fohControlsCss, fohPanelsCss];

  @property({ attribute: false })
  public sections: readonly EntityTreeSectionProps[] = [];

  protected render() {
    return html`${this.sections.map((s) => renderEntityTreeSection(s))}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-entity-tree': FohEntityTree;
  }
}
