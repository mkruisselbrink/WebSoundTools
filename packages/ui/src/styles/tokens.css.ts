// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';

/**
 * High-contrast dark Slate-950 design tokens (`--foh-*`) tuned for low-light venue environments.
 */
export const fohTokensCss = css`
  :host {
    --foh-bg-app: #060911;
    --foh-bg-panel: #0b1120;
    --foh-bg-header: #0f172a;
    --foh-bg-elevated: #162033;
    --foh-bg-card: #080d19;
    --foh-bg-input: #090d16;
    --foh-border-subtle: #1e293b;
    --foh-border-card: #263554;
    --foh-border-strong: #334155;
    --foh-text-primary: #f8fafc;
    --foh-text-secondary: #cbd5e1;
    --foh-text-muted: #94a3b8;
    --foh-accent: #0284c7;
    --foh-accent-hover: #0369a1;
    --foh-accent-bright: #38bdf8;
    --foh-success: #10b981;
    --foh-warning: #f59e0b;
    --foh-danger: #ef4444;
    --foh-font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      Oxygen, Ubuntu, sans-serif;
    --foh-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --foh-radius-sm: 4px;
    --foh-radius-md: 6px;
    --foh-radius-lg: 8px;
  }
`;
