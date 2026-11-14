// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohTokensCss } from '../styles/tokens.css.js';

@customElement('foh-toast')
export class FohToast extends LitElement {
  static styles = [
    fohTokensCss,
    css`
      :host {
        position: fixed;
        bottom: 14px;
        right: var(--foh-toast-right, 356px);
        z-index: 95;
        pointer-events: none;
      }

      .banner {
        background: var(--foh-bg-header, #0f172a);
        border: 1px solid var(--foh-accent-bright, #38bdf8);
        color: var(--foh-text-primary, #f8fafc);
        padding: 6px 12px;
        border-radius: var(--foh-radius-md, 6px);
        font-size: 11.5px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }
    `,
  ];

  @property({ type: String })
  public message = '';

  protected render() {
    if (!this.message) return nothing;
    return html`<div class="banner" role="status" aria-live="polite">
      ${this.message}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-toast': FohToast;
  }
}
