// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Application shell layout styles composing `@foh/ui` design tokens, controls, and panels.
 */

import { fohControlsCss, fohPanelsCss, fohTokensCss } from '@foh/ui';
import { css } from 'lit';

export const appShellStyles = [
  fohTokensCss,
  fohControlsCss,
  fohPanelsCss,
  css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      background: var(--_foh-bg-app);
      color: var(--_foh-text-primary);
      font-family: var(--_foh-font-sans);
      font-size: 12px;
      box-sizing: border-box;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    /* --- Main Workspace Split --- */
    .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    @media (max-width: 980px) {
      .workspace {
        grid-template-columns: minmax(0, 1fr) 290px;
      }
    }

    .center-column {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .viewports-grid {
      display: grid;
      gap: 6px;
      flex: 1;
      min-height: 0;
    }

    .viewports-grid[data-layout='split'] {
      grid-template-columns: 1fr 1fr;
    }

    .viewports-grid[data-layout='plan'],
    .viewports-grid[data-layout='section'] {
      grid-template-columns: 1fr;
    }

    .chart-drawer {
      height: 225px;
      min-height: 170px;
      flex-shrink: 0;
    }

    /* --- Right Dock (Scene Tree + Inspector) --- */
    .right-dock {
      display: flex;
      flex-direction: column;
      background: var(--_foh-bg-panel);
      border-left: 1px solid var(--_foh-border-subtle);
      min-height: 0;
      overflow: hidden;
    }

    .scene-sidebar {
      flex: 0 0 42%;
      min-height: 180px;
      max-height: 46%;
      overflow-y: auto;
      border-bottom: 1px solid var(--_foh-border-subtle);
      padding: 6px 8px;
    }

    .inspector-pane {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 10px 16px;
    }

    /* --- Compact 2-Column Horizontal Inspector Field Rows & Schedule Table --- */
    .field-row {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      align-items: center;
      gap: 6px;
      margin-bottom: 5px;
    }

    .field-row:last-child {
      margin-bottom: 0;
    }

    .field-row input,
    .field-row select {
      min-width: 0;
      width: 100%;
    }

    .field-label {
      font-size: 11px;
      color: var(--_foh-text-secondary);
    }

    .cabinet-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--_foh-font-mono);
      font-size: 10px;
      color: var(--_foh-text-secondary);
    }

    .cabinet-table th,
    .cabinet-table td {
      padding: 2px 4px;
      text-align: left;
      border-bottom: 1px solid #131c2e;
    }

    .cabinet-table th {
      color: var(--_foh-text-muted);
      font-weight: 600;
    }
  `,
];
