// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';

/**
 * Shared button, input, select, checkbox, swatch, and badge control styles.
 */
export const fohControlsCss = css`
  .foh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: var(--foh-bg-elevated, #162033);
    color: var(--foh-text-secondary, #cbd5e1);
    border: 1px solid var(--foh-border-strong, #334155);
    border-radius: var(--foh-radius-sm, 4px);
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .foh-btn:hover:not(:disabled) {
    background: #1e293b;
    border-color: var(--foh-accent-bright, #38bdf8);
    color: #ffffff;
  }

  .foh-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .foh-btn-primary {
    background: var(--foh-accent, #0284c7);
    border-color: var(--foh-accent-bright, #38bdf8);
    color: #ffffff;
  }

  .foh-btn-primary:hover:not(:disabled) {
    background: var(--foh-accent-hover, #0369a1);
  }

  .foh-btn-accent {
    background: #059669;
    border-color: var(--foh-success, #10b981);
    color: #ffffff;
  }

  .foh-btn-accent:hover:not(:disabled) {
    background: #047857;
  }

  .foh-btn-danger {
    background: rgba(239, 68, 68, 0.14);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fca5a5;
  }

  .foh-btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.28);
    color: #ffffff;
  }

  .foh-btn-xs {
    padding: 1px 6px;
    font-size: 10.5px;
  }

  .foh-badge {
    font-family: var(--foh-font-mono, monospace);
    font-size: 9.5px;
    color: var(--foh-text-muted, #94a3b8);
    background: var(--foh-bg-input, #090d16);
    border: 1px solid var(--foh-border-subtle, #1e293b);
    border-radius: 3px;
    padding: 0 5px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .foh-swatch {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .foh-check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .foh-check-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--foh-text-secondary, #cbd5e1);
    cursor: pointer;
  }
`;
