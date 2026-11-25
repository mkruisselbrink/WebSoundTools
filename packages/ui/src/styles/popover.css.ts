// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';

/**
 * Anchored top-layer `[popover]` panels with CSS Anchor Positioning (`@supports (position-area: block-end)`),
 * JS fixed-viewport fallback on desktop, bottom-sheet presentation on narrow handheld viewports (`< 680 px`),
 * and iOS Safari zoom-safe (`16 px`) coarse-pointer form controls.
 */
export const fohPopoverCss = css`
  .foh-popover {
    background: var(--_foh-bg-header, #0f172a);
    color: var(--_foh-text-primary, #f8fafc);
    border: 1px solid var(--_foh-border-strong, #334155);
    border-radius: 7px;
    padding: 10px 12px;
    min-inline-size: 240px;
    max-inline-size: min(340px, 94vw);
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.72);
    font-size: 11.5px;
  }

  @media (min-width: 680px) {
    @supports (position-area: block-end) {
      .foh-popover {
        inset: auto;
        margin: 0;
        margin-block: 5px;
        position-area: block-end span-inline-end;
        position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
      }
    }

    @supports not (position-area: block-end) {
      .foh-popover {
        position: fixed;
        inset: auto;
        margin: 0;
      }
    }
  }

  /* Bottom-sheet popover presentation on narrow handheld viewports (< 680px) */
  @media (max-width: 679px) {
    .foh-popover {
      position: fixed;
      inset: auto max(8px, env(safe-area-inset-left, 0px))
        max(10px, env(safe-area-inset-bottom, 0px))
        max(8px, env(safe-area-inset-right, 0px));
      inline-size: auto;
      min-inline-size: 0;
      max-inline-size: none;
      max-block-size: min(78dvh, 520px);
      overflow-y: auto;
      margin: 0;
      padding: 14px;
      border-radius: 12px;
      font-size: 13px;
    }

    .foh-popover::backdrop {
      background: rgba(2, 6, 23, 0.58);
    }
  }

  .foh-popover-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--_foh-text-muted, #94a3b8);
    margin-bottom: 8px;
  }

  .foh-popover-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .foh-popover-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .foh-popover-row > label,
  .foh-popover-label {
    font-size: 10.5px;
    color: var(--_foh-text-secondary, #cbd5e1);
    font-weight: 500;
  }

  .foh-popover-row select,
  .foh-popover-row input[type='number'],
  .foh-popover-row input[type='text'] {
    inline-size: 100%;
    background-color: var(--_foh-bg-input, #090d16);
    color: var(--_foh-text-primary, #f8fafc);
    border: 1px solid var(--_foh-border-strong, #334155);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11.5px;
  }

  .foh-popover-row select {
    padding-inline-end: 26px;
  }

  .foh-popover-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--_foh-border-subtle, #1e293b);
  }

  @media (pointer: coarse) {
    .foh-popover-row select,
    .foh-popover-row input[type='number'],
    .foh-popover-row input[type='text'] {
      min-block-size: 38px;
      padding: 6px 10px;
    }
  }

  /* Prevent iOS/iPadOS Safari auto-zoom when focusing form controls on touch screens */
  @media (pointer: coarse) and (max-width: 1024px) {
    .foh-popover-row select,
    .foh-popover-row input[type='number'],
    .foh-popover-row input[type='text'] {
      font-size: 16px;
    }
  }
`;
