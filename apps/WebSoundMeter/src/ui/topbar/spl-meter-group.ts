// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type PopoverParentRootLike,
  renderChevronDownSvg,
  syncAnchoredPopoverToggle,
} from '@foh/ui';
import { html, TemplateResult } from 'lit';
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
  readonly popoverRoot?: PopoverParentRootLike;
  readonly onSplWeightingChange: (curve: WeightingCurve) => void;
  readonly onSplTimeChange: (time: MeterIntegrationTime) => void;
}

const SHORT_TIME_LABELS: Record<MeterIntegrationTime, string> = {
  Fast: 'Fast',
  Slow: 'Slow',
  Impulse: 'Imp',
  Leq: 'Leq',
};

export function evaluateMonitoredMetricDb(
  levels: BroadbandLevelsSnapshot | undefined,
  thresholds: SplAlertThresholds,
  workspaceMode: WorkspaceMode | undefined = 'tuning',
  splWeighting: WeightingCurve = 'A',
  splTime: MeterIntegrationTime = 'Fast'
): number {
  if (!levels) return -40.0;
  if (workspaceMode !== 'show') {
    return levels.levelsDb[splWeighting][splTime];
  }
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
      return rolling?.recentPeakDbZ ?? levels.peaksDb.Z;
  }
}

export function renderSplMeterGroup(props: SplMeterGroupProps): TemplateResult {
  const { levels } = props;
  const currentSpl = levels ? levels.levelsDb[props.splWeighting][props.splTime] : -40.0;
  const currentLeq = levels ? levels.levelsDb[props.splWeighting].Leq : -40.0;
  const currentPeak = levels ? levels.peaksDb[props.splWeighting] : -40.0;
  const rolling = levels?.rollingLeq;
  const thresholds = props.splAlertThresholds ?? DEFAULT_SPL_ALERT_THRESHOLDS;
  const monitoredDb = evaluateMonitoredMetricDb(
    levels,
    thresholds,
    props.workspaceMode,
    props.splWeighting,
    props.splTime
  );

  const isLimit = thresholds.enabled && monitoredDb >= thresholds.limitDb;
  const isWarn =
    thresholds.enabled && !isLimit && monitoredDb >= thresholds.warningDb;

  const alertClass = isLimit ? 'alert-limit' : isWarn ? 'alert-warn' : '';
  const showStatusBadge = isLimit
    ? html`<span class="foh-lcd-badge limit" data-testid="spl-status-badge">◆ LIMIT</span>`
    : isWarn
      ? html`<span class="foh-lcd-badge warn" data-testid="spl-status-badge">▲ WARN</span>`
      : html`<span class="foh-lcd-badge ok" data-testid="spl-status-badge">● OK</span>`;

  const laeq1m = rolling ? rolling.leq1m.A : currentLeq;
  const laeq15m = rolling ? rolling.leq15m.A : currentLeq;
  const cMinusA = rolling
    ? rolling.cMinusALeq1mDb
    : levels
      ? levels.levelsDb.C.Leq - levels.levelsDb.A.Leq
      : 0;

  return html`
    <div
      class="foh-lcd ${alertClass}"
      data-testid="spl-meter-bar"
      role="group"
      aria-label="Broadband SPL Meter"
    >
      <button
        type="button"
        class="foh-lcd-trigger"
        data-testid="btn-spl-popover"
        data-popover-trigger="wsm-spl-popover"
        popovertarget="wsm-spl-popover"
        aria-label="SPL Weighting and Integration Time"
        aria-expanded="false"
        title="Change SPL Frequency Weighting (A/C/Z) & Integration Time"
      >
        <span>dB${props.splWeighting}·${SHORT_TIME_LABELS[props.splTime]}</span>
        ${renderChevronDownSvg()}
      </button>

      <span class="foh-lcd-primary" data-testid="spl-main-value"
        >${currentSpl.toFixed(1)} dB${props.splWeighting}</span
      >

      ${props.workspaceMode === 'show'
        ? html`
            <span class="foh-lcd-sep foh-hide-below-medium" aria-hidden="true"></span>
            <div class="spl-show-inline" data-testid="spl-show-compliance-metrics">
              <span class="foh-lcd-kv foh-hide-below-full">
                <span class="foh-lcd-k">LAeq1m</span>
                <span class="foh-lcd-v" style="inline-size:5.2ch"
                  >${laeq1m.toFixed(1)}</span
                >
              </span>
              <span class="foh-lcd-kv foh-hide-below-medium">
                <span class="foh-lcd-k">LAeq15</span>
                <span class="foh-lcd-v" style="inline-size:8.6ch"
                  >${laeq15m.toFixed(1)}/${thresholds.limitDb.toFixed(0)}</span
                >
              </span>
              <span class="foh-lcd-kv foh-hide-below-full">
                <span class="foh-lcd-k">LC−LA</span>
                <span class="foh-lcd-v" style="inline-size:7.4ch"
                  >${cMinusA >= 0 ? '+' : ''}${cMinusA.toFixed(1)}dB</span
                >
              </span>
              <span class="foh-lcd-kv foh-hide-below-full">
                <span class="foh-lcd-k">Pk</span>
                <span class="foh-lcd-v" style="inline-size:5.2ch"
                  >${currentPeak.toFixed(1)}</span
                >
              </span>
              ${showStatusBadge}
            </div>
          `
        : html`
            <span class="foh-lcd-sep foh-hide-below-full" aria-hidden="true"></span>
            <span class="foh-lcd-kv foh-hide-below-full">
              <span class="foh-lcd-k">Leq</span>
              <span class="foh-lcd-v" style="inline-size:5.2ch"
                >${currentLeq.toFixed(1)}</span
              >
            </span>
            <span class="foh-lcd-kv foh-hide-below-full">
              <span class="foh-lcd-k">Pk</span>
              <span class="foh-lcd-v" style="inline-size:5.2ch"
                >${currentPeak.toFixed(1)}</span
              >
            </span>
          `}

      <div
        id="wsm-spl-popover"
        popover="auto"
        class="foh-popover"
        @toggle=${(ev: Event) => {
          if (props.popoverRoot) syncAnchoredPopoverToggle(ev, props.popoverRoot);
        }}
      >
        <div class="foh-popover-title">SPL Meter Configuration</div>
        <div class="foh-popover-grid">
          <div class="foh-popover-row">
            <label for="wsm-select-spl-weighting">Frequency Weighting</label>
            <select
              id="wsm-select-spl-weighting"
              name="spl-weighting"
              aria-label="SPL Weighting"
              data-testid="select-spl-weighting"
              .value=${props.splWeighting}
              @change=${(e: Event) =>
                props.onSplWeightingChange(
                  (e.target as HTMLSelectElement).value as WeightingCurve
                )}
            >
              <option value="A" ?selected=${props.splWeighting === 'A'}>
                A-Weighting (dBA)
              </option>
              <option value="C" ?selected=${props.splWeighting === 'C'}>
                C-Weighting (dBC)
              </option>
              <option value="Z" ?selected=${props.splWeighting === 'Z'}>
                Z-Weighting / Flat (dBZ)
              </option>
            </select>
          </div>

          <div class="foh-popover-row">
            <label for="wsm-select-spl-time">Integration Time</label>
            <select
              id="wsm-select-spl-time"
              name="spl-integration-time"
              aria-label="SPL Integration Time"
              .value=${props.splTime}
              @change=${(e: Event) =>
                props.onSplTimeChange(
                  (e.target as HTMLSelectElement).value as MeterIntegrationTime
                )}
            >
              <option value="Fast" ?selected=${props.splTime === 'Fast'}>Fast (125 ms)</option>
              <option value="Slow" ?selected=${props.splTime === 'Slow'}>Slow (1 s)</option>
              <option value="Impulse" ?selected=${props.splTime === 'Impulse'}>
                Impulse (35 ms)
              </option>
              <option value="Leq" ?selected=${props.splTime === 'Leq'}>Leq</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}
