/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { css } from 'lit';

export const appShellStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    background: #060911;
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    overflow: hidden;
    box-sizing: border-box;
  }

  * {
    box-sizing: border-box;
  }

  /* Top Bar */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 14px;
    background: #0f172a;
    border-bottom: 1px solid #1e293b;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 14px;
    color: #38bdf8;
    letter-spacing: 0.02em;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #162033;
    border: 1px solid #263554;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .toolbar-label {
    color: #94a3b8;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .btn-toggle-gen {
    width: 46px;
    text-align: center;
  }

  .btn-toggle-pause {
    width: 68px;
    text-align: center;
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
    background: #0f172a;
    color: #f8fafc;
    border: 1px solid #334155;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
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
    grid-template-columns: 1fr 1fr;
    gap: 6px 8px;
    font-size: 11px;
  }

  .prop-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .prop-field.full-width {
    grid-column: 1 / -1;
  }

  .prop-field label {
    color: #94a3b8;
    font-size: 10px;
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

  .sim-banner {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.35;
    padding: 4px 6px;
    background: #0f172a;
    border-radius: 4px;
    border-left: 3px solid #38bdf8;
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
`;

