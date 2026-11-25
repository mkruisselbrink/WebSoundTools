// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dedicated Handheld Phone Live Show Mode Shell (`< 680 px`).
 *
 * Replaces stacked WebGL2 charts + narrow sidebar with a locked `100dvh` handheld deck:
 * 1. Pinned Hero SPL & Compliance Scoreboard (readable at arm's length across all tabs)
 * 2. Conditional 1-tap Live Feedback Ring Alert Banner (when viewing Spectrum / SPL Trend)
 * 3. Single Active Tab Panel (mounts at most 1 `<chart-panel>` at a time to halve GPU/battery draw)
 * 4. Thumb-zone 4-tab bottom bar (`Spectrum` | `SPL Trend` | `Rings` | `Mics & Cal`)
 */

import type { BiquadSpec } from '@foh/dsp';
import { renderChevronDownSvg } from '@foh/ui';
import { html, nothing, type TemplateResult } from 'lit';
import type { PlotType } from '../charts/plot-types.js';
import type { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  type SplHistoryWindowSec,
} from '../dsp/spl-history.js';
import type {
  BroadbandLevelsSnapshot,
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import type { SourceData } from '../sources/source-data.js';
import {
  renderFeedbackRingLogCard,
  renderLiveMicsWatchCard,
  renderShowLimitsExportCard,
  type ShowSidebarViewProps,
} from './show-sidebar-view.js';
import {
  evaluateMonitoredMetricDb,
  renderSplConfigPopover,
} from './topbar/spl-meter-group.js';

export type MobileShowTab = 'rta' | 'history' | 'rings' | 'mics';

export const MOBILE_SHOW_TAB_ORDER: readonly MobileShowTab[] = [
  'rta',
  'history',
  'rings',
  'mics',
];

export function nextMobileShowTabByKey(
  current: MobileShowTab,
  key: string
): MobileShowTab | null {
  const idx = MOBILE_SHOW_TAB_ORDER.indexOf(current);
  if (idx < 0) return null;
  if (key === 'ArrowRight') {
    return MOBILE_SHOW_TAB_ORDER[(idx + 1) % MOBILE_SHOW_TAB_ORDER.length];
  }
  if (key === 'ArrowLeft') {
    return MOBILE_SHOW_TAB_ORDER[
      (idx - 1 + MOBILE_SHOW_TAB_ORDER.length) % MOBILE_SHOW_TAB_ORDER.length
    ];
  }
  if (key === 'Home') {
    return MOBILE_SHOW_TAB_ORDER[0];
  }
  if (key === 'End') {
    return MOBILE_SHOW_TAB_ORDER[MOBILE_SHOW_TAB_ORDER.length - 1];
  }
  return null;
}

export function pickPrimaryActiveRing(
  feedbackRingLog: readonly DetectedFeedbackTrack[]
): DetectedFeedbackTrack | null {
  let best: DetectedFeedbackTrack | null = null;
  for (const track of feedbackRingLog) {
    if (track.state !== 'feedback' && track.state !== 'ringing') continue;
    if (!best) {
      best = track;
      continue;
    }
    const currCrit = track.state === 'feedback' ? 1 : 0;
    const bestCrit = best.state === 'feedback' ? 1 : 0;
    if (
      currCrit > bestCrit ||
      (currCrit === bestCrit && track.prominenceDb > best.prominenceDb)
    ) {
      best = track;
    }
  }
  return best;
}

export interface MobileShowWorkspaceProps extends ShowSidebarViewProps {
  readonly activeTab: MobileShowTab;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly activeSlotName: string;
  readonly activeSlotColor: string;
  readonly wakeLockActive: boolean;
  readonly chartSources: readonly SourceData[];
  readonly eqBands: BiquadSpec[] | null;
  readonly onSelectTab: (tab: MobileShowTab) => void;
  readonly onSplWeightingChange: (curve: WeightingCurve) => void;
  readonly onSplTimeChange: (time: MeterIntegrationTime) => void;
  readonly onSplWindowChange: (windowSec: SplHistoryWindowSec) => void;
  readonly onEqBandDrag: (
    e: CustomEvent<{ bandIndex: number; frequency: number; gainDb: number; q?: number }>
  ) => void;
  readonly onEqBandDragEnd: () => void;
}

export function renderMobileShowWorkspace(
  props: MobileShowWorkspaceProps
): TemplateResult {
  const { levels } = props;
  const currentSpl = levels ? levels.levelsDb[props.splWeighting][props.splTime] : -40.0;
  const currentLeq = levels ? levels.levelsDb[props.splWeighting].Leq : -40.0;
  const currentPeak = levels ? levels.peaksDb[props.splWeighting] : -40.0;
  const rolling = levels?.rollingLeq;
  const thresholds = props.splAlertThresholds ?? DEFAULT_SPL_ALERT_THRESHOLDS;
  const monitoredDb = evaluateMonitoredMetricDb(
    levels,
    thresholds,
    'show',
    props.splWeighting,
    props.splTime
  );

  const isLimit = thresholds.enabled && monitoredDb >= thresholds.limitDb;
  const isWarn = thresholds.enabled && !isLimit && monitoredDb >= thresholds.warningDb;
  const alertClass = isLimit ? 'alert-limit' : isWarn ? 'alert-warn' : '';
  const statusBadge = isLimit
    ? html`<span class="foh-lcd-badge limit" data-testid="spl-status-badge">◆ LIMIT</span>`
    : isWarn
      ? html`<span class="foh-lcd-badge warn" data-testid="spl-status-badge">▲ WARN</span>`
      : html`<span class="foh-lcd-badge ok" data-testid="spl-status-badge">● OK</span>`;

  const laeq15m = rolling ? rolling.leq15m.A : currentLeq;
  const cMinusA = rolling
    ? rolling.cMinusALeq1mDb
    : levels
      ? levels.levelsDb.C.Leq - levels.levelsDb.A.Leq
      : 0;

  const activeRingCount = props.feedbackRingLog.filter(
    (t) => t.state === 'feedback' || t.state === 'ringing'
  ).length;
  const totalRingCount = props.feedbackRingLog.length;
  const topActiveRing = pickPrimaryActiveRing(props.feedbackRingLog);
  const showRingBanner =
    topActiveRing !== null &&
    (props.activeTab === 'rta' || props.activeTab === 'history');

  const activeChartPlotType: PlotType | null =
    props.activeTab === 'rta'
      ? 'rta'
      : props.activeTab === 'history'
        ? 'spl-history'
        : null;

  const handleTabKeydown = (e: KeyboardEvent) => {
    const next = nextMobileShowTabByKey(props.activeTab, e.key);
    if (!next) return;
    e.preventDefault();
    props.onSelectTab(next);
    const list = e.currentTarget as HTMLElement | null;
    const btn = list?.querySelector(
      `#mobile-show-tab-${next}`
    ) as HTMLButtonElement | null;
    btn?.focus();
  };

  return html`
    <div class="mobile-show-shell" data-testid="mobile-show-shell">
      <!-- 1. Pinned Hero SPL & Compliance Scoreboard -->
      <section
        class="mobile-spl-hero ${alertClass}"
        data-testid="spl-meter-bar"
        aria-label="Broadband SPL & Show Compliance Scoreboard"
      >
        <div class="mobile-spl-hero-top">
          <div class="mobile-spl-hero-reading">
            <span class="mobile-spl-hero-value" data-testid="spl-main-value"
              >${currentSpl.toFixed(1)} dB${props.splWeighting}</span
            >
            <div class="mobile-spl-mic-tag">
              <span
                class="source-color-dot"
                style="background:${props.activeSlotColor}"
              ></span>
              <span>${props.activeSlotName}</span>
              <span
                class="mobile-wake-badge"
                data-testid="wake-lock-badge"
                ?hidden=${!props.wakeLockActive}
                title="Screen Wake Lock active — display stays awake during Show Mode"
                >☀ Awake</span
              >
            </div>
          </div>

          <div class="mobile-spl-hero-actions">
            ${statusBadge}
            <button
              type="button"
              class="mobile-spl-weight-btn"
              data-testid="btn-spl-popover"
              data-popover-trigger="wsm-spl-popover"
              popovertarget="wsm-spl-popover"
              aria-label="SPL Weighting and Integration Time"
              aria-expanded="false"
            >
              <span>dB${props.splWeighting} · ${props.splTime}</span>
              ${renderChevronDownSvg()}
            </button>
          </div>
        </div>

        <div class="mobile-spl-kpi-strip" data-testid="spl-show-compliance-metrics">
          <div class="mobile-spl-kpi">
            <span>${thresholds.metric}</span>
            <strong>${laeq15m.toFixed(1)} / ${thresholds.limitDb.toFixed(0)} dB</strong>
          </div>
          <div class="mobile-spl-kpi">
            <span>LC − LA</span>
            <strong>${cMinusA >= 0 ? '+' : ''}${cMinusA.toFixed(1)} dB</strong>
          </div>
          <div class="mobile-spl-kpi">
            <span>Peak</span>
            <strong>${currentPeak.toFixed(1)} dB</strong>
          </div>
        </div>

        ${renderSplConfigPopover(props)}
      </section>

      <!-- 2. Live Feedback Ring Alert Banner (when viewing Spectrum or SPL Trend) -->
      ${showRingBanner && topActiveRing
        ? html`
            <div
              class="mobile-ring-banner ${topActiveRing.state === 'feedback'
                ? 'crit'
                : 'warn'}"
              data-testid="mobile-ring-alert-banner"
            >
              <button
                type="button"
                class="mobile-ring-banner-jump"
                @click=${() => props.onSelectTab('rings')}
              >
                <span class="ring-severity-badge ${topActiveRing.state === 'feedback'
                  ? 'crit'
                  : 'warn'}"
                  >${topActiveRing.state === 'feedback' ? '◆' : '▲'}</span
                >
                <span class="mobile-ring-banner-text">
                  <strong>
                    ${topActiveRing.frequencyHz >= 1000
                      ? `${(topActiveRing.frequencyHz / 1000).toFixed(2)} kHz`
                      : `${Math.round(topActiveRing.frequencyHz)} Hz`}
                  </strong>
                  <span>ISO ${topActiveRing.isoBandLabel} · ${topActiveRing.musicalNote}</span>
                </span>
              </button>
              <button
                type="button"
                class="btn-notch-eq"
                @click=${() => props.onApplyFeedbackNotch(topActiveRing)}
              >
                Notch EQ
              </button>
            </div>
          `
        : nothing}

      <!-- 3. Single Active Full-Bleed View Panel -->
      <main
        class="mobile-show-stage"
        role="tabpanel"
        aria-labelledby="mobile-show-tab-${props.activeTab}"
      >
        ${activeChartPlotType !== null
          ? html`
              <chart-panel
                data-testid="chart-panel-0"
                .plotType=${activeChartPlotType}
                .hidePlotTypeSelector=${true}
                .sources=${props.chartSources}
                .eqBands=${props.eqBands}
                .splAlertThresholds=${props.splAlertThresholds}
                @plot-type-change=${(e: CustomEvent<{ plotType: PlotType }>) => {
                  if (e.detail.plotType === 'spl-history') {
                    props.onSelectTab('history');
                  } else if (e.detail.plotType === 'rta') {
                    props.onSelectTab('rta');
                  }
                }}
                @spl-window-change=${(
                  e: CustomEvent<{ windowSec: SplHistoryWindowSec }>
                ) => props.onSplWindowChange(e.detail.windowSec)}
                @eq-band-drag=${props.onEqBandDrag}
                @eq-band-drag-end=${props.onEqBandDragEnd}
              ></chart-panel>
            `
          : props.activeTab === 'rings'
            ? html`
                <div class="mobile-show-scroll-pane">
                  ${renderFeedbackRingLogCard(props)}
                </div>
              `
            : html`
                <div class="mobile-show-scroll-pane">
                  ${renderLiveMicsWatchCard(props)}
                  ${renderShowLimitsExportCard(props)}
                </div>
              `}
      </main>

      <!-- 4. Thumb-Zone Bottom Tab Bar -->
      <div
        class="mobile-show-tablist"
        role="tablist"
        aria-label="Live Show Views"
        data-testid="mobile-show-tablist"
        @keydown=${handleTabKeydown}
      >
        <button
          type="button"
          role="tab"
          id="mobile-show-tab-rta"
          data-testid="mobile-tab-rta"
          aria-selected=${String(props.activeTab === 'rta')}
          tabindex=${props.activeTab === 'rta' ? '0' : '-1'}
          @click=${() => props.onSelectTab('rta')}
        >
          <span>Spectrum</span>
        </button>
        <button
          type="button"
          role="tab"
          id="mobile-show-tab-history"
          data-testid="mobile-tab-history"
          aria-selected=${String(props.activeTab === 'history')}
          tabindex=${props.activeTab === 'history' ? '0' : '-1'}
          @click=${() => props.onSelectTab('history')}
        >
          <span>SPL Trend</span>
        </button>
        <button
          type="button"
          role="tab"
          id="mobile-show-tab-rings"
          data-testid="mobile-tab-rings"
          aria-selected=${String(props.activeTab === 'rings')}
          tabindex=${props.activeTab === 'rings' ? '0' : '-1'}
          @click=${() => props.onSelectTab('rings')}
        >
          <span>Rings</span>
          <span
            class="mobile-tab-count ${activeRingCount > 0 ? 'active-ring' : ''}"
            >${totalRingCount}</span
          >
        </button>
        <button
          type="button"
          role="tab"
          id="mobile-show-tab-mics"
          data-testid="mobile-tab-mics"
          aria-selected=${String(props.activeTab === 'mics')}
          tabindex=${props.activeTab === 'mics' ? '0' : '-1'}
          @click=${() => props.onSelectTab('mics')}
        >
          <span>Mics &amp; Cal</span>
        </button>
      </div>
    </div>
  `;
}
