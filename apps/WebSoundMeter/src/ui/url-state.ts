// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatQueryString, parseSearchParams, syncBrowserQueryString } from '@foh/state';
import { PLOT_METADATA, PlotType } from '../charts/plot-types.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import { SIMULATOR_PRESETS, SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import type { LayoutPreset } from './app-shell.js';

export type WorkspaceMode = 'tuning' | 'show';

export interface UrlViewState {
  readonly layoutPreset: LayoutPreset;
  readonly chartPlotTypes: PlotType[];
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly selectedSourceId: string;
  readonly workspaceMode?: WorkspaceMode;
}

const VALID_LAYOUTS = new Set<LayoutPreset>([
  'pa-triple',
  'tf-dual',
  'rta-mix',
  'show-dual',
  'show-triple',
  'single',
]);
const VALID_MODES = new Set<InputSourceMode>(['simulator', 'hardware']);
const VALID_WEIGHTINGS = new Set<WeightingCurve>(['A', 'C', 'Z']);
const VALID_TIMES = new Set<MeterIntegrationTime>(['Fast', 'Slow', 'Impulse']);

export function plotsForLayoutPreset(
  preset: LayoutPreset,
  currentFirstPlot: PlotType = 'magnitude'
): PlotType[] {
  switch (preset) {
    case 'tf-dual':
      return ['magnitude', 'phase'];
    case 'pa-triple':
      return ['magnitude', 'phase', 'impulse'];
    case 'rta-mix':
      return ['rta', 'magnitude'];
    case 'show-dual':
      return ['rta', 'spl-history'];
    case 'show-triple':
      return ['rta', 'magnitude', 'spl-history'];
    case 'single':
      return [currentFirstPlot];
  }
}

export const DEFAULT_URL_VIEW_STATE: UrlViewState = {
  layoutPreset: 'pa-triple',
  chartPlotTypes: ['magnitude', 'phase', 'impulse'],
  audioInputMode: 'simulator',
  simulatorPreset: 'pa-room-modes',
  splWeighting: 'A',
  splTime: 'Fast',
  selectedSourceId: 'live-measurement',
};

function isValidPlotType(value: string): value is PlotType {
  return Object.prototype.hasOwnProperty.call(PLOT_METADATA, value);
}

function isValidSimulatorPreset(value: string): value is SimulatorPresetId {
  return Object.prototype.hasOwnProperty.call(SIMULATOR_PRESETS, value);
}

export function parseUrlViewState(
  search: string,
  fallback: Partial<UrlViewState> = {}
): UrlViewState {
  const base: UrlViewState = {
    ...DEFAULT_URL_VIEW_STATE,
    ...fallback,
  };
  const params = parseSearchParams(search);

  const rawLayout = params.get('layout');
  const layoutPreset: LayoutPreset =
    rawLayout && VALID_LAYOUTS.has(rawLayout as LayoutPreset)
      ? (rawLayout as LayoutPreset)
      : base.layoutPreset;

  let chartPlotTypes =
    rawLayout && VALID_LAYOUTS.has(rawLayout as LayoutPreset)
      ? plotsForLayoutPreset(layoutPreset, base.chartPlotTypes[0])
      : [...base.chartPlotTypes];

  const rawPlots = params.get('plots');
  if (rawPlots) {
    const parsedPlots = rawPlots
      .split(',')
      .map((s) => s.trim())
      .filter(isValidPlotType)
      .slice(0, 3);
    if (parsedPlots.length > 0) {
      chartPlotTypes = parsedPlots;
    }
  }

  const rawMode = params.get('mode');
  const audioInputMode: InputSourceMode =
    rawMode && VALID_MODES.has(rawMode as InputSourceMode)
      ? (rawMode as InputSourceMode)
      : base.audioInputMode;

  const rawPreset = params.get('preset');
  const simulatorPreset: SimulatorPresetId =
    rawPreset && isValidSimulatorPreset(rawPreset)
      ? rawPreset
      : base.simulatorPreset;

  let splWeighting = base.splWeighting;
  let splTime = base.splTime;
  const rawSpl = params.get('spl');
  if (rawSpl) {
    const [w, t] = rawSpl.split(',').map((s) => s.trim());
    if (w && VALID_WEIGHTINGS.has(w as WeightingCurve)) {
      splWeighting = w as WeightingCurve;
    }
    if (t && VALID_TIMES.has(t as MeterIntegrationTime)) {
      splTime = t as MeterIntegrationTime;
    }
  }

  const rawSrc = params.get('src')?.trim();
  const selectedSourceId = rawSrc && rawSrc.length > 0 ? rawSrc : base.selectedSourceId;

  const rawView = params.get('view');
  const workspaceMode: WorkspaceMode | undefined =
    rawView === 'show' || rawMode === 'show'
      ? 'show'
      : rawView === 'tuning'
        ? 'tuning'
        : base.workspaceMode;

  return {
    layoutPreset,
    chartPlotTypes,
    audioInputMode,
    simulatorPreset,
    splWeighting,
    splTime,
    selectedSourceId,
    ...(workspaceMode && workspaceMode !== 'tuning' ? { workspaceMode } : {}),
  };
}

export function serializeUrlViewState(state: UrlViewState): string {
  const params = new URLSearchParams();

  if (state.workspaceMode === 'show') {
    params.set('view', 'show');
  }

  if (state.layoutPreset !== DEFAULT_URL_VIEW_STATE.layoutPreset) {
    params.set('layout', state.layoutPreset);
  }

  const defaultPlotsForLayout = plotsForLayoutPreset(state.layoutPreset);
  const plotsDiffer =
    state.chartPlotTypes.length !== defaultPlotsForLayout.length ||
    state.chartPlotTypes.some((p, i) => p !== defaultPlotsForLayout[i]);
  if (plotsDiffer) {
    params.set('plots', state.chartPlotTypes.join(','));
  }

  if (state.audioInputMode !== DEFAULT_URL_VIEW_STATE.audioInputMode) {
    params.set('mode', state.audioInputMode);
  }

  if (state.simulatorPreset !== DEFAULT_URL_VIEW_STATE.simulatorPreset) {
    params.set('preset', state.simulatorPreset);
  }

  if (
    state.splWeighting !== DEFAULT_URL_VIEW_STATE.splWeighting ||
    state.splTime !== DEFAULT_URL_VIEW_STATE.splTime
  ) {
    params.set('spl', `${state.splWeighting},${state.splTime}`);
  }

  if (state.selectedSourceId !== DEFAULT_URL_VIEW_STATE.selectedSourceId) {
    params.set('src', state.selectedSourceId);
  }

  return formatQueryString(params);
}

export function syncBrowserUrlState(
  state: UrlViewState,
  mode: 'push' | 'replace' = 'replace'
): void {
  syncBrowserQueryString(serializeUrlViewState(state), mode);
}
