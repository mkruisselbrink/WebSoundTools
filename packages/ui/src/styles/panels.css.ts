// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';

/**
 * Shared inspector cards, 2/3-column coordinate grids, entity tree rows, and EQ band card styles.
 */
export const fohPanelsCss = css`
  .foh-form-section {
    margin-bottom: 8px;
    padding: 7px 8px;
    background: var(--_foh-bg-card, #080d19);
    border: 1px solid var(--_foh-border-subtle, #1e293b);
    border-radius: 5px;
  }

  .foh-form-section:last-child {
    margin-bottom: 0;
  }

  .foh-form-section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--_foh-text-muted, #94a3b8);
    margin-bottom: 6px;
  }

  .foh-xy-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px 6px;
  }

  .foh-xyz-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .foh-mini-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .foh-mini-field > span,
  .foh-mini-field > label {
    font-size: 9.5px;
    color: var(--_foh-text-muted, #94a3b8);
    font-family: var(--_foh-font-mono, monospace);
  }

  .foh-mini-field input,
  .foh-mini-field select {
    width: 100%;
    font: inherit;
    background: var(--_foh-bg-input, #090d16);
    color: var(--_foh-text-primary, #f8fafc);
    border: 1px solid var(--_foh-border-strong, #334155);
    border-radius: var(--_foh-radius-sm, 4px);
    padding: 3px 6px;
    font-size: 11px;
  }

  .foh-mini-field input[type='number'] {
    font-family: var(--_foh-font-mono, monospace);
  }

  .foh-eq-card {
    padding: 5px 6px;
    border: 1px solid var(--_foh-border-subtle, #1e293b);
    border-radius: var(--_foh-radius-sm, 4px);
    background: var(--_foh-bg-panel, #0b1120);
    margin-bottom: 5px;
  }

  .foh-eq-card:last-child {
    margin-bottom: 0;
  }

  .foh-eq-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    margin-bottom: 4px;
  }

  .foh-eq-card-top select {
    flex: 1;
    min-width: 0;
    font: inherit;
    background: var(--_foh-bg-input, #090d16);
    color: var(--_foh-text-primary, #f8fafc);
    border: 1px solid var(--_foh-border-strong, #334155);
    border-radius: var(--_foh-radius-sm, 4px);
    padding: 2px 5px;
    font-size: 11px;
  }

  .foh-eq-tip {
    font-size: 10px;
    color: var(--_foh-text-muted, #94a3b8);
    margin-bottom: 6px;
  }

  /* Entity / Source Tree */
  .foh-tree-section {
    margin-bottom: 8px;
  }

  .foh-tree-section:last-child {
    margin-bottom: 0;
  }

  .foh-tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 2px 5px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--_foh-text-muted, #94a3b8);
  }

  .foh-tree-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .foh-tree-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .foh-tree-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 7px;
    border-radius: var(--_foh-radius-sm, 4px);
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid var(--_foh-border-subtle, #1e293b);
    cursor: pointer;
    font-size: 11.5px;
    color: var(--_foh-text-secondary, #cbd5e1);
  }

  @media (hover: hover) {
    .foh-tree-row:hover {
      background: rgba(30, 41, 59, 0.7);
    }
  }

  .foh-tree-row[data-selected='true'] {
    background: rgba(2, 132, 199, 0.22);
    border-color: rgba(56, 189, 248, 0.65);
    color: #ffffff;
  }

  .foh-tree-row-select {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    background: transparent;
    border: 0;
    padding: 1px 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .foh-tree-row-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    flex: 1;
    min-width: 0;
  }
`;
