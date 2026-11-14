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

import { html, nothing, TemplateResult } from 'lit';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  SplAlertThresholds,
} from '../../dsp/spl-history.js';
import {
  BroadbandLevelsSnapshot,
  MeterIntegrationTime,
  WeightingCurve,
} from '../../dsp/weighting-meters.js';
import { WorkspaceMode } from '../url-state.js';

export interface SplMeterGroupProps {
  readonly workspaceMode?: WorkspaceMode;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly splAlertThresholds?: SplAlertThresholds;
  readonly onSplWeightingChange: (curve: WeightingCurve) => void;
  readonly onSplTimeChange: (time: MeterIntegrationTime) => void;
}

function evaluateMonitoredMetricDb(
  levels: BroadbandLevelsSnapshot | undefined,
  thresholds: SplAlertThresholds
): number {
  if (!levels) return -40.0;
  const rolling = levels.rollingLeq;
  switch (thresholds.metric) {
    case 'LAeq15m':
      return rolling ? rolling.leq15m.A : levels.levelsDb.A.Leq;
    case 'LAeq60m':
      return rolling ? rolling.leq60m.A : levels.levelsDb.A.Leq;
    case 'LAeq5m':
      return rolling ? rolling.leq5m.A : levels.levelsDb.A.Leq;
    case 'LAeq1m':
      return rolling ? rolling.leq1m.A : levels.levelsDb.A.Leq;
    case 'LCeq1m':
      return rolling ? rolling.leq1m.C : levels.levelsDb.C.Leq;
    case 'LAF':
      return levels.levelsDb.A.Fast;
    case 'LZpeak':
      return levels.peaksDb.Z;
  }
}

export function renderSplMeterGroup(props: SplMeterGroupProps): TemplateResult {
  const { levels } = props;
  const currentSpl = levels ? levels.levelsDb[props.splWeighting][props.splTime] : -40.0;
  const currentLeq = levels ? levels.levelsDb[props.splWeighting].Leq : -40.0;
  const currentPeak = levels ? levels.peaksDb[props.splWeighting] : -40.0;
  const rolling = levels?.rollingLeq;
  const thresholds = props.splAlertThresholds ?? DEFAULT_SPL_ALERT_THRESHOLDS;
  const monitoredDb = evaluateMonitoredMetricDb(levels, thresholds);

  const isLimit = thresholds.enabled && monitoredDb >= thresholds.limitDb;
  const isWarn =
    thresholds.enabled && !isLimit && monitoredDb >= thresholds.warningDb;

  const statusBadge = isLimit
    ? html`<span class="spl-alert-badge limit" data-testid="spl-status-badge">◆ LIMIT</span>`
    : isWarn
      ? html`<span class="spl-alert-badge warn" data-testid="spl-status-badge">▲ WARN</span>`
      : props.workspaceMode === 'show'
        ? html`<span class="spl-alert-badge ok" data-testid="spl-status-badge">● OK</span>`
        : nothing;

  const laeq1m = rolling ? rolling.leq1m.A : currentLeq;
  const laeq15m = rolling ? rolling.leq15m.A : currentLeq;
  const cMinusA = rolling
    ? rolling.cMinusALeq1mDb
    : levels
      ? levels.levelsDb.C.Leq - levels.levelsDb.A.Leq
      : 0;

  return html`
    <div
      class="toolbar-group spl-readout ${isLimit ? 'alert-limit' : isWarn ? 'alert-warn' : ''}"
      data-testid="spl-meter-bar"
    >
      <select
        aria-label="SPL Weighting"
        data-testid="select-spl-weighting"
        .value=${props.splWeighting}
        @change=${(e: Event) =>
          props.onSplWeightingChange((e.target as HTMLSelectElement).value as WeightingCurve)}
      >
        <option value="A">dBA</option>
        <option value="C">dBC</option>
        <option value="Z">dBZ</option>
      </select>
      <select
        aria-label="SPL Integration Time"
        .value=${props.splTime}
        @change=${(e: Event) =>
          props.onSplTimeChange(
            (e.target as HTMLSelectElement).value as MeterIntegrationTime
          )}
      >
        <option value="Fast">Fast</option>
        <option value="Slow">Slow</option>
        <option value="Impulse">Impulse</option>
      </select>
      <div class="spl-main-value" data-testid="spl-main-value">
        ${currentSpl.toFixed(1)} dB${props.splWeighting}
      </div>

      ${props.workspaceMode === 'show'
        ? html`
            <div class="spl-show-metrics" data-testid="spl-show-compliance-metrics">
              <div class="spl-metric-chip">
                <span>LAeq1m</span>
                <strong>${laeq1m.toFixed(1)}</strong>
              </div>
              <div class="spl-metric-chip">
                <span>LAeq15m</span>
                <strong>${laeq15m.toFixed(1)} / ${thresholds.limitDb.toFixed(0)}</strong>
              </div>
              <div class="spl-metric-chip">
                <span>LC−LA</span>
                <strong>${cMinusA >= 0 ? '+' : ''}${cMinusA.toFixed(1)} dB</strong>
              </div>
              <div class="spl-metric-chip">
                <span>Pk</span>
                <strong>${currentPeak.toFixed(1)}</strong>
              </div>
              ${statusBadge}
            </div>
          `
        : html`
            <div class="spl-sub-value">
              <div class="spl-sub-row"><span>Leq:</span><strong>${currentLeq.toFixed(1)}</strong></div>
              <div class="spl-sub-row"><span>Pk:</span><strong>${currentPeak.toFixed(1)}</strong></div>
            </div>
            ${statusBadge}
          `}
    </div>
  `;
}
