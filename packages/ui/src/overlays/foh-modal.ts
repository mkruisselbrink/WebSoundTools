// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohControlsCss } from '../styles/controls.css.js';
import { fohTokensCss } from '../styles/tokens.css.js';

function isPointerOutsideDialogBox(ev: PointerEvent, dialog: HTMLDialogElement): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    ev.clientX < rect.left ||
    ev.clientX > rect.right ||
    ev.clientY < rect.top ||
    ev.clientY > rect.bottom
  );
}

/**
 * Native `<dialog>` modal overlay promoted to the browser Top Layer via `.showModal()`.
 *
 * Provides native background `inert` behavior, focus containment, `Esc` / back-gesture
 * dismissal, automatic focus restoration to the invoker, and `closedby="any"` light dismiss
 * with a coordinate-bounds `pointerdown` / `pointerup` fallback where `closedBy` is absent.
 */
@customElement('foh-modal')
export class FohModal extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    css`
      dialog {
        width: min(var(--foh-modal-max-width, 580px), 96vw);
        max-height: 88vh;
        max-height: 88dvh;
        margin: auto;
        padding: 0;
        background: var(--_foh-bg-panel, #0b1120);
        border: 1px solid var(--_foh-border-strong, #334155);
        border-radius: var(--_foh-radius-lg, 8px);
        overflow: hidden;
        color: var(--_foh-text-primary, #f8fafc);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
        font-size: 12px;
      }

      dialog[open] {
        display: flex;
        flex-direction: column;
      }

      dialog:modal {
        overscroll-behavior: contain;
      }

      dialog::backdrop {
        overflow: hidden;
        overscroll-behavior: contain;
        background: rgba(3, 6, 12, 0.78);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 14px;
        background: var(--_foh-bg-header, #0f172a);
        border-bottom: 1px solid var(--_foh-border-subtle, #1e293b);
      }

      .head-title {
        margin: 0;
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
  public docRegion = '';

  @property({ type: String })
  public closeButtonTestId = '';

  private pressedOutside = false;

  private get dialogEl(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (!changed.has('open')) return;
    const dialog = this.dialogEl;
    if (!dialog) return;

    if (this.open) {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }

  private emitClose(): void {
    this.dispatchEvent(
      new CustomEvent('close-modal', { bubbles: true, composed: true })
    );
  }

  private requestModalClose(): void {
    const dialog = this.dialogEl;
    if (dialog?.open && typeof dialog.close === 'function') {
      dialog.close();
    } else {
      this.emitClose();
    }
  }

  private handleNativeClose = (ev: Event): void => {
    const dialog = ev.currentTarget as HTMLDialogElement;
    dialog.returnValue = '';
    if (this.open) {
      this.emitClose();
    }
  };

  private handlePointerDown = (ev: PointerEvent): void => {
    if (typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype) {
      return;
    }
    const dialog = ev.currentTarget as HTMLDialogElement;
    this.pressedOutside = ev.target === dialog && isPointerOutsideDialogBox(ev, dialog);
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype) {
      return;
    }
    const dialog = ev.currentTarget as HTMLDialogElement;
    if (this.pressedOutside && ev.target === dialog && isPointerOutsideDialogBox(ev, dialog)) {
      dialog.close();
    }
    this.pressedOutside = false;
  };

  protected render() {
    return html`
      <dialog
        closedby="any"
        aria-labelledby="foh-modal-title"
        data-testid=${this.dialogTestId || nothing}
        data-doc-region=${this.docRegion || nothing}
        style="--foh-modal-max-width:${this.maxWidth}"
        @close=${this.handleNativeClose}
        @pointerdown=${this.handlePointerDown}
        @pointerup=${this.handlePointerUp}
      >
        ${this.open
          ? html`
              <div class="head">
                <h2 id="foh-modal-title" class="head-title">${this.modalTitle}</h2>
                <button
                  type="button"
                  class="foh-btn"
                  autofocus
                  data-testid=${this.closeButtonTestId || nothing}
                  @click=${() => this.requestModalClose()}
                >
                  Close
                </button>
              </div>
              <slot name="subheader"></slot>
              <div class="body">
                <slot></slot>
              </div>
            `
          : nothing}
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-modal': FohModal;
  }
}
