// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohControlsCss } from '../styles/controls.css.js';
import { fohTokensCss } from '../styles/tokens.css.js';

@customElement('foh-modal')
export class FohModal extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    css`
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(3, 6, 12, 0.78);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 120;
        padding: 16px;
      }

      .dialog {
        width: min(var(--foh-modal-max-width, 580px), 96vw);
        max-height: 88vh;
        background: var(--foh-bg-panel, #0b1120);
        border: 1px solid var(--foh-border-strong, #334155);
        border-radius: var(--foh-radius-lg, 8px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: var(--foh-text-primary, #f8fafc);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
        font-size: 12px;
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 14px;
        background: var(--foh-bg-header, #0f172a);
        border-bottom: 1px solid var(--foh-border-subtle, #1e293b);
      }

      .head-title {
        font-weight: 700;
        font-size: 13px;
      }

      .body {
        padding: 12px 14px;
        overflow-y: auto;
        flex: 1;
      }
    `,
  ];

  @property({ type: Boolean })
  public open = false;

  @property({ type: String })
  public modalTitle = '';

  @property({ type: String })
  public maxWidth = '580px';

  @property({ type: String })
  public dialogTestId = '';

  @property({ type: String })
  public closeButtonTestId = '';

  private emitClose(): void {
    this.dispatchEvent(
      new CustomEvent('close-modal', { bubbles: true, composed: true })
    );
  }

  protected render() {
    if (!this.open) return nothing;

    return html`
      <div
        class="backdrop"
        data-testid=${this.dialogTestId || nothing}
        @click=${(ev: MouseEvent) => {
          if (ev.target === ev.currentTarget) this.emitClose();
        }}
      >
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-label=${this.modalTitle}
          style="--foh-modal-max-width:${this.maxWidth}"
        >
          <div class="head">
            <span class="head-title">${this.modalTitle}</span>
            <button
              class="foh-btn"
              data-testid=${this.closeButtonTestId || nothing}
              @click=${() => this.emitClose()}
            >
              Close
            </button>
          </div>
          <slot name="subheader"></slot>
          <div class="body">
            <slot></slot>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-modal': FohModal;
  }
}
