// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';
import { fohPopoverCss } from './popover.css.js';

/**
 * Unified single-row (`40 px`) FOH Studio Header, PWA Window Controls Overlay (`env(titlebar-area-*)`)
 * safe-area & drag-region rules, `@container topbar` progressive compaction tiers, segmented pill groups,
 * split-action pills, recessed zero-jitter `.foh-lcd` telemetry bezel, and anchored `[popover]` panels.
 */
export const fohTopbarCss = css`
  .foh-topbar {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    inline-size: 100%;
    min-inline-size: 0;
    padding-block-start: env(safe-area-inset-top, 0px);
    min-block-size: calc(40px + env(safe-area-inset-top, 0px));
    block-size: calc(40px + env(safe-area-inset-top, 0px));
    padding-inline-start: calc(env(safe-area-inset-left, 0px) + 10px);
    padding-inline-end: calc(env(safe-area-inset-right, 0px) + 10px);
    background: var(--_foh-bg-panel, #0b1120);
    border-bottom: 1px solid var(--_foh-border-subtle, #1e293b);
    overflow: hidden;
    flex-shrink: 0;
    z-index: 20;
    user-select: none;
  }

  /* Match OS titlebar height (>= 40px so 26px pills stay vertically centered with macOS traffic lights)
     & horizontal caption insets strictly when WCO is active (avoiding env(titlebar-area-width) === 0px
     collapse when WCO is toggled off in an installed PWA). */
  .foh-topbar[data-wco-visible='true'] {
    padding-block-start: max(var(--foh-wco-top, 0px), env(titlebar-area-y, 0px));
    min-block-size: max(
      40px,
      calc(
        max(var(--foh-wco-height, 0px), env(titlebar-area-height, 0px)) +
          max(var(--foh-wco-top, 0px), env(titlebar-area-y, 0px))
      )
    );
    block-size: max(
      40px,
      calc(
        max(var(--foh-wco-height, 0px), env(titlebar-area-height, 0px)) +
          max(var(--foh-wco-top, 0px), env(titlebar-area-y, 0px))
      )
    );
    padding-inline-start: calc(
      max(var(--foh-wco-left, 0px), env(titlebar-area-x, 0px)) + 8px
    );
    padding-inline-end: calc(
      max(
          var(--foh-wco-right, 0px),
          100% - env(titlebar-area-width, 100%) - env(titlebar-area-x, 0px)
        ) + 8px
    );
  }

  @media (display-mode: window-controls-overlay) {
    .foh-topbar:not([data-wco-visible='false']) {
      padding-block-start: max(var(--foh-wco-top, 0px), env(titlebar-area-y, 0px));
      min-block-size: max(
        40px,
        calc(
          max(var(--foh-wco-height, 0px), env(titlebar-area-height, 0px)) +
            max(var(--foh-wco-top, 0px), env(titlebar-area-y, 0px))
        )
      );
      block-size: max(
        40px,
        calc(
          max(var(--foh-wco-height, 0px), env(titlebar-area-height, 0px)) +
            max(var(--foh-wco-top, 0px), env(titlebar-area-y, 0px))
        )
      );
      padding-inline-start: calc(
        max(var(--foh-wco-left, 0px), env(titlebar-area-x, 0px)) + 8px
      );
      padding-inline-end: calc(
        max(
            var(--foh-wco-right, 0px),
            100% - env(titlebar-area-width, 100%) - env(titlebar-area-x, 0px)
          ) + 8px
      );
    }
  }

  /* Enable native OS window dragging across empty titlebar regions when WCO is active,
     disabling drag while any top-layer popover is open so outside clicks light-dismiss cleanly. */
  .foh-topbar[data-wco-visible='true']:not(:has([popover]:popover-open)) {
    -webkit-app-region: drag;
    app-region: drag;
  }

  @media (display-mode: window-controls-overlay) {
    .foh-topbar:not(:has([popover]:popover-open)) {
      -webkit-app-region: drag;
      app-region: drag;
    }
  }

  .foh-topbar :is(button, select, input, a, label, [popover], .foh-no-drag) {
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  /* Inner size container measures true remaining width AFTER subtracting macOS/Windows WCO insets */
  .foh-topbar-track {
    container: topbar / inline-size;
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    flex: 1 1 0%;
    inline-size: 100%;
    block-size: 100%;
    gap: 4px;
    min-inline-size: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .foh-topbar-track::-webkit-scrollbar {
    display: none;
  }

  .foh-topbar-zone {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .foh-topbar-spacer {
    flex: 1 1 12px;
    min-inline-size: 12px;
    block-size: 100%;
  }

  /* Border-drawn separator (forced-colors safe) */
  .foh-tb-sep {
    inline-size: 0;
    block-size: 16px;
    border-inline-start: 1px solid var(--_foh-border-subtle, #1e293b);
    margin-inline: 1px;
    flex-shrink: 0;
  }

  /* Window-aware app branding: rounded-square mark in Browser, no extra dot/icon in WCO,
     full wordmark when >= 1080px and cleanly hidden (never abbreviated) when narrower. */
  .foh-brand {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--_foh-text-primary, #f8fafc);
    padding-inline-end: 2px;
    flex-shrink: 0;
  }

  .foh-brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .foh-topbar[data-wco-visible='true'] .foh-brand-mark {
    display: none;
  }

  @media (display-mode: window-controls-overlay) {
    .foh-brand-mark {
      display: none;
    }
  }

  /* Segmented button group (styled strictly from [aria-pressed="true"]) */
  .foh-segmented {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--_foh-bg-card, #080d19);
    border: 1px solid var(--_foh-border-card, #263554);
    border-radius: 5px;
    min-block-size: 26px;
    flex-shrink: 0;
  }

  .foh-seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    color: var(--_foh-text-muted, #94a3b8);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3.5px;
    padding: 2px 8px;
    min-block-size: 22px;
    min-inline-size: 24px;
    cursor: pointer;
    white-space: nowrap;
  }

  @media (hover: hover) {
    .foh-seg-btn:hover:not(:disabled):not([aria-pressed='true']) {
      color: var(--_foh-text-primary, #f8fafc);
      background: rgba(30, 41, 59, 0.55);
    }
  }

  .foh-seg-btn[aria-pressed='true'] {
    background: var(--_foh-accent, #0284c7);
    border-color: rgba(56, 189, 248, 0.5);
    color: #ffffff;
  }

  .foh-seg-btn[data-variant='show'][aria-pressed='true'] {
    background: #059669;
    border-color: rgba(16, 185, 129, 0.55);
    color: #ffffff;
  }

  .foh-seg-btn:is(:disabled, [aria-disabled='true']) {
    opacity: 0.38;
    cursor: not-allowed;
  }

  /* Trigger pills & icon buttons */
  .foh-tb-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    color: var(--_foh-text-secondary, #cbd5e1);
    background: var(--_foh-bg-elevated, #162033);
    border: 1px solid var(--_foh-border-card, #263554);
    border-radius: 5px;
    padding: 0 8px;
    block-size: 26px;
    min-block-size: 26px;
    min-inline-size: 26px;
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
    flex-shrink: 0;
  }

  .foh-tb-icon-btn {
    position: relative;
    padding: 0 6px;
  }

  .foh-update-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--_foh-accent-bright, #38bdf8);
    box-shadow: 0 0 0 1.5px var(--_foh-bg-elevated, #162033);
    pointer-events: none;
  }

  @media (hover: hover) {
    .foh-tb-pill:hover:not(:disabled) {
      border-color: var(--_foh-accent-bright, #38bdf8);
      color: #ffffff;
    }
  }

  .foh-tb-pill:is([aria-pressed='true'], [aria-expanded='true']) {
    background: #172554;
    border-color: var(--_foh-accent-bright, #38bdf8);
    color: #ffffff;
  }

  .foh-tb-pill.foh-tb-primary {
    background: var(--_foh-accent, #0284c7);
    border-color: var(--_foh-accent-bright, #38bdf8);
    color: #ffffff;
    font-weight: 600;
  }

  @media (hover: hover) {
    .foh-tb-pill.foh-tb-primary:hover:not(:disabled) {
      background: var(--_foh-accent-hover, #0369a1);
    }
  }

  .foh-tb-pill.foh-tb-paused {
    background: #b91c1c;
    border-color: #f87171;
    color: #ffffff;
  }

  .foh-pill-k {
    color: var(--_foh-text-muted, #94a3b8);
    font-size: 10.5px;
    font-weight: 500;
  }

  .foh-pill-val {
    color: var(--_foh-text-primary, #f8fafc);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .foh-dirty-dot {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--_foh-accent-bright, #38bdf8);
    flex-shrink: 0;
  }

  /* Split-action pill (e.g. [Gen ON | Pink -12dB ▾] or [Bounce | Heatmap ▾]) */
  .foh-split-pill {
    display: inline-flex;
    align-items: stretch;
    block-size: 26px;
    min-block-size: 26px;
    border-radius: 5px;
    border: 1px solid var(--_foh-border-card, #263554);
    background: var(--_foh-bg-elevated, #162033);
    overflow: hidden;
    flex-shrink: 0;
  }

  .foh-split-pill > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    color: var(--_foh-text-secondary, #cbd5e1);
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0 8px;
    min-inline-size: 24px;
    cursor: pointer;
    white-space: nowrap;
  }

  .foh-split-pill > button + button {
    border-inline-start: 1px solid var(--_foh-border-card, #263554);
  }

  @media (hover: hover) {
    .foh-split-pill > button:hover:not(:disabled) {
      background: rgba(56, 189, 248, 0.14);
      color: #ffffff;
    }
  }

  .foh-split-pill > button:disabled {
    opacity: 0.36;
    cursor: not-allowed;
  }

  .foh-split-pill > button[aria-pressed='true'] {
    background: var(--_foh-accent, #0284c7);
    color: #ffffff;
    font-weight: 600;
  }

  .foh-split-pill > button.foh-tb-paused[aria-pressed='true'] {
    background: #b91c1c;
    color: #ffffff;
  }

  .foh-split-pill > button.foh-tb-standby[aria-pressed='true'] {
    background: #b45309;
    color: #ffffff;
  }

  .foh-split-pill > button[data-variant='gen'][aria-pressed='true'] {
    background: #059669;
    color: #ffffff;
    font-weight: 600;
  }

  .foh-split-pill > button[aria-expanded='true'] {
    background: #172554;
    color: #ffffff;
  }

  /* Compact inline select styled identically to .foh-tb-pill */
  .foh-tb-select {
    block-size: 26px;
    min-block-size: 26px;
    background-color: var(--_foh-bg-elevated, #162033);
    color: var(--_foh-text-primary, #f8fafc);
    border: 1px solid var(--_foh-border-card, #263554);
    border-radius: 5px;
    padding: 0 24px 0 8px;
    font-size: 11px;
    font-weight: 600;
    background-position: right 7px center;
  }

  /* Recessed Zero-Jitter FOH LCD Readout */
  .foh-lcd {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    block-size: 26px;
    min-block-size: 26px;
    padding: 0 8px;
    background: #050811;
    border: 1px solid var(--_foh-border-subtle, #1e293b);
    border-radius: 5px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7);
    font-family: var(--_foh-font-mono, monospace);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .foh-lcd:is([data-alert='warn'], .alert-warn) {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.11);
  }

  .foh-lcd:is([data-alert='limit'], .alert-limit) {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .foh-lcd-trigger {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--_foh-font-sans, sans-serif);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--_foh-text-secondary, #cbd5e1);
    background: #11192c;
    border: 1px solid var(--_foh-border-subtle, #1e293b);
    border-radius: 3.5px;
    padding: 1px 5px;
    min-block-size: 20px;
    min-inline-size: 54px;
    justify-content: space-between;
    cursor: pointer;
  }

  @media (hover: hover) {
    .foh-lcd-trigger:hover {
      border-color: var(--_foh-accent-bright, #38bdf8);
      color: #ffffff;
    }
  }

  .foh-lcd-primary {
    display: inline-block;
    inline-size: 9.2ch;
    text-align: right;
    font-size: 13px;
    font-weight: 700;
    color: var(--_foh-accent-bright, #38bdf8);
  }

  .foh-lcd-sep {
    inline-size: 0;
    block-size: 13px;
    border-inline-start: 1px solid var(--_foh-border-subtle, #1e293b);
  }

  .foh-lcd-kv {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }

  .foh-lcd-k {
    font-family: var(--_foh-font-sans, sans-serif);
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--_foh-text-muted, #94a3b8);
  }

  .foh-lcd-v {
    display: inline-block;
    text-align: right;
    font-weight: 600;
    color: var(--_foh-text-primary, #f8fafc);
  }

  .foh-lcd-v.good {
    color: #34d399;
  }

  /* Fixed-width compliance status badge so OK -> WARN -> LIMIT never shifts layout */
  .foh-lcd-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 58px;
    padding: 1px 4px;
    border-radius: 3.5px;
    font-family: var(--_foh-font-sans, sans-serif);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .foh-lcd-badge.ok {
    background: rgba(16, 185, 129, 0.16);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.4);
  }

  .foh-lcd-badge.warn {
    background: rgba(245, 158, 11, 0.22);
    color: #fbbf24;
    border: 1px solid #f59e0b;
  }

  .foh-lcd-badge.limit {
    background: rgba(239, 68, 68, 0.26);
    color: #f87171;
    border: 1px solid #ef4444;
  }

  ${fohPopoverCss}

  /* Coarse touch pointer sizing (Tablet & Phone) — generous vertical height with compact inline padding */
  @media (pointer: coarse) {
    .foh-topbar {
      min-block-size: max(
        calc(46px + env(safe-area-inset-top, 0px)),
        env(titlebar-area-height, 0px)
      );
      block-size: max(
        calc(46px + env(safe-area-inset-top, 0px)),
        env(titlebar-area-height, 0px)
      );
    }

    .foh-tb-pill,
    .foh-split-pill,
    .foh-tb-select,
    .foh-segmented,
    .foh-lcd {
      min-block-size: 36px;
      block-size: 36px;
    }

    .foh-seg-btn {
      min-block-size: 30px;
      min-inline-size: 28px;
      padding: 2px 8px;
      font-size: 11.5px;
    }

    .foh-split-pill > button {
      min-inline-size: 28px;
      padding: 0 8px;
      font-size: 11.5px;
    }

    .foh-lcd-trigger {
      min-block-size: 28px;
      padding: 2px 6px;
      font-size: 11px;
    }
  }

  /* @container topbar Progressive Compaction Tiers (measured on .foh-topbar-track AFTER WCO insets)
   * >= 1580px: Full Widescreen Studio Bar (all secondary KPIs + generator waveform/level summary)
   * 1380-1579px: 1440px Desktop Browser — keeps LAeq1m, LAeq15m, LC-LA, 1x/2x/3x & ? fully visible
   * 1220-1379px: 13"/14" MacBook WCO Titlebars (~1240-1320px track) — keeps brand, LAeq15m/Mean, 1x/2x/3x & ? with drag space
   * 1020-1219px: Compact Laptop / Tablet Landscape — hides wordmark & Undo/Redo buttons (Cmd+Z active)
   * 780-1019px: Narrow WCO / Tablet Split — iconifies secondary triggers
   * < 780px: Half-Screen WCO / Tablet Portrait — collapses 1x/2x/3x into [▾] preset menu
   */
  @container topbar (max-width: 1579px) {
    .foh-hide-below-xlarge {
      display: none !important;
    }
  }

  @container topbar (max-width: 1379px) {
    .foh-topbar-zone {
      gap: 5px;
    }
    .foh-topbar-spacer {
      flex: 1 1 8px;
      min-inline-size: 8px;
    }
    .foh-hide-below-full {
      display: none !important;
    }
  }

  @container topbar (max-width: 1219px) {
    .foh-brand-name {
      display: none;
    }
    .foh-hide-below-wide {
      display: none !important;
    }
  }

  @container topbar (max-width: 1019px) {
    .foh-brand {
      display: none;
    }
    .foh-hide-below-medium {
      display: none !important;
    }
    .foh-topbar-zone {
      gap: 4px;
    }
    .foh-topbar-spacer {
      flex: 1 1 4px;
      min-inline-size: 4px;
    }
    .foh-seg-btn {
      padding: 2px 6px;
      min-inline-size: 26px;
    }
    .foh-tb-pill {
      padding: 0 6px;
    }
    .foh-lcd {
      gap: 5px;
      padding: 0 6px;
    }
  }

  @container topbar (max-width: 779px) {
    .foh-seg-btn {
      padding: 2px 5px;
      min-inline-size: 24px;
    }
    .foh-lcd-primary {
      inline-size: 8.4ch;
      font-size: 12px;
    }
    .foh-lcd-badge {
      inline-size: 48px;
      font-size: 9px;
      padding: 1px 2px;
    }
  }

  @container topbar (max-width: 639px) {
    .foh-hide-below-narrow {
      display: none !important;
    }
  }

  @container topbar (max-width: 479px) {
    .foh-popover-row select {
      padding-inline-end: 28px;
    }
  }
`;
