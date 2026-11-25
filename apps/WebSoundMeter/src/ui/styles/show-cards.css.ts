// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { css } from 'lit';

/**
 * Shared styles for Show microphone rows, Feedback Ring Log cards, culprit badges,
 * and simulator info banners composed across `<wsm-tuning-sidebar>`, `<wsm-show-sidebar>`,
 * and `<wsm-mobile-show-deck>`.
 */
export const wsmShowAndRingLogCss = css`
  .source-row-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .source-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .source-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .sim-banner {
    font-size: 10.5px;
    color: #94a3b8;
    line-height: 1.35;
    margin-top: 2px;
    padding: 4px 7px;
    background: #090d16;
    border-radius: 4px;
    border-left: 2px solid #38bdf8;
  }

  .label-muted {
    color: #94a3b8;
    font-size: 10px;
    text-transform: uppercase;
  }

  .show-mic-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .show-mic-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px 8px;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
  }

  .show-mic-row.selected {
    border-color: #38bdf8;
    background: #172554;
  }

  .show-mic-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .show-mic-spl-badge {
    font-family: var(--_foh-font-mono, monospace);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    color: #38bdf8;
    font-weight: 600;
  }

  .show-mic-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
  }

  .show-gain-cal-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    justify-content: flex-end;
    min-width: 0;
  }

  .show-mini-num {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: #94a3b8;
  }

  .show-mini-num input[type='number'] {
    width: 52px;
    padding: 2px 4px;
    font-size: 11px;
  }

  .show-cal-btn,
  .btn-notch-eq {
    border-color: #38bdf8;
    color: #38bdf8;
    flex-shrink: 0;
  }

  .empty-ring-log {
    font-size: 11px;
    color: #64748b;
    padding: 8px 4px;
    text-align: center;
  }

  .ring-log-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 280px;
    overflow-y: auto;
  }

  .ring-log-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 5px;
    font-size: 11px;
  }

  .ring-log-main {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .ring-severity-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .ring-severity-badge.crit {
    background: rgba(239, 68, 68, 0.25);
    color: #f87171;
    border: 1px solid #ef4444;
  }

  .ring-severity-badge.warn {
    background: rgba(245, 158, 11, 0.22);
    color: #fbbf24;
    border: 1px solid #f59e0b;
  }

  .ring-severity-badge.hold {
    background: rgba(148, 163, 184, 0.16);
    color: #94a3b8;
    border: 1px solid #475569;
  }

  .ring-freq-title {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f8fafc;
  }

  .ring-iso-tag {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    background: #1e293b;
    color: #38bdf8;
    font-family: var(--_foh-font-mono, monospace);
  }

  .ring-loop-tag {
    font-size: 9.5px;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(56, 189, 248, 0.14);
    color: #7dd3fc;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }

  .ring-culprit-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin: 2px 0;
  }

  .ring-culprit-pill {
    font-size: 10.5px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.18);
    border: 1px solid rgba(52, 211, 153, 0.45);
    color: #6ee7b7;
  }

  .ring-runner-up {
    font-size: 9.5px;
    color: #94a3b8;
  }

  .ring-meta-line {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    color: #94a3b8;
    font-size: 10px;
  }

  @media (pointer: coarse) {
    .show-mic-row {
      padding: 9px 10px;
      gap: 8px;
    }

    .show-mic-row input[type='checkbox'] {
      inline-size: 20px;
      block-size: 20px;
    }

    .show-mini-num input[type='number'] {
      width: 68px;
    }

    .show-cal-btn,
    .btn-notch-eq {
      min-block-size: 38px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
    }
  }
`;
