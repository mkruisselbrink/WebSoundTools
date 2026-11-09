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

/**
 * Lightweight Synchronous Workspace Session Snapshot (`localStorage`).
 *
 * Stores scalar DSP settings, generator preferences, hardware channel routing,
 * remembered device label, active calibration ID, and fallback view state so
 * the application renders synchronously on frame 1 without layout shift.
 */

import { PlotType } from '../charts/plot-types.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { InputSourceMode } from '../dsp/dsp.worker.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import { SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  MeterIntegrationTime,
  WeightingCurve,
} from '../dsp/weighting-meters.js';
import type { LayoutPreset } from '../ui/app-shell.js';
import { DEFAULT_URL_VIEW_STATE } from '../ui/url-state.js';

export const WORKSPACE_SESSION_STORAGE_KEY = 'web-sound-meter:workspace:v1';

export interface HardwareRoutingSnapshot {
  readonly selectedDeviceId: string;
  readonly selectedDeviceLabel: string;
  readonly measurementChannel: number;
  readonly referenceChannel: number;
  readonly generatorOutputChannel: number;
}

export interface WorkspaceSessionSnapshotV1 {
  readonly version: 1;
  readonly layoutPreset: LayoutPreset;
  readonly chartPlotTypes: PlotType[];
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly selectedSourceId: string;
  readonly liveSourceVisible: boolean;
  readonly measConfig: Partial<MeasurementPipelineConfig>;
  readonly activeCalibrationId: string | null;
  readonly genConfig: Pick<
    SignalGeneratorConfig,
    'enabled' | 'type' | 'levelDbFs' | 'sineFrequencyHz'
  >;
  readonly hardwareRouting: HardwareRoutingSnapshot;
}

export function createDefaultWorkspaceSession(): WorkspaceSessionSnapshotV1 {
  return {
    version: 1,
    layoutPreset: DEFAULT_URL_VIEW_STATE.layoutPreset,
    chartPlotTypes: [...DEFAULT_URL_VIEW_STATE.chartPlotTypes],
    audioInputMode: DEFAULT_URL_VIEW_STATE.audioInputMode,
    simulatorPreset: DEFAULT_URL_VIEW_STATE.simulatorPreset,
    splWeighting: DEFAULT_URL_VIEW_STATE.splWeighting,
    splTime: DEFAULT_URL_VIEW_STATE.splTime,
    selectedSourceId: DEFAULT_URL_VIEW_STATE.selectedSourceId,
    liveSourceVisible: true,
    measConfig: {
      fftSize: DEFAULT_MEASUREMENT_CONFIG.fftSize,
      windowType: DEFAULT_MEASUREMENT_CONFIG.windowType,
      averagingType: DEFAULT_MEASUREMENT_CONFIG.averagingType,
      fifoDepth: DEFAULT_MEASUREMENT_CONFIG.fifoDepth,
      lpfCutoffHz: DEFAULT_MEASUREMENT_CONFIG.lpfCutoffHz,
      octaveSmoothing: DEFAULT_MEASUREMENT_CONFIG.octaveSmoothing,
      estimator: DEFAULT_MEASUREMENT_CONFIG.estimator,
      delayMs: DEFAULT_MEASUREMENT_CONFIG.delayMs,
      gainDb: DEFAULT_MEASUREMENT_CONFIG.gainDb,
      inputFilter: DEFAULT_MEASUREMENT_CONFIG.inputFilter,
      invertPolarity: DEFAULT_MEASUREMENT_CONFIG.invertPolarity,
    },
    activeCalibrationId: null,
    genConfig: {
      enabled: DEFAULT_GENERATOR_CONFIG.enabled,
      type: DEFAULT_GENERATOR_CONFIG.type,
      levelDbFs: DEFAULT_GENERATOR_CONFIG.levelDbFs,
      sineFrequencyHz: DEFAULT_GENERATOR_CONFIG.sineFrequencyHz,
    },
    hardwareRouting: {
      selectedDeviceId: '',
      selectedDeviceLabel: '',
      measurementChannel: 0,
      referenceChannel: 1,
      generatorOutputChannel: -1,
    },
  };
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadWorkspaceSession(
  storage: Pick<Storage, 'getItem'> | null = getDefaultStorage()
): WorkspaceSessionSnapshotV1 {
  const defaults = createDefaultWorkspaceSession();
  if (!storage) return defaults;

  try {
    const raw = storage.getItem(WORKSPACE_SESSION_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSessionSnapshotV1>;
    if (!parsed || parsed.version !== 1) {
      return defaults;
    }

    return {
      version: 1,
      layoutPreset: parsed.layoutPreset ?? defaults.layoutPreset,
      chartPlotTypes:
        Array.isArray(parsed.chartPlotTypes) && parsed.chartPlotTypes.length > 0
          ? parsed.chartPlotTypes
          : defaults.chartPlotTypes,
      audioInputMode: parsed.audioInputMode ?? defaults.audioInputMode,
      simulatorPreset: parsed.simulatorPreset ?? defaults.simulatorPreset,
      splWeighting: parsed.splWeighting ?? defaults.splWeighting,
      splTime: parsed.splTime ?? defaults.splTime,
      selectedSourceId: parsed.selectedSourceId ?? defaults.selectedSourceId,
      liveSourceVisible:
        typeof parsed.liveSourceVisible === 'boolean'
          ? parsed.liveSourceVisible
          : defaults.liveSourceVisible,
      measConfig: {
        ...defaults.measConfig,
        ...(parsed.measConfig ?? {}),
      },
      activeCalibrationId:
        typeof parsed.activeCalibrationId === 'string'
          ? parsed.activeCalibrationId
          : null,
      genConfig: {
        ...defaults.genConfig,
        ...(parsed.genConfig ?? {}),
      },
      hardwareRouting: {
        ...defaults.hardwareRouting,
        ...(parsed.hardwareRouting ?? {}),
      },
    };
  } catch {
    return defaults;
  }
}

export function saveWorkspaceSession(
  snapshot: WorkspaceSessionSnapshotV1,
  storage: Pick<Storage, 'setItem'> | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(WORKSPACE_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota or private-mode errors
  }
}
