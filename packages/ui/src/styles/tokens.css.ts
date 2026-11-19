// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';

/**
 * High-contrast dark Slate-950 design tokens (`--foh-*`) tuned for low-light venue environments.
 *
 * Public `--foh-*` custom properties are left unset on `:host` and read via private `--_foh-*`
 * shadow aliases so consumer overrides set on `:root` or ancestor containers cascade cleanly
 * across nested Shadow DOM boundaries.
 */
export const fohTokensCss = css`
  :host {
    color-scheme: dark;
    accent-color: var(--foh-accent-bright, #38bdf8);

    --_foh-bg-app: var(--foh-bg-app, #060911);
    --_foh-bg-panel: var(--foh-bg-panel, #0b1120);
    --_foh-bg-header: var(--foh-bg-header, #0f172a);
    --_foh-bg-elevated: var(--foh-bg-elevated, #162033);
    --_foh-bg-card: var(--foh-bg-card, #080d19);
    --_foh-bg-input: var(--foh-bg-input, #090d16);
    --_foh-border-subtle: var(--foh-border-subtle, #1e293b);
    --_foh-border-card: var(--foh-border-card, #263554);
    --_foh-border-strong: var(--foh-border-strong, #334155);
    --_foh-text-primary: var(--foh-text-primary, #f8fafc);
    --_foh-text-secondary: var(--foh-text-secondary, #cbd5e1);
    --_foh-text-muted: var(--foh-text-muted, #94a3b8);
    --_foh-accent: var(--foh-accent, #0284c7);
    --_foh-accent-hover: var(--foh-accent-hover, #0369a1);
    --_foh-accent-bright: var(--foh-accent-bright, #38bdf8);
    --_foh-success: var(--foh-success, #10b981);
    --_foh-warning: var(--foh-warning, #f59e0b);
    --_foh-danger: var(--foh-danger, #ef4444);
    --_foh-font-sans: var(
      --foh-font-sans,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      Oxygen,
      Ubuntu,
      sans-serif
    );
    --_foh-font-mono: var(
      --foh-font-mono,
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      monospace
    );
    --_foh-radius-sm: var(--foh-radius-sm, 4px);
    --_foh-radius-md: var(--foh-radius-md, 6px);
    --_foh-radius-lg: var(--foh-radius-lg, 8px);
  }
`;
