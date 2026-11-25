// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { fohControlsCss, fohTokensCss } from '@foh/ui';
import { css } from 'lit';

/**
 * Top-level layout styles for `<web-sound-meter-app>`, covering strictly the root viewport
 * shell, audio status banner, chart stack column, and Tablet Portrait Show split-deck grid.
 * Region-specific styles live inside `<wsm-topbar>`, `<wsm-tuning-sidebar>`,
 * `<wsm-show-sidebar>`, `<wsm-mobile-show-deck>`, and `<wsm-mixer-watch-modal>`.
 */
export const appShellStyles = [
  fohTokensCss,
  fohControlsCss,
  css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100vh;
      height: 100dvh;
      background: var(--_foh-bg-app, #060911);
      color: var(--_foh-text-primary, #f8fafc);
      font-family: var(--_foh-font-sans, system-ui, sans-serif);
      overflow: hidden;
      box-sizing: border-box;
    }

    * {
      box-sizing: border-box;
    }

    .audio-status-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 12px;
      background: rgba(245, 158, 11, 0.14);
      border-bottom: 1px solid #f59e0b;
      font-size: 12px;
      color: #fef3c7;
      flex-shrink: 0;
    }

    .audio-status-banner.error {
      background: rgba(239, 68, 68, 0.16);
      border-bottom-color: #ef4444;
      color: #fee2e2;
    }

    .audio-status-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .charts-column {
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: 8px;
      padding: 8px;
      min-width: 0;
      min-height: 0;
    }

    /* Tablet Portrait (680px - 959px): Full-Width Charts Over 2-Column Show Control Deck */
    @media (max-width: 959px) and (min-width: 680px) {
      .workspace[data-mode='show'] {
        flex-direction: column;
      }

      .workspace[data-mode='show'] > .charts-column {
        flex: 1 1 56%;
        min-height: 250px;
      }

      .workspace[data-mode='show'] > wsm-show-sidebar {
        width: 100%;
        flex: 0 0 44%;
        max-height: 46%;
      }
    }
  `,
];
