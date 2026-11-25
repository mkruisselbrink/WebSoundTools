// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css, unsafeCSS } from 'lit';

/**
 * URL-encoded `10x6` SVG chevron (`#cbd5e1` Slate-300, >11:1 contrast on Slate-950 inputs)
 * paired with `appearance: none` for consistent cross-browser `<select>` arrow spacing.
 */
export const FOH_SELECT_CHEVRON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1.5 1.25L5 4.75L8.5 1.25' stroke='%23cbd5e1' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

/**
 * Shared button, input, select, checkbox, swatch, badge, focus-ring, and SR-only styles.
 */
export const fohControlsCss = css`
  :where(button, select, input, textarea) {
    font: inherit;
  }

  :where(button, select, input, a, [tabindex]):focus-visible {
    outline: 2px solid var(--_foh-accent-bright, #38bdf8);
    outline-offset: 2px;
  }

  select,
  input[type='text'],
  input[type='number'] {
    background-color: var(--_foh-bg-input, #090d16);
    color: var(--_foh-text-primary, #f8fafc);
    border: 1px solid var(--_foh-border-strong, #334155);
    border-radius: var(--_foh-radius-sm, 4px);
    padding: 3px 6px;
    font-size: 11.5px;
  }

  input[type='number'] {
    font-family: var(--_foh-font-mono, monospace);
    font-variant-numeric: tabular-nums;
  }

  select {
    -webkit-appearance: none;
    appearance: none;
    background-image: url("${unsafeCSS(FOH_SELECT_CHEVRON_DATA_URI)}");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 10px 6px;
    padding-inline-start: 7px;
    padding-inline-end: 26px;
    cursor: pointer;
  }

  select option,
  select optgroup {
    background-color: var(--_foh-bg-header, #0f172a);
    color: var(--_foh-text-primary, #f8fafc);
  }

  .foh-sr-only:where(:not(:focus-within, :active)) {
    position: absolute !important;
    clip-path: inset(50%) !important;
    overflow: hidden !important;
    width: 1px !important;
    height: 1px !important;
    margin: -1px !important;
    padding: 0 !important;
    border: 0 !important;
    white-space: nowrap !important;
  }

  .foh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font: inherit;
    background: var(--_foh-bg-elevated, #162033);
    color: var(--_foh-text-secondary, #cbd5e1);
    border: 1px solid var(--_foh-border-strong, #334155);
    border-radius: var(--_foh-radius-sm, 4px);
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: no-preference) {
    .foh-btn {
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
  }

  @media (hover: hover) {
    .foh-btn:hover:not(:disabled) {
      background: #1e293b;
      border-color: var(--_foh-accent-bright, #38bdf8);
      color: #ffffff;
    }
  }

  .foh-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .foh-btn-primary {
    background: var(--_foh-accent, #0284c7);
    border-color: var(--_foh-accent-bright, #38bdf8);
    color: #ffffff;
  }

  @media (hover: hover) {
    .foh-btn-primary:hover:not(:disabled) {
      background: var(--_foh-accent-hover, #0369a1);
    }
  }

  .foh-btn-accent {
    background: #059669;
    border-color: var(--_foh-success, #10b981);
    color: #ffffff;
  }

  @media (hover: hover) {
    .foh-btn-accent:hover:not(:disabled) {
      background: #047857;
    }
  }

  .foh-btn-danger {
    background: rgba(239, 68, 68, 0.14);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fca5a5;
  }

  @media (hover: hover) {
    .foh-btn-danger:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.28);
      color: #ffffff;
    }
  }

  .foh-btn-xs {
    padding: 1px 6px;
    font-size: 10.5px;
  }

  .foh-btn-link {
    text-decoration: none;
  }

  .foh-btn-active {
    background: #dc2626;
    border-color: #f87171;
    color: #ffffff;
  }

  .foh-btn:is([aria-pressed='true'], [data-active='true']) {
    background: var(--_foh-accent, #0284c7);
    border-color: var(--_foh-accent-bright, #38bdf8);
    color: #ffffff;
  }

  @media (pointer: coarse) {
    .foh-btn,
    .foh-btn-xs,
    select {
      min-block-size: 32px;
      min-inline-size: 32px;
    }
  }

  .foh-badge {
    font-family: var(--_foh-font-mono, monospace);
    font-size: 9.5px;
    color: var(--_foh-text-muted, #94a3b8);
    background: var(--_foh-bg-input, #090d16);
    border: 1px solid var(--_foh-border-subtle, #1e293b);
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
    color: var(--_foh-text-secondary, #cbd5e1);
    cursor: pointer;
  }

  @supports not (accent-color: #38bdf8) {
    input[type='range'] {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
    }

    input[type='range']::-webkit-slider-runnable-track {
      height: 6px;
      background: var(--_foh-border-strong, #334155);
      border-radius: 3px;
    }

    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--_foh-accent-bright, #38bdf8);
      margin-top: -4px;
      cursor: pointer;
    }

    input[type='range']::-moz-range-track {
      height: 6px;
      background: var(--_foh-border-strong, #334155);
      border-radius: 3px;
    }

    input[type='range']::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--_foh-accent-bright, #38bdf8);
      border: 0;
      cursor: pointer;
    }
  }
`;
