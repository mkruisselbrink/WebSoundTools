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
      --bg-app: var(--foh-bg-app);
      --bg-panel: var(--foh-bg-panel);
      --bg-header: var(--foh-bg-header);
      --bg-elevated: var(--foh-bg-elevated);
      --bg-input: var(--foh-bg-input);
      --border-subtle: var(--foh-border-subtle);
      --border-strong: var(--foh-border-strong);
      --text-primary: var(--foh-text-primary);
      --text-secondary: var(--foh-text-secondary);
      --text-muted: var(--foh-text-muted);
      --accent: var(--foh-accent);
      --accent-bright: var(--foh-accent-bright);
      --success: var(--foh-success);
      --warning: var(--foh-warning);
      --danger: var(--foh-danger);
      --font-mono: var(--foh-font-mono);

      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: var(--foh-bg-app);
      color: var(--foh-text-primary);
      font-family: var(--foh-font-sans);
      font-size: 12px;
      box-sizing: border-box;
    }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* --- Topbar --- */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border-subtle);
    flex-wrap: wrap;
    min-height: 42px;
    z-index: 10;
  }

  .topbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    padding-right: 6px;
    border-right: 1px solid var(--border-subtle);
  }

  .brand-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent-bright);
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.7);
  }

  .tb-divider {
    width: 1px;
    height: 20px;
    background: var(--border-subtle);
    margin: 0 2px;
  }

  .tb-label {
    font-size: 10.5px;
    color: var(--text-muted);
    font-weight: 500;
  }

  select,
  input[type='text'],
  input[type='number'] {
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11.5px;
    outline: none;
  }

  input[type='number'] {
    font-family: var(--font-mono);
  }

  select:focus,
  input:focus {
    border-color: var(--accent-bright);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn:hover:not(:disabled) {
    background: #1e293b;
    color: #ffffff;
  }

  .btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent-bright);
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0369a1;
  }

  .btn-danger {
    background: rgba(239, 68, 68, 0.14);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fca5a5;
  }

  .btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.28);
    color: #ffffff;
  }

  .btn[data-active='true'] {
    background: var(--accent);
    border-color: var(--accent-bright);
    color: #ffffff;
  }

  .btn-xs {
    padding: 1px 6px;
    font-size: 10.5px;
  }

  .metrics-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 9px;
    background: #080d19;
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .metric-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .metric-k {
    color: var(--text-muted);
    font-size: 10px;
  }

  .metric-v {
    color: var(--accent-bright);
    font-weight: 600;
  }

  .metric-v.good {
    color: #34d399;
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
    background: var(--bg-panel);
    border-left: 1px solid var(--border-subtle);
    min-height: 0;
    overflow: hidden;
  }

  .scene-sidebar {
    flex: 0 0 42%;
    min-height: 180px;
    max-height: 46%;
    overflow-y: auto;
    border-bottom: 1px solid var(--border-subtle);
    padding: 6px 8px;
  }

  .inspector-pane {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 10px 16px;
  }

  /* --- Sidebar Tree --- */
  .tree-section {
    margin-bottom: 8px;
  }

  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 4px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .tree-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tree-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 7px;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .tree-row:hover {
    background: rgba(30, 41, 59, 0.55);
  }

  .tree-row[data-selected='true'] {
    background: rgba(2, 132, 199, 0.2);
    border-color: rgba(56, 189, 248, 0.55);
    color: #ffffff;
  }

  .tree-row-main {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .tree-row-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-badge {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-muted);
    background: #090d16;
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* --- Inspector Forms --- */
  .insp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-bottom: 6px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .insp-title {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .insp-subtitle {
    font-size: 10.5px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .form-section {
    margin-bottom: 10px;
    padding: 7px 8px;
    background: #080d19;
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
  }

  .form-section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

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

  .field-label {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .xyz-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .xy-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }

  .mini-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mini-field span {
    font-size: 9.5px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .mini-field input,
  .mini-field select {
    width: 100%;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .check-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .eq-card {
    padding: 5px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--bg-panel);
    margin-bottom: 5px;
  }

  .eq-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 4px;
  }

  .cabinet-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
  }

  .cabinet-table th,
  .cabinet-table td {
    padding: 2px 4px;
    text-align: left;
    border-bottom: 1px solid #131c2e;
  }

  .cabinet-table th {
    color: var(--text-muted);
    font-weight: 600;
  }

  /* --- Saved Projects Popover / Modal --- */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(3, 6, 12, 0.76);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .modal-card {
    width: min(560px, 95vw);
    max-height: 86vh;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border-subtle);
    font-weight: 700;
    font-size: 13px;
  }

  .modal-body {
    padding: 12px 14px;
    overflow-y: auto;
  }

  .toast-banner {
    position: fixed;
    bottom: 14px;
    right: 356px;
    background: #0f172a;
    border: 1px solid var(--accent-bright);
    color: var(--text-primary);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11.5px;
    z-index: 90;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  `,
];

