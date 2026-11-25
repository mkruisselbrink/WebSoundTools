// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { FOH_SELECT_CHEVRON_DATA_URI } from '@foh/ui';
import { css, unsafeCSS } from 'lit';

/**
 * Shared Shadow DOM stylesheet for `FohChartPanelBase` subclasses (`<foh-chart-panel>`,
 * `<chart-panel>`, `<wss-chart-panel>`), locking `.chart-header` to a single `32 px` row
 * (`38 px` on coarse touch pointers) and layering the WebGL2 and 2D overlay canvases.
 */
export const fohChartPanelStyles = css`
  :host {
    color-scheme: dark;
    accent-color: var(--foh-accent-bright, #38bdf8);
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 150px;
    background: var(--foh-bg-canvas, #090d16);
    border: 1px solid var(--foh-border, #1e293b);
    border-radius: 6px;
    overflow: hidden;
    position: relative;
    flex: 1 1 0;
  }

  :where(button, select, input, [tabindex]):focus-visible {
    outline: 2px solid var(--foh-accent-bright, #38bdf8);
    outline-offset: 2px;
  }

  .chart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 32px;
    min-height: 32px;
    padding: 0 10px;
    background: var(--foh-bg-elevated, #0f172a);
    border-bottom: 1px solid var(--foh-border, #1e293b);
    font-size: 11.5px;
    color: var(--foh-text-primary, #e2e8f0);
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .chart-header::-webkit-scrollbar {
    display: none;
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: none;
    font-family: var(--foh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 10.5px;
    color: var(--foh-text-secondary, #cbd5e1);
  }

  .header-center::-webkit-scrollbar {
    display: none;
  }

  select,
  button {
    font: inherit;
    background-color: var(--foh-bg-surface, #162033);
    color: var(--foh-text-primary, #f8fafc);
    border: 1px solid var(--foh-border-strong, #334155);
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
  }

  select {
    -webkit-appearance: none;
    appearance: none;
    background-image: url("${unsafeCSS(FOH_SELECT_CHEVRON_DATA_URI)}");
    background-repeat: no-repeat;
    background-position: right 7px center;
    background-size: 10px 6px;
    padding-inline-end: 24px;
  }

  select option,
  select optgroup {
    background-color: var(--foh-bg-elevated, #0f172a);
    color: var(--foh-text-primary, #f8fafc);
  }

  @media (hover: hover) {
    select:hover,
    button:hover {
      border-color: var(--foh-accent, #38bdf8);
    }
  }

  @media (pointer: coarse) {
    .chart-header {
      height: 38px;
      min-height: 38px;
    }

    select,
    button {
      min-block-size: 30px;
      min-inline-size: 30px;
      padding: 3px 9px;
      font-size: 12px;
    }

    select {
      padding-inline-end: 26px;
    }
  }

  .tab-btn {
    position: relative;
    font-weight: 500;
  }

  .tab-btn:is([aria-selected='true'], [data-active='true']) {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
  }

  .tab-btn:is([aria-selected='true'], [data-active='true'])::after {
    content: '';
    position: absolute;
    inset: auto 2px 0;
    border-block-end: 2px solid #e0f2fe;
  }

  .label-muted {
    color: var(--foh-text-muted, #94a3b8);
    font-size: 11px;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .dot,
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .stage {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 120px;
    background: var(--foh-bg-canvas, #090d16);
    user-select: none;
    touch-action: none;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .overlay-canvas {
    z-index: 2;
  }
`;
