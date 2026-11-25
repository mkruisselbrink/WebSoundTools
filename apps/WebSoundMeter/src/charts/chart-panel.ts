// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Interactive Acoustic Chart Panel (`<chart-panel>` Lit 3 Web Component)
 * powered by `@foh/charts`'s `FohChartPanelBase`.
 */

import {
  FohChartPanelBase,
  computeZoomedYRange,
  fohChartPanelStyles,
  type ChartScene,
  type CoherenceBlankingMode,
  type CursorReadoutModel,
} from '@foh/charts';
import type { BiquadSpec } from '@foh/dsp';
import { css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  type SplAlertThresholds,
  type SplHistoryTraceMode,
  type SplHistoryWindowSec,
} from '../dsp/spl-history.js';
import type { SourceData } from '../sources/source-data.js';
import { PLOT_METADATA, type PlotType } from './plot-types.js';
import {
  buildWsmChartScene,
  buildWsmCursorReadoutModel,
  type RtaDisplayMode,
} from './wsm-chart-adapter.js';
import { renderWsmChartHeader } from './wsm-chart-controls.js';

export type { RtaDisplayMode };

@customElement('chart-panel')
export class ChartPanelElement extends FohChartPanelBase {
  static styles = [
    fohChartPanelStyles,
    css`
      :host {
        min-height: 190px;
        border-radius: 8px;
      }
    `,
  ];

  @property({ type: String })
  plotType: PlotType = 'magnitude';

  @property({ type: Boolean })
  hidePlotTypeSelector = false;

  @property({ attribute: false })
  sources: SourceData[] = [];

  @property({ attribute: false })
  extraFeedbackTracks: readonly DetectedFeedbackTrack[] = [];

  @property({ attribute: false })
  eqBands: BiquadSpec[] | null = null;

  @property({ type: String })
  coherenceMode: CoherenceBlankingMode = 'alpha';

  @property({ type: Boolean })
  get coherenceAlpha(): boolean {
    return this.coherenceMode !== 'off';
  }

  set coherenceAlpha(enabled: boolean) {
    this.coherenceMode = enabled
      ? this.coherenceMode === 'off'
        ? 'alpha'
        : this.coherenceMode
      : 'off';
  }

  @property({ type: Number })
  coherenceThreshold: number = 0.35;

  @property({ attribute: false })
  splAlertThresholds: SplAlertThresholds = DEFAULT_SPL_ALERT_THRESHOLDS;

  @state()
  private rtaMode: RtaDisplayMode = 'bars-3';

  @state()
  private showPeakHold: boolean = true;

  @state()
  private showFeedbackWatch: boolean = true;

  @state()
  private splWindowSec: SplHistoryWindowSec = 900;

  @state()
  private splTraceMode: SplHistoryTraceMode = 'compliance-15m';

  @state()
  private showSplThresholds: boolean = true;

  @state()
  private xMin: number = 20;

  @state()
  private xMax: number = 20000;

  @state()
  private yMin: number = -24;

  @state()
  private yMax: number = 24;

  connectedCallback(): void {
    super.connectedCallback();
    this.applyDefaultBoundsForPlot(this.plotType);
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('plotType')) {
      this.applyDefaultBoundsForPlot(this.plotType);
    }
    super.updated(changed);
  }

  private applyDefaultBoundsForPlot(type: PlotType): void {
    const meta = PLOT_METADATA[type];
    this.xMin = type === 'spl-history' ? -this.splWindowSec : meta.defaultXMin;
    this.xMax = meta.defaultXMax;
    this.yMin = meta.defaultYMin;
    this.yMax = meta.defaultYMax;
    this.clearCursor();
  }

  private handlePlotTypeChange = (e: Event): void => {
    const nextType = (e.target as HTMLSelectElement).value as PlotType;
    this.plotType = nextType;
    this.dispatchEvent(
      new CustomEvent('plot-type-change', {
        detail: { plotType: nextType },
        bubbles: true,
        composed: true,
      })
    );
  };

  private resetZoom = (): void => {
    this.applyDefaultBoundsForPlot(this.plotType);
    this.requestChartRepaint();
  };

  private zoomY = (factor: number): void => {
    const next = computeZoomedYRange(this.yMin, this.yMax, factor);
    this.yMin = next.yMin;
    this.yMax = next.yMax;
  };

  protected buildChartScene(): ChartScene {
    return buildWsmChartScene({
      plotType: this.plotType,
      bounds: {
        xMin: this.xMin,
        xMax: this.xMax,
        yMin: this.yMin,
        yMax: this.yMax,
      },
      sources: this.sources,
      eqBands: this.eqBands,
      rtaMode: this.rtaMode,
      showPeakHold: this.showPeakHold,
      coherenceMode: this.coherenceMode,
      coherenceThreshold: this.coherenceThreshold,
      showFeedbackWatch: this.showFeedbackWatch,
      extraFeedbackTracks: this.extraFeedbackTracks,
      splTraceMode: this.splTraceMode,
      showSplThresholds: this.showSplThresholds,
      splAlertThresholds: this.splAlertThresholds,
    });
  }

  protected buildCursorReadout(domainX: number): CursorReadoutModel | null {
    return buildWsmCursorReadoutModel(this.plotType, domainX, this.sources);
  }

  protected renderHeader(): TemplateResult {
    return renderWsmChartHeader({
      plotType: this.plotType,
      hidePlotTypeSelector: this.hidePlotTypeSelector,
      rtaMode: this.rtaMode,
      showPeakHold: this.showPeakHold,
      coherenceMode: this.coherenceMode,
      coherenceThreshold: this.coherenceThreshold,
      showFeedbackWatch: this.showFeedbackWatch,
      splWindowSec: this.splWindowSec,
      splTraceMode: this.splTraceMode,
      showSplThresholds: this.showSplThresholds,
      onPlotTypeChange: this.handlePlotTypeChange,
      onRtaModeChange: (mode) => {
        this.rtaMode = mode;
        this.requestChartRepaint();
      },
      onTogglePeakHold: (enabled) => {
        this.showPeakHold = enabled;
        this.requestChartRepaint();
      },
      onCoherenceModeChange: (mode) => {
        this.coherenceMode = mode;
        this.requestChartRepaint();
      },
      onCoherenceThresholdChange: (threshold) => {
        this.coherenceThreshold = threshold;
        this.requestChartRepaint();
      },
      onToggleFeedbackWatch: (enabled) => {
        this.showFeedbackWatch = enabled;
        this.requestChartRepaint();
      },
      onSplWindowChange: (windowSec) => {
        this.splWindowSec = windowSec;
        this.xMin = -windowSec;
        this.xMax = 0;
        this.dispatchEvent(
          new CustomEvent('spl-window-change', {
            detail: { windowSec },
            bubbles: true,
            composed: true,
          })
        );
        this.requestChartRepaint();
      },
      onSplTraceModeChange: (mode) => {
        this.splTraceMode = mode;
        this.requestChartRepaint();
      },
      onToggleSplThresholds: (enabled) => {
        this.showSplThresholds = enabled;
        this.requestChartRepaint();
      },
      onZoomY: this.zoomY,
      onResetZoom: this.resetZoom,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chart-panel': ChartPanelElement;
  }
}
