// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { type StorageLike, readStorageJson, writeStorageJson } from '@foh/state';
import { createDefaultLiveSlot } from '../audio/audio-engine.js';
import { PlotType } from '../charts/plot-types.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { InputSourceMode, LiveMeasurementSlotConfig } from '../dsp/dsp.worker.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  SplAlertThresholds,
} from '../dsp/spl-history.js';
import { SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import type { LayoutPreset } from '../ui/app-shell.js';
import { DEFAULT_URL_VIEW_STATE, WorkspaceMode } from '../ui/url-state.js';

export const WORKSPACE_SESSION_STORAGE_KEY = 'web-sound-meter:workspace:v1';

export interface HardwareDeviceRoutingSnapshot {
  readonly selectedDeviceId: string;
  readonly selectedDeviceLabel: string;
  readonly globalReferenceChannel: number;
  readonly generatorOutputChannel: number;
}

export interface SerializedLiveSlot {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
  readonly simulatorPreset: SimulatorPresetId;
  readonly measurementChannel: number;
  readonly referenceChannel: number;
  readonly config: Partial<MeasurementPipelineConfig>;
  readonly activeCalibrationId: string | null;
}

export interface WorkspaceSessionSnapshot {
  readonly version: 1;
  readonly workspaceMode?: WorkspaceMode;
  readonly layoutPreset: LayoutPreset;
  readonly chartPlotTypes: PlotType[];
  readonly showChartPlotTypes?: PlotType[];
  readonly splAlertThresholds?: SplAlertThresholds;
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly selectedSourceId: string;
  readonly liveSlots: LiveMeasurementSlotConfig[];
  readonly genConfig: Pick<
    SignalGeneratorConfig,
    'enabled' | 'type' | 'levelDbFs' | 'sineFrequencyHz'
  >;
  readonly hardwareRouting: HardwareDeviceRoutingSnapshot;
}

function hydrateLiveSlot(
  raw: Partial<SerializedLiveSlot>,
  index: number
): LiveMeasurementSlotConfig {
  const fallback = createDefaultLiveSlot(
    typeof raw.id === 'string' && raw.id.length > 0
      ? raw.id
      : index === 0
        ? 'live-measurement'
        : `live-${index + 1}`,
    index
  );
  return {
    id: fallback.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : fallback.name,
    color: typeof raw.color === 'string' && raw.color.length > 0 ? raw.color : fallback.color,
    visible: typeof raw.visible === 'boolean' ? raw.visible : fallback.visible,
    simulatorPreset: raw.simulatorPreset ?? fallback.simulatorPreset,
    measurementChannel:
      typeof raw.measurementChannel === 'number'
        ? raw.measurementChannel
        : fallback.measurementChannel,
    referenceChannel:
      typeof raw.referenceChannel === 'number'
        ? raw.referenceChannel
        : fallback.referenceChannel,
    config: {
      ...DEFAULT_MEASUREMENT_CONFIG,
      ...(raw.config ?? {}),
    },
    activeCalibrationId:
      typeof raw.activeCalibrationId === 'string' ? raw.activeCalibrationId : null,
  };
}

export function createDefaultWorkspaceSession(): WorkspaceSessionSnapshot {
  return {
    version: 1,
    workspaceMode: 'tuning',
    layoutPreset: DEFAULT_URL_VIEW_STATE.layoutPreset,
    chartPlotTypes: [...DEFAULT_URL_VIEW_STATE.chartPlotTypes],
    showChartPlotTypes: ['rta', 'spl-history'],
    splAlertThresholds: { ...DEFAULT_SPL_ALERT_THRESHOLDS },
    audioInputMode: DEFAULT_URL_VIEW_STATE.audioInputMode,
    simulatorPreset: DEFAULT_URL_VIEW_STATE.simulatorPreset,
    splWeighting: DEFAULT_URL_VIEW_STATE.splWeighting,
    splTime: DEFAULT_URL_VIEW_STATE.splTime,
    selectedSourceId: DEFAULT_URL_VIEW_STATE.selectedSourceId,
    liveSlots: [createDefaultLiveSlot('live-measurement', 0)],
    genConfig: {
      enabled: DEFAULT_GENERATOR_CONFIG.enabled,
      type: DEFAULT_GENERATOR_CONFIG.type,
      levelDbFs: DEFAULT_GENERATOR_CONFIG.levelDbFs,
      sineFrequencyHz: DEFAULT_GENERATOR_CONFIG.sineFrequencyHz,
    },
    hardwareRouting: {
      selectedDeviceId: '',
      selectedDeviceLabel: '',
      globalReferenceChannel: 1,
      generatorOutputChannel: -1,
    },
  };
}

export function loadWorkspaceSession(
  storage?: Pick<StorageLike, 'getItem'> | null
): WorkspaceSessionSnapshot {
  const defaults = createDefaultWorkspaceSession();
  const parsed = readStorageJson<
    Partial<WorkspaceSessionSnapshot> & { liveSlots?: Partial<SerializedLiveSlot>[] }
  >(WORKSPACE_SESSION_STORAGE_KEY, storage);

  if (!parsed || parsed.version !== 1) {
    return defaults;
  }

  const hydratedSlots =
    Array.isArray(parsed.liveSlots) && parsed.liveSlots.length > 0
      ? parsed.liveSlots.map((s, idx) => hydrateLiveSlot(s, idx))
      : defaults.liveSlots;

  return {
    version: 1,
    workspaceMode: parsed.workspaceMode ?? defaults.workspaceMode,
    layoutPreset: parsed.layoutPreset ?? defaults.layoutPreset,
    chartPlotTypes:
      Array.isArray(parsed.chartPlotTypes) && parsed.chartPlotTypes.length > 0
        ? parsed.chartPlotTypes
        : defaults.chartPlotTypes,
    showChartPlotTypes:
      Array.isArray(parsed.showChartPlotTypes) && parsed.showChartPlotTypes.length > 0
        ? parsed.showChartPlotTypes
        : defaults.showChartPlotTypes,
    splAlertThresholds: {
      ...DEFAULT_SPL_ALERT_THRESHOLDS,
      ...(parsed.splAlertThresholds ?? {}),
    },
    audioInputMode: parsed.audioInputMode ?? defaults.audioInputMode,
    simulatorPreset: parsed.simulatorPreset ?? hydratedSlots[0].simulatorPreset,
    splWeighting: parsed.splWeighting ?? defaults.splWeighting,
    splTime: parsed.splTime ?? defaults.splTime,
    selectedSourceId: parsed.selectedSourceId ?? defaults.selectedSourceId,
    liveSlots: hydratedSlots,
    genConfig: {
      ...defaults.genConfig,
      ...(parsed.genConfig ?? {}),
    },
    hardwareRouting: {
      ...defaults.hardwareRouting,
      ...(parsed.hardwareRouting ?? {}),
    },
  };
}

export function saveWorkspaceSession(
  snapshot: WorkspaceSessionSnapshot,
  storage?: Pick<StorageLike, 'setItem'> | null
): void {
  writeStorageJson(WORKSPACE_SESSION_STORAGE_KEY, snapshot, storage);
}
