// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { fohControlsCss, fohPanelsCss, fohTokensCss, fohTopbarCss } from '@foh/ui';
import { css } from 'lit';

export const appShellStyles = [
  fohTokensCss,
  fohControlsCss,
  fohPanelsCss,
  fohTopbarCss,
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

  /* Fixed-geometry WSM Topbar Pills */
  .wsm-pause-pill {
    inline-size: 66px;
  }

  .wsm-io-pill {
    max-inline-size: 196px;
  }

  .wsm-gen-toggle-btn {
    inline-size: 68px;
  }

  .spl-show-inline {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  @container topbar (max-width: 1079px) {
    .wsm-io-pill {
      max-inline-size: 144px;
    }
  }

  @container topbar (max-width: 819px) {
    .wsm-pause-pill {
      inline-size: 28px;
    }
    .wsm-io-pill {
      max-inline-size: 112px;
    }
  }

  @container topbar (max-width: 479px) {
    .wsm-io-pill {
      max-inline-size: 104px;
    }
  }

  .delay-readout {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: 174px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .delay-value {
    display: inline-block;
    width: 68px;
    text-align: right;
    color: #e2e8f0;
  }

  .pol-badge {
    display: inline-block;
    width: 38px;
    text-align: center;
    color: #f43f5e;
    font-weight: 700;
  }

  .pol-badge.hidden {
    visibility: hidden;
  }

  select,
  input[type='number'],
  input[type='text'],
  button {
    font: inherit;
    background-color: #0f172a;
    color: #f8fafc;
    border: 1px solid #334155;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
  }

  select {
    padding-inline-end: 26px;
  }

  button {
    cursor: pointer;
    font-weight: 500;
    transition: background 0.12s, border-color 0.12s;
  }

  button:hover,
  select:hover {
    border-color: #38bdf8;
  }

  button.btn-primary {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
  }

  button.btn-primary:hover {
    background: #0369a1;
  }

  button.btn-accent {
    background: #059669;
    border-color: #10b981;
    color: #ffffff;
  }

  button.btn-accent:hover {
    background: #047857;
  }

  button.btn-active {
    background: #dc2626;
    border-color: #f87171;
    color: #ffffff;
  }

  /* SPL Meter Pill */
  .spl-readout {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .spl-main-value {
    font-size: 16px;
    font-weight: 700;
    color: #38bdf8;
    width: 102px;
    text-align: right;
    white-space: nowrap;
  }

  .spl-sub-value {
    font-size: 11px;
    color: #cbd5e1;
    width: 84px;
    white-space: nowrap;
  }

  .spl-sub-row {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }

  /* Main Workspace */
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

  /* Right Sidebar */
  .sidebar {
    width: 340px;
    background: #0f172a;
    border-left: 1px solid #1e293b;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 10px;
    gap: 12px;
  }

  @media (max-width: 980px) {
    .sidebar {
      width: 280px;
    }
  }

  .section-card {
    background: #162033;
    border: 1px solid #263554;
    border-radius: 6px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 700;
    color: #e2e8f0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .source-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 5px;
    background: #0f172a;
    border: 1px solid #1e293b;
    cursor: pointer;
    font-size: 12px;
  }

  .source-row.selected {
    border-color: #38bdf8;
    background: #172554;
  }

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

  .source-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #1e293b;
    color: #94a3b8;
    text-transform: uppercase;
  }

  .prop-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px 8px;
    font-size: 11px;
  }

  .prop-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .prop-field select,
  .prop-field input[type='number'],
  .prop-field input[type='text'] {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .prop-field.full-width {
    grid-column: 1 / -1;
  }

  .prop-field :is(label, .prop-label) {
    color: #94a3b8;
    font-size: 10px;
  }

  .dbfs-meter-strip {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .dbfs-meter-row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 58px 34px;
    align-items: center;
    gap: 6px;
  }

  .dbfs-meter-label {
    color: #94a3b8;
    font-weight: 600;
  }

  .dbfs-meter-track {
    position: relative;
    height: 6px;
    background: #1e293b;
    border-radius: 3px;
    overflow: hidden;
  }

  .dbfs-meter-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.08s linear;
  }

  .dbfs-meter-peak {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #f8fafc;
    opacity: 0.85;
  }

  .dbfs-meter-val {
    text-align: right;
    color: #cbd5e1;
  }

  .dbfs-clip-badge {
    text-align: center;
    padding: 0 3px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
    background: #1e293b;
    color: #475569;
  }

  .dbfs-clip-badge.clip {
    background: rgba(239, 68, 68, 0.25);
    border: 1px solid #ef4444;
    color: #f87171;
  }

  .union-source-checklist {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 160px;
    overflow-y: auto;
    padding: 4px 6px;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 4px;
  }

  .union-check-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #e2e8f0;
    cursor: pointer;
    min-width: 0;
  }

  .eq-band-row {
    display: grid;
    grid-template-columns: auto 1fr 62px 54px 48px;
    gap: 4px;
    align-items: center;
    font-size: 11px;
    background: #0f172a;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .eq-band-row input,
  .eq-band-row select {
    padding: 2px 4px;
    font-size: 11px;
    width: 100%;
  }

  .eq-band-row select {
    padding-inline-start: 6px;
    padding-inline-end: 22px;
    background-position: right 6px center;
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

  /* Workspace Mode Segmented Toggle */
  .mode-toggle-group {
    padding: 2px;
    gap: 2px;
  }

  .mode-toggle-group button {
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }

  .mode-toggle-group button.active {
    background: #0284c7;
    color: #ffffff;
  }

  .mode-toggle-group button.show-active {
    background: #059669;
    color: #ffffff;
  }

  /* Show Mode Top Bar SPL Metrics & Alert Badges */
  .spl-readout.alert-warn {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
  }

  .spl-readout.alert-limit {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.16);
  }

  .spl-show-metrics {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .spl-metric-chip {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    padding: 1px 4px;
    border-left: 1px solid #334155;
  }

  .spl-metric-chip span {
    font-size: 9px;
    color: #94a3b8;
    text-transform: uppercase;
  }

  .spl-metric-chip strong {
    color: #f8fafc;
    font-size: 11px;
  }

  .spl-alert-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .spl-alert-badge.ok {
    background: rgba(16, 185, 129, 0.16);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.4);
  }

  .spl-alert-badge.warn {
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
    border: 1px solid #f59e0b;
  }

  .spl-alert-badge.limit {
    background: rgba(239, 68, 68, 0.25);
    color: #f87171;
    border: 1px solid #ef4444;
  }

  /* Show Sidebar */
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
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .show-cal-btn {
    padding: 2px 6px;
    font-size: 10.5px;
    border-color: #38bdf8;
    color: #38bdf8;
    background: #0f172a;
    flex-shrink: 0;
  }

  .show-cal-btn:hover {
    background: #0284c7;
    color: #ffffff;
  }

  .label-muted {
    color: #94a3b8;
    font-size: 10px;
    text-transform: uppercase;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .ring-meta-line {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    color: #94a3b8;
    font-size: 10px;
  }

  .btn-notch-eq {
    background: #1e293b;
    border-color: #38bdf8;
    color: #38bdf8;
    font-size: 11px;
    padding: 3px 7px;
    flex-shrink: 0;
  }

  .btn-notch-eq:hover {
    background: #0284c7;
    color: #ffffff;
  }

  .btn-primary-action {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
  }

  /* Coarse Touch Pointer Ergonomics (Tablet & Phone) */
  @media (pointer: coarse) {
    .wsm-pause-pill {
      inline-size: 74px;
    }

    @container topbar (max-width: 819px) {
      .wsm-pause-pill {
        inline-size: 36px;
      }
    }

    .sidebar :is(button, select, input[type='number'], input[type='text']),
    .mobile-show-shell :is(button, select, input[type='number'], input[type='text']) {
      min-block-size: 38px;
      padding: 6px 10px;
    }

    .sidebar select,
    .mobile-show-shell select {
      padding-inline-end: 28px;
    }

    .show-mic-row {
      padding: 9px 10px;
      gap: 8px;
    }

    .show-mic-row input[type='checkbox'],
    .source-row input[type='checkbox'] {
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

  @media (pointer: coarse) and (max-width: 1024px) {
    .sidebar :is(select, input[type='number'], input[type='text']),
    .mobile-show-shell :is(select, input[type='number'], input[type='text']) {
      font-size: 16px;
    }
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

    .workspace[data-mode='show'] > .show-sidebar {
      width: 100%;
      flex: 0 0 44%;
      max-height: 46%;
      border-left: 0;
      border-top: 1px solid #1e293b;
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
      grid-auto-rows: min-content;
      align-items: start;
      gap: 10px;
      overflow-y: auto;
    }

    .workspace[data-mode='show'] > .show-sidebar > .card-live-mics {
      grid-column: 1;
      grid-row: 1 / span 2;
    }

    .workspace[data-mode='show'] > .show-sidebar > .card-ring-log {
      grid-column: 2;
      grid-row: 1;
    }

    .workspace[data-mode='show'] > .show-sidebar > .card-show-limits {
      grid-column: 2;
      grid-row: 2;
    }
  }

  /* Handheld Phone Live Show Mode Shell (< 680px) */
  .mobile-show-shell {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: #060911;
  }

  .mobile-spl-hero {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 8px 4px;
    padding: 10px 12px;
    background: #0b1120;
    border: 1px solid #1e293b;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .mobile-spl-hero.alert-warn {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.11);
  }

  .mobile-spl-hero.alert-limit {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .mobile-spl-hero-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .mobile-spl-hero-reading {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .mobile-spl-hero-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 28px;
    line-height: 1.08;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #38bdf8;
    white-space: nowrap;
  }

  .mobile-spl-hero.alert-warn .mobile-spl-hero-value {
    color: #fbbf24;
  }

  .mobile-spl-hero.alert-limit .mobile-spl-hero-value {
    color: #f87171;
  }

  .mobile-spl-mic-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: #cbd5e1;
    min-width: 0;
  }

  .mobile-spl-mic-tag > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-wake-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(52, 211, 153, 0.35);
    color: #34d399;
    flex-shrink: 0;
  }

  .mobile-spl-hero-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }

  .mobile-spl-weight-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-block-size: 32px;
    padding: 4px 10px;
    background: #162033;
    border: 1px solid #334155;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .mobile-spl-kpi-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    padding-top: 7px;
    border-top: 1px solid #1e293b;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .mobile-spl-kpi {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mobile-spl-kpi span {
    font-family: var(--_foh-font-sans, system-ui, sans-serif);
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    color: #94a3b8;
  }

  .mobile-spl-kpi strong {
    font-size: 12px;
    color: #f8fafc;
    white-space: nowrap;
  }

  .mobile-ring-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 2px 8px 4px;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.14);
    border: 1px solid #f59e0b;
    flex-shrink: 0;
  }

  .mobile-ring-banner.crit {
    background: rgba(239, 68, 68, 0.18);
    border-color: #ef4444;
  }

  .mobile-ring-banner-jump {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .mobile-ring-banner-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 11px;
    color: #cbd5e1;
  }

  .mobile-ring-banner-text strong {
    font-size: 12.5px;
    color: #ffffff;
  }

  .mobile-show-stage {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 4px 8px 8px;
    overflow: hidden;
  }

  .mobile-show-scroll-pane {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 8px;
  }

  .mobile-show-scroll-pane .ring-log-list {
    max-height: none;
  }

  /* Accessible 4-Tab Thumb Bar (styled strictly from [role="tab"][aria-selected="true"]) */
  .mobile-show-tablist {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    background: #0b1120;
    border-top: 1px solid #1e293b;
    padding-inline: max(4px, env(safe-area-inset-left, 0px))
      max(4px, env(safe-area-inset-right, 0px));
    padding-bottom: max(4px, env(safe-area-inset-bottom, 0px));
    flex-shrink: 0;
  }

  .mobile-show-tablist > [role='tab'] {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-block-size: 46px;
    padding: 8px 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .mobile-show-tablist > [role='tab'][aria-selected='true'] {
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.08);
  }

  .mobile-show-tablist > [role='tab'][aria-selected='true']::before {
    content: '';
    position: absolute;
    inset: 0 10px auto 10px;
    border-block-start: 3px solid #38bdf8;
  }

  .mobile-tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: 18px;
    padding: 0 5px;
    border-radius: 999px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    background: #1e293b;
    color: #cbd5e1;
  }

  .mobile-tab-count.active-ring {
    background: #ef4444;
    color: #ffffff;
  }
  `,
];

