// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `<wss-projects-modal>` dialog managing saved IndexedDB venue projects and
 * local workspace autosave resets.
 */

import { fohControlsCss, fohTokensCss } from '@foh/ui';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SavedProjectRecord } from '../../model/session-storage.js';

@customElement('wss-projects-modal')
export class WssProjectsModal extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    css`
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .actions-row {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }

      .empty-note {
        color: var(--_foh-text-muted, #94a3b8);
        font-size: 12px;
      }

      .proj-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .proj-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 9px;
        background: var(--_foh-bg-card, #080d19);
        border: 1px solid var(--_foh-border-subtle, #1e293b);
        border-radius: 5px;
      }

      .proj-meta {
        font-size: 10.5px;
        color: var(--_foh-text-muted, #94a3b8);
        margin-top: 2px;
      }

      .proj-btns {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
    `,
  ];

  @property({ type: Boolean }) public open = false;
  @property({ type: String }) public sceneName = '';
  @property({ attribute: false }) public savedProjects: readonly SavedProjectRecord[] = [];
  @property({ attribute: false }) public onSaveCurrent: () => void = () => {};
  @property({ attribute: false }) public onResetAutosave: () => void = () => {};
  @property({ attribute: false }) public onLoadProject: (proj: SavedProjectRecord) => void =
    () => {};
  @property({ attribute: false }) public onDeleteProject: (projectId: string) => void = () => {};

  private close(): void {
    this.dispatchEvent(new CustomEvent('close-modal', { bubbles: true, composed: true }));
  }

  protected render() {
    if (!this.open) return nothing;

    return html`
      <foh-modal
        .open=${this.open}
        modalTitle="Saved Browser Projects (IndexedDB)"
        maxWidth="560px"
        docRegion="projects-modal"
        dialogTestId="projects-modal"
        @close-modal=${() => this.close()}
      >
        <div class="actions-row">
          <button
            type="button"
            class="foh-btn foh-btn-primary"
            data-testid="btn-save-project-db"
            @click=${this.onSaveCurrent}
          >
            Save Current Scene ("${this.sceneName}")
          </button>
          <button type="button" class="foh-btn foh-btn-danger" @click=${this.onResetAutosave}>
            Reset Local Autosave
          </button>
        </div>

        ${this.savedProjects.length === 0
          ? html`<div class="empty-note">No projects saved in IndexedDB yet.</div>`
          : html`
              <div class="proj-list">
                ${this.savedProjects.map(
                  (proj) => html`
                    <div class="proj-card">
                      <div>
                        <strong>${proj.name}</strong>
                        <div class="proj-meta">
                          Updated: ${proj.updatedAtIso.slice(0, 19).replace('T', ' ')}
                        </div>
                      </div>
                      <div class="proj-btns">
                        <button
                          type="button"
                          class="foh-btn foh-btn-primary"
                          data-testid="btn-load-proj-${proj.id}"
                          @click=${() => this.onLoadProject(proj)}
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          class="foh-btn foh-btn-danger"
                          @click=${() => this.onDeleteProject(proj.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  `
                )}
              </div>
            `}
      </foh-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-projects-modal': WssProjectsModal;
  }
}
