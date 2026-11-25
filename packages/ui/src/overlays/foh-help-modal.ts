// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fohControlsCss } from '../styles/controls.css.js';
import { fohTokensCss } from '../styles/tokens.css.js';
import './foh-modal.js';

export const FOH_GITHUB_REPO_URL = 'https://github.com/mkruisselbrink/WebSoundTools';
export const FOH_GITHUB_ISSUES_URL =
  'https://github.com/mkruisselbrink/WebSoundTools/issues';
export const FOH_GITHUB_TUTORIALS_URL =
  'https://github.com/mkruisselbrink/WebSoundTools/blob/main/docs/tutorials/README.md';

export interface HelpResourceLink {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly testId?: string;
}

export interface HelpShortcutItem {
  readonly keys: string;
  readonly action: string;
}

export interface HelpCommitLink {
  readonly sha: string;
  readonly shortSha: string;
  readonly href: string;
}

declare global {
  interface ImportMetaEnv {
    readonly VITE_GIT_COMMIT_SHA?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const DEFAULT_BUILD_COMMIT_SHA: string =
  (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_GIT_COMMIT_SHA) || '';

/**
 * Resolves a validated hexadecimal git commit SHA into a display short hash and GitHub commit URL.
 * Returns `null` when unset (e.g. local development builds) or malformed.
 */
export function resolveHelpCommitLink(
  rawSha: string | undefined,
  repoUrl: string = FOH_GITHUB_REPO_URL
): HelpCommitLink | null {
  const normalized = (rawSha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(normalized)) {
    return null;
  }
  const base = repoUrl.replace(/\/+$/, '');
  return {
    sha: normalized,
    shortSha: normalized.slice(0, 8),
    href: `${base}/commit/${normalized}`,
  };
}

/**
 * Decorative 16x16 GitHub mark (`aria-hidden="true"`) for pairing with visible link text.
 */
export function renderGithubMarkSvg(): TemplateResult {
  return html`
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      style="flex-shrink:0"
    >
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
        0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
        1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
        0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09
        2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87
        3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      ></path>
    </svg>
  `;
}

/**
 * Shared Help, Documentation, Issue Reporting, Source Code & Keyboard Shortcuts modal
 * built on `<foh-modal>` (`<dialog>` + `.showModal()`).
 */
@customElement('foh-help-modal')
export class FohHelpModal extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    css`
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .summary {
        margin: 0 0 12px;
        color: var(--_foh-text-secondary, #cbd5e1);
        line-height: 1.45;
      }

      .update-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
        padding: 8px 11px;
        background: rgba(2, 132, 199, 0.16);
        border: 1px solid var(--_foh-accent-bright, #38bdf8);
        border-radius: var(--_foh-radius-md, 6px);
        font-size: 11.5px;
        color: var(--_foh-text-primary, #f8fafc);
      }

      .section-heading {
        margin: 0 0 8px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--_foh-text-muted, #94a3b8);
      }

      .resource-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        list-style: none;
        padding: 0;
        margin: 0 0 14px;
      }

      .resource-grid > li {
        display: flex;
        min-width: 0;
      }

      @media (max-width: 540px) {
        .resource-grid {
          grid-template-columns: 1fr;
        }
      }

      .resource-card {
        display: flex;
        flex-direction: column;
        flex: 1;
        width: 100%;
        gap: 4px;
        padding: 9px 11px;
        background: var(--_foh-bg-input, #090d16);
        border: 1px solid var(--_foh-border-subtle, #1e293b);
        border-radius: var(--_foh-radius-md, 6px);
        color: var(--_foh-text-primary, #f8fafc);
        text-decoration: none;
        min-block-size: 24px;
      }

      @media (hover: hover) {
        .resource-card:hover {
          border-color: var(--_foh-accent-bright, #38bdf8);
          background: #0f172a;
        }
      }

      .resource-title {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        font-weight: 600;
        font-size: 12px;
        color: var(--_foh-accent-bright, #38bdf8);
      }

      .resource-desc {
        font-size: 11px;
        color: var(--_foh-text-muted, #94a3b8);
        line-height: 1.35;
      }

      .shortcut-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 12px;
        font-size: 11.5px;
      }

      .shortcut-table th,
      .shortcut-table td {
        padding: 5px 6px;
        text-align: left;
        border-bottom: 1px solid var(--_foh-border-subtle, #1e293b);
      }

      .shortcut-table th {
        font-size: 10.5px;
        font-weight: 600;
        color: var(--_foh-text-muted, #94a3b8);
      }

      .shortcut-table td:first-child {
        white-space: nowrap;
        width: 1%;
        padding-right: 14px;
      }

      kbd {
        display: inline-block;
        padding: 1px 5px;
        font-family: var(--_foh-font-mono, ui-monospace, monospace);
        font-size: 10.5px;
        color: var(--_foh-text-primary, #f8fafc);
        background: var(--_foh-bg-elevated, #162033);
        border: 1px solid var(--_foh-border-strong, #334155);
        border-radius: 3px;
      }

      .legal-footer {
        padding-top: 8px;
        border-top: 1px solid var(--_foh-border-subtle, #1e293b);
        font-size: 10.5px;
        color: var(--_foh-text-muted, #94a3b8);
        line-height: 1.45;
      }

      .build-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 6px;
      }

      .commit-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-block-size: 24px;
        padding: 2px 7px;
        background: var(--_foh-bg-input, #090d16);
        border: 1px solid var(--_foh-border-subtle, #1e293b);
        border-radius: var(--_foh-radius-sm, 4px);
        color: var(--_foh-accent-bright, #38bdf8);
        text-decoration: none;
        font-size: 11px;
      }

      @media (hover: hover) {
        .commit-link:hover {
          border-color: var(--_foh-accent-bright, #38bdf8);
          background: #0f172a;
        }
      }
    `,
  ];

  @property({ type: Boolean })
  public open = false;

  @property({ type: String })
  public appName = '';

  @property({ type: String })
  public appSummary = '';

  @property({ attribute: false })
  public resources: readonly HelpResourceLink[] = [];

  @property({ attribute: false })
  public shortcuts: readonly HelpShortcutItem[] = [];

  @property({ type: String })
  public attribution = '';

  @property({ type: String })
  public repoUrl = FOH_GITHUB_REPO_URL;

  @property({ type: String })
  public commitSha = DEFAULT_BUILD_COMMIT_SHA;

  @property({ type: String })
  public dialogTestId = 'help-modal';

  @property({ type: String })
  public closeButtonTestId = '';

  @property({ type: Boolean })
  public updateReady = false;

  protected render() {
    const commitLink = resolveHelpCommitLink(this.commitSha, this.repoUrl);
    return html`
      <foh-modal
        .open=${this.open}
        .modalTitle=${`${this.appName} — Help, Shortcuts & Open Source`}
        maxWidth="620px"
        docRegion="help-modal"
        .dialogTestId=${this.dialogTestId}
        .closeButtonTestId=${this.closeButtonTestId}
      >
        ${this.updateReady
          ? html`
              <div class="update-banner" data-testid="help-update-banner">
                <span>A newer offline version of ${this.appName} has been downloaded.</span>
                <button
                  type="button"
                  class="foh-btn foh-btn-primary"
                  data-testid="btn-apply-app-update"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('apply-app-update', {
                        bubbles: true,
                        composed: true,
                      })
                    )}
                >
                  Apply Update &amp; Reload
                </button>
              </div>
            `
          : nothing}
        ${this.appSummary ? html`<p class="summary">${this.appSummary}</p>` : nothing}

        ${this.resources.length > 0
          ? html`
              <h3 class="section-heading">Documentation, Issues &amp; Source Code</h3>
              <ul class="resource-grid" role="list">
                ${this.resources.map(
                  (item) => html`
                    <li>
                      <a
                        class="resource-card"
                        href=${item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid=${item.testId || nothing}
                      >
                        <span class="resource-title">
                          <span>${item.title}</span>
                          <span aria-hidden="true">↗</span>
                        </span>
                        <span class="resource-desc">${item.description}</span>
                      </a>
                    </li>
                  `
                )}
              </ul>
            `
          : nothing}

        ${this.shortcuts.length > 0
          ? html`
              <h3 class="section-heading">Keyboard Shortcuts</h3>
              <table class="shortcut-table">
                <caption class="foh-sr-only">
                  ${this.appName} keyboard shortcuts
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Shortcut</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.shortcuts.map(
                    (row) => html`
                      <tr>
                        <td><kbd>${row.keys}</kbd></td>
                        <td>${row.action}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            `
          : nothing}

        <footer class="legal-footer">
          <div>
            Runs 100% locally in your browser — audio, measurements, and venue projects never
            leave your device. Free &amp; open-source software licensed under
            <code>GPL-3.0-or-later</code>.${this.attribution ? ` ${this.attribution}` : ''}
          </div>
          ${commitLink
            ? html`
                <div class="build-meta" data-testid="help-build-commit">
                  <span>Deployed build:</span>
                  <a
                    class="commit-link"
                    href=${commitLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="help-link-commit"
                  >
                    ${renderGithubMarkSvg()}
                    <span>Commit <code>${commitLink.shortSha}</code></span>
                    <span class="foh-sr-only">on GitHub</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              `
            : nothing}
        </footer>
      </foh-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'foh-help-modal': FohHelpModal;
  }
}
