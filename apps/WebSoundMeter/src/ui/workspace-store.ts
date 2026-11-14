// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Workspace mode, chart layout presets, SPL meter preferences, and URL/session persistence
 * state controller for `<web-sound-meter-app>`.
 */

import { PlotType } from '../charts/plot-types.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
} from '../dsp/dsp-worker-protocol.js';
import type { SignalGeneratorConfig } from '../dsp/signal-generator.js';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  SplAlertThresholds,
} from '../dsp/spl-history.js';
import type { SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import {
  HardwareDeviceRoutingSnapshot,
  WorkspaceSessionSnapshot,
  saveWorkspaceSession,
} from '../sources/workspace-session.js';
import {
  UrlViewState,
  WorkspaceMode,
  parseUrlViewState,
  plotsForLayoutPreset,
  syncBrowserUrlState,
} from './url-state.js';

export type LayoutPreset =
  | 'tf-dual'
  | 'pa-triple'
  | 'rta-mix'
  | 'show-dual'
  | 'show-triple'
  | 'single';

export class WorkspaceLayoutController {
  workspaceMode: WorkspaceMode = 'tuning';
  layoutPreset: LayoutPreset = 'pa-triple';
  tuningLayoutPreset: LayoutPreset = 'pa-triple';
  showLayoutPreset: LayoutPreset = 'show-dual';
  chartPlotTypes: PlotType[] = ['magnitude', 'phase', 'impulse'];
  tuningChartPlotTypes: PlotType[] = ['magnitude', 'phase', 'impulse'];
  showChartPlotTypes: PlotType[] = ['rta', 'spl-history'];
  splAlertThresholds: SplAlertThresholds = { ...DEFAULT_SPL_ALERT_THRESHOLDS };
  splWeighting: WeightingCurve = 'A';
  splTime: MeterIntegrationTime = 'Fast';
  audioInputMode: InputSourceMode = 'simulator';

  hydrateFromSessionAndUrl(
    session: WorkspaceSessionSnapshot,
    searchStr: string
  ): UrlViewState {
    const initialUrl = parseUrlViewState(searchStr, {
      workspaceMode: session.workspaceMode,
      layoutPreset: session.layoutPreset,
      chartPlotTypes: session.chartPlotTypes,
      audioInputMode: session.audioInputMode,
      simulatorPreset: session.simulatorPreset,
      splWeighting: session.splWeighting,
      splTime: session.splTime,
      selectedSourceId: session.selectedSourceId,
    });

    this.workspaceMode = initialUrl.workspaceMode ?? session.workspaceMode ?? 'tuning';
    this.tuningLayoutPreset =
      session.layoutPreset === 'show-dual' || session.layoutPreset === 'show-triple'
        ? 'pa-triple'
        : session.layoutPreset;
    this.showLayoutPreset = 'show-dual';
    this.tuningChartPlotTypes = [...session.chartPlotTypes];
    this.showChartPlotTypes = [...(session.showChartPlotTypes ?? ['rta', 'spl-history'])];
    this.splAlertThresholds = {
      ...DEFAULT_SPL_ALERT_THRESHOLDS,
      ...session.splAlertThresholds,
    };

    const hasExplicitUrlPlots =
      searchStr.includes('plots=') || searchStr.includes('layout=');
    if (this.workspaceMode === 'show' && !hasExplicitUrlPlots) {
      this.layoutPreset = this.showLayoutPreset;
      this.chartPlotTypes = [...this.showChartPlotTypes];
    } else {
      this.layoutPreset = initialUrl.layoutPreset;
      this.chartPlotTypes = initialUrl.chartPlotTypes;
      if (this.workspaceMode === 'show') {
        this.showLayoutPreset = initialUrl.layoutPreset;
        this.showChartPlotTypes = [...initialUrl.chartPlotTypes];
      } else {
        this.tuningLayoutPreset = initialUrl.layoutPreset;
        this.tuningChartPlotTypes = [...initialUrl.chartPlotTypes];
      }
    }

    this.audioInputMode = initialUrl.audioInputMode;
    this.splWeighting = initialUrl.splWeighting;
    this.splTime = initialUrl.splTime;

    return initialUrl;
  }

  switchWorkspaceMode(mode: WorkspaceMode): boolean {
    if (this.workspaceMode === mode) return false;
    if (this.workspaceMode === 'tuning') {
      this.tuningLayoutPreset = this.layoutPreset;
      this.tuningChartPlotTypes = [...this.chartPlotTypes];
    } else {
      this.showLayoutPreset = this.layoutPreset;
      this.showChartPlotTypes = [...this.chartPlotTypes];
    }

    this.workspaceMode = mode;
    if (mode === 'show') {
      this.layoutPreset = this.showLayoutPreset;
      this.chartPlotTypes = [...this.showChartPlotTypes];
    } else {
      this.layoutPreset = this.tuningLayoutPreset;
      this.chartPlotTypes = [...this.tuningChartPlotTypes];
    }
    return true;
  }

  applyLayoutPreset(preset: LayoutPreset): void {
    this.layoutPreset = preset;
    this.chartPlotTypes = plotsForLayoutPreset(preset, this.chartPlotTypes[0]);
    if (this.workspaceMode === 'show') {
      this.showLayoutPreset = preset;
      this.showChartPlotTypes = [...this.chartPlotTypes];
    } else {
      this.tuningLayoutPreset = preset;
      this.tuningChartPlotTypes = [...this.chartPlotTypes];
    }
  }

  updateChartPlotTypeAt(index: number, plotType: PlotType): void {
    const updated = [...this.chartPlotTypes];
    updated[index] = plotType;
    this.chartPlotTypes = updated;
    if (this.workspaceMode === 'show') {
      this.showChartPlotTypes = [...updated];
    } else {
      this.tuningChartPlotTypes = [...updated];
    }
  }

  buildUrlViewState(params: {
    readonly simulatorPreset: SimulatorPresetId;
    readonly selectedSourceId: string;
  }): UrlViewState {
    return {
      ...(this.workspaceMode === 'show' ? { workspaceMode: 'show' as const } : {}),
      layoutPreset: this.layoutPreset,
      chartPlotTypes: this.chartPlotTypes,
      audioInputMode: this.audioInputMode,
      simulatorPreset: params.simulatorPreset,
      splWeighting: this.splWeighting,
      splTime: this.splTime,
      selectedSourceId: params.selectedSourceId,
    };
  }

  persist(params: {
    readonly urlMode: 'push' | 'replace' | 'none';
    readonly simulatorPreset: SimulatorPresetId;
    readonly selectedSourceId: string;
    readonly liveSlots: LiveMeasurementSlotConfig[];
    readonly genConfig: SignalGeneratorConfig;
    readonly hardwareRouting: HardwareDeviceRoutingSnapshot;
  }): void {
    const viewState = this.buildUrlViewState({
      simulatorPreset: params.simulatorPreset,
      selectedSourceId: params.selectedSourceId,
    });
    if (params.urlMode !== 'none') {
      syncBrowserUrlState(viewState, params.urlMode);
    }
    saveWorkspaceSession({
      version: 1,
      ...viewState,
      workspaceMode: this.workspaceMode,
      chartPlotTypes: this.tuningChartPlotTypes,
      showChartPlotTypes: this.showChartPlotTypes,
      splAlertThresholds: this.splAlertThresholds,
      liveSlots: params.liveSlots,
      genConfig: {
        enabled: params.genConfig.enabled,
        type: params.genConfig.type,
        levelDbFs: params.genConfig.levelDbFs,
        sineFrequencyHz: params.genConfig.sineFrequencyHz,
      },
      hardwareRouting: params.hardwareRouting,
    });
  }
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
