// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohControlsCss } from '../styles/controls.css.js';
import { fohTokensCss } from '../styles/tokens.css.js';

/**
 * Top-layer non-modal status toast (`popover="manual"`) with polite live announcement
 * and a keyboard-focusable dismiss button.
 */
@customElement('foh-toast')
export class FohToast extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    css`
      :host {
        position: fixed;
        inset: auto var(--foh-toast-right, 356px) 14px auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        z-index: 95;
      }

      :host([popover]:is(:popover-open, .\\:popover-open)) {
        display: block;
      }

      .banner {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: min(440px, calc(100vw - 28px));
        background: var(--_foh-bg-header, #0f172a);
        border: 1px solid var(--_foh-accent-bright, #38bdf8);
        color: var(--_foh-text-primary, #f8fafc);
        padding: 6px 10px 6px 12px;
        border-radius: var(--_foh-radius-md, 6px);
        font-size: 11.5px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }

      .dismiss-btn {
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--_foh-radius-sm, 4px);
        color: var(--_foh-text-muted, #94a3b8);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        padding: 2px 5px;
        cursor: pointer;
      }

      @media (hover: hover) {
        .dismiss-btn:hover {
          color: #ffffff;
          border-color: var(--_foh-border-strong, #334155);
        }
      }
    `,
  ];

  @property({ type: String })
  public message = '';

  public connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('popover') && typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype) {
      this.setAttribute('popover', 'manual');
    }
    this.syncPopoverVisibility();
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (changed.has('message')) {
      this.syncPopoverVisibility();
    }
  }

  private syncPopoverVisibility(): void {
    const host = this as HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    };
    if (typeof host.showPopover !== 'function' || !this.isConnected) return;
    try {
      if (this.message) {
        host.showPopover();
      } else {
        host.hidePopover?.();
      }
    } catch {
      // Ignore InvalidStateError if already open/closed
    }
  }

  private handleDismiss = (): void => {
    this.message = '';
    this.dispatchEvent(
      new CustomEvent('dismiss-toast', { bubbles: true, composed: true })
    );
  };

  protected render() {
    if (!this.message) return nothing;
    return html`
      <div class="banner" role="region" aria-label="Notifications">
        <span role="status" aria-live="polite">${this.message}</span>
        <button
          type="button"
          class="dismiss-btn"
          aria-label="Close notification"
          @click=${this.handleDismiss}
        >
          ×
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-toast': FohToast;
  }
}
