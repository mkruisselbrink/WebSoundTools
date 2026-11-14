// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Typed message protocol and slot configuration shared between `AudioEngine` and `dsp.worker.ts`.
 */

import type { RingBufferStorage } from '../audio/ring-buffer.js';
import type { MeasurementPipelineConfig } from './analyzer-pipeline.js';
import type { SignalGeneratorConfig } from './signal-generator.js';
import type { SplHistoryCheckpoint, SplHistoryWindowSec } from './spl-history.js';
import type { SimulatorPresetId, SimulatorRigConfig } from './synthetic-rig.js';

export type InputSourceMode = 'simulator' | 'hardware';

export interface LiveMeasurementSlotConfig {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
  readonly simulatorPreset: SimulatorPresetId;
  readonly measurementChannel: number;
  /** -2 = Follow Global Ref, -1 = Internal Generator Loopback, >=0 = Physical In Ch */
  readonly referenceChannel: number;
  readonly config: MeasurementPipelineConfig;
  readonly activeCalibrationId: string | null;
}

export type WorkerInboundMessage =
  | { type: 'init'; sampleRate: number; ringBufferStorage?: RingBufferStorage }
  | { type: 'set-input-mode'; mode: InputSourceMode }
  | {
      type: 'sync-live-slots';
      slots: readonly LiveMeasurementSlotConfig[];
      channelTapMap: Record<number, number>;
      globalReferenceChannel?: number;
    }
  | {
      type: 'set-simulator-preset';
      slotId: string;
      preset: SimulatorPresetId | SimulatorRigConfig;
    }
  | {
      type: 'update-measurement-config';
      slotId: string;
      config: Partial<MeasurementPipelineConfig>;
    }
  | { type: 'update-generator-config'; config: Partial<SignalGeneratorConfig> }
  | { type: 'load-calibration'; slotId: string; text: string; name: string }
  | { type: 'clear-calibration'; slotId: string }
  | { type: 'find-delay'; slotId: string }
  | { type: 'apply-estimated-delay'; slotId: string }
  | { type: 'reset-averaging'; slotId?: string }
  | { type: 'reset-spl-history'; slotId?: string }
  | { type: 'set-spl-history-window'; windowSec: SplHistoryWindowSec }
  | { type: 'hydrate-spl-history'; checkpoints: readonly SplHistoryCheckpoint[] }
  | { type: 'export-spl-csv' }
  | { type: 'audio-chunk'; channels: Float32Array[] }
  | { type: 'pause'; paused: boolean };
