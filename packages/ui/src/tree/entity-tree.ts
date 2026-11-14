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
        ${props.items.map(
          (item) => html`
            <div
              class="foh-tree-row"
              data-testid=${item.testId ?? nothing}
              data-selected=${String(item.selected)}
              @click=${item.onSelect}
            >
              <div class="foh-tree-row-main">
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
                ${item.color
                  ? html`<span
                      class="foh-swatch"
                      style="background:${item.color}"
                    ></span>`
                  : nothing}
                <span class="foh-tree-row-title">${item.title}</span>
                ${item.badge && item.toggle?.kind === 'button'
                  ? html`<span class="foh-badge">${item.badge}</span>`
                  : nothing}
              </div>

              ${item.badge && item.toggle?.kind !== 'button'
                ? html`<span class="foh-badge">${item.badge}</span>`
                : nothing}

              ${item.toggle?.kind === 'button'
                ? html`
                    <button
                      class="foh-btn foh-btn-xs ${!item.toggle.active &&
                      item.toggle.dangerWhenInactive
                        ? 'foh-btn-danger'
                        : ''}"
                      aria-label=${item.toggle.ariaLabel ?? `Toggle ${item.title}`}
                      @click=${(ev: Event) => {
                        ev.stopPropagation();
                        item.toggle?.onToggle(!item.toggle.active);
                      }}
                    >
                      ${item.toggle.active
                        ? (item.toggle.activeLabel ?? 'On')
                        : (item.toggle.inactiveLabel ?? 'Off')}
                    </button>
                  `
                : nothing}
            </div>
          `
        )}
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
