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
 * Dedicated Background DSP Web Worker (`dsp.worker.ts`).
 *
 * Runs one or more simultaneous `MeasurementPipeline` slots at ~25 Hz, reading either:
 *  - Real-time multi-channel hardware samples from `MultiChannelRingBuffer` (in 'hardware' mode), OR
 *  - Deterministic simulated PA/room samples per slot from `SignalGenerator` + `SyntheticAcousticRig`
 *    (in 'simulator' mode).
 */

import {
  INTERNAL_LOOPBACK_SLOT_INDEX,
  MultiChannelRingBuffer,
  RingBufferStorage,
  TOTAL_RING_BUFFER_SLOTS,
} from '../audio/ring-buffer.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipeline,
  MeasurementPipelineConfig,
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
} from './analyzer-pipeline.js';
import { parseCalibrationFile } from './calibration.js';
import {
  SignalGenerator,
  SignalGeneratorConfig,
} from './signal-generator.js';
import {
  formatSplHistoryCsv,
  SplHistoryCheckpoint,
  SplHistoryWindowSec,
} from './spl-history.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
  SimulatorRigConfig,
  SyntheticAcousticRig,
} from './synthetic-rig.js';

export {
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
};

export type InputSourceMode = 'simulator' | 'hardware';

export interface LiveMeasurementSlotConfig {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
  readonly simulatorPreset: SimulatorPresetId;
  readonly measurementChannel: number;
  readonly referenceChannel: number; // -2 = Follow Global Ref, -1 = Internal Generator Loopback, >=0 = Physical In Ch
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

interface LiveSlotRuntime {
  slot: LiveMeasurementSlotConfig;
  pipeline: MeasurementPipeline;
  simulatorRig: SyntheticAcousticRig;
}

let sampleRate = 48000;
let inputMode: InputSourceMode = 'simulator';
let isPaused = false;
let channelTapMap: Record<number, number> = { 0: 0, 1: 1 };
let globalReferenceChannel = 1;

const generator = new SignalGenerator(sampleRate);
let ringBuffer: MultiChannelRingBuffer | null = null;

const slots = new Map<string, LiveSlotRuntime>();

function createDefaultPrimarySlot(): LiveMeasurementSlotConfig {
  return {
    id: 'live-measurement',
    name: 'Live Measurement',
    color: '#38bdf8',
    visible: true,
    simulatorPreset: 'pa-room-modes',
    measurementChannel: 0,
    referenceChannel: REFERENCE_CHANNEL_GLOBAL,
    config: { ...DEFAULT_MEASUREMENT_CONFIG, sampleRate },
    activeCalibrationId: null,
  };
}

function getOrCreateSlotRuntime(slotId: string): LiveSlotRuntime {
  let rt = slots.get(slotId);
  if (!rt) {
    const primary = slots.values().next().value;
    const def = createDefaultPrimarySlot();
    const sharedPartial = primary
      ? splitMeasurementConfigPartial(primary.slot.config).sharedPartial
      : {};
    const slotCfg: LiveMeasurementSlotConfig = {
      ...def,
      id: slotId,
      config: { ...def.config, ...sharedPartial, sampleRate },
    };
    rt = {
      slot: slotCfg,
      pipeline: new MeasurementPipeline(slotCfg.config),
      simulatorRig: new SyntheticAcousticRig(sampleRate, slotCfg.simulatorPreset),
    };
    slots.set(slotCfg.id, rt);
  }
  return rt;
}

// Initialize primary slot immediately
getOrCreateSlotRuntime('live-measurement');

// Scratch buffers for simulation & multi-channel ring buffer draining
const simChunkSize = 2048;
const simRefBuf = new Float32Array(simChunkSize);
const simMeasBuf = new Float32Array(simChunkSize);
const hwReadChunkSize = 4096;
const hwReadChannels: Float32Array[] = Array.from(
  { length: TOTAL_RING_BUFFER_SLOTS },
  () => new Float32Array(hwReadChunkSize)
);
const zeroHwChannel = new Float32Array(hwReadChunkSize);

function routeHardwareSamplesToSlots(
  channels: readonly Float32Array[],
  sampleCount: number
): void {
  const zeroSlice =
    zeroHwChannel.length >= sampleCount
      ? zeroHwChannel.subarray(0, sampleCount)
      : new Float32Array(sampleCount);

  for (const rt of slots.values()) {
    const tapM = channelTapMap[rt.slot.measurementChannel];
    const bufM =
      tapM !== undefined && channels[tapM]
        ? channels[tapM].subarray(0, sampleCount)
        : zeroSlice;

    const effectiveRef = resolveEffectiveReferenceChannel(
      rt.slot.referenceChannel,
      globalReferenceChannel
    );

    let bufR: Float32Array;
    if (effectiveRef < 0) {
      bufR =
        channels[INTERNAL_LOOPBACK_SLOT_INDEX]?.subarray(0, sampleCount) ?? zeroSlice;
    } else {
      const tapR = channelTapMap[effectiveRef];
      bufR =
        tapR !== undefined && channels[tapR]
          ? channels[tapR].subarray(0, sampleCount)
          : zeroSlice;
    }
    rt.pipeline.writeSamples(bufM, bufR, sampleCount);
  }
}

let lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let ticksSinceCheckpoint = 0;

function tick(): void {
  if (isPaused) {
    lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return;
  }

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dtSeconds = Math.max(0.005, Math.min(0.25, (now - lastTickTime) / 1000.0));
  lastTickTime = now;

  try {
    if (inputMode === 'simulator') {
      // Synthesize ~42.6 ms (2048 samples at 48 kHz) shared reference block per tick
      generator.fillBuffer(simRefBuf, simChunkSize);
      for (const rt of slots.values()) {
        rt.simulatorRig.processBlock(simRefBuf, simMeasBuf, simChunkSize);
        rt.pipeline.writeSamples(simMeasBuf, simRefBuf, simChunkSize);
      }
    } else if (ringBuffer) {
      let avail = ringBuffer.availableRead();
      while (avail > 0) {
        const toRead = Math.min(avail, hwReadChunkSize);
        const readCount = ringBuffer.read(hwReadChannels, toRead);
        if (readCount <= 0) break;
        routeHardwareSamplesToSlots(hwReadChannels, readCount);
        avail -= readCount;
      }
    }

    const frames = [];
    for (const rt of slots.values()) {
      const snapshot = rt.pipeline.computeTransform(dtSeconds);
      frames.push({
        ...snapshot,
        id: rt.slot.id,
        name: rt.slot.name,
        color: rt.slot.color,
        visible: rt.slot.visible,
      });
    }

    if (frames.length > 0) {
      self.postMessage({
        type: 'measurement-frames',
        frames,
      });
    }

    // Every 250 ticks (~10 seconds at 25 Hz), emit batched SPL history checkpoints for crash recovery
    ticksSinceCheckpoint++;
    if (ticksSinceCheckpoint >= 250) {
      ticksSinceCheckpoint = 0;
      const checkpoints: SplHistoryCheckpoint[] = [];
      const nowMs = Date.now();
      for (const rt of slots.values()) {
        const tracker = rt.pipeline.getSplHistoryTracker();
        if (tracker.getTierBCount() > 0) {
          checkpoints.push(tracker.serializeCheckpoint(rt.slot.id, nowMs));
        }
      }
      if (checkpoints.length > 0) {
        self.postMessage({
          type: 'spl-history-checkpoints',
          checkpoints,
        });
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'worker-error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const intervalId = setInterval(tick, 40); // 25 FPS DSP transform rate

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  try {
    switch (msg.type) {
      case 'init':
        sampleRate = msg.sampleRate || 48000;
        generator.setSampleRate(sampleRate);
        for (const rt of slots.values()) {
          rt.pipeline.updateConfig({ sampleRate });
          rt.simulatorRig.setSampleRate(sampleRate);
        }
        if (msg.ringBufferStorage) {
          ringBuffer = new MultiChannelRingBuffer(msg.ringBufferStorage);
        }
        break;

      case 'set-input-mode':
        if (msg.mode === 'hardware' && ringBuffer) {
          ringBuffer.clear();
        }
        inputMode = msg.mode;
        for (const rt of slots.values()) {
          rt.pipeline.resetAveraging();
        }
        break;

      case 'sync-live-slots': {
        channelTapMap = { ...msg.channelTapMap };
        const prevGlobalRef = globalReferenceChannel;
        if (typeof msg.globalReferenceChannel === 'number') {
          globalReferenceChannel = msg.globalReferenceChannel;
        }
        const incomingIds = new Set(msg.slots.map((s) => s.id));
        for (const existingId of Array.from(slots.keys())) {
          if (!incomingIds.has(existingId)) {
            slots.delete(existingId);
          }
        }
        for (const slotCfg of msg.slots) {
          const existing = slots.get(slotCfg.id);
          if (existing) {
            const presetChanged =
              existing.slot.simulatorPreset !== slotCfg.simulatorPreset;
            const prevEffectiveRef = resolveEffectiveReferenceChannel(
              existing.slot.referenceChannel,
              prevGlobalRef
            );
            const nextEffectiveRef = resolveEffectiveReferenceChannel(
              slotCfg.referenceChannel,
              globalReferenceChannel
            );
            const channelChanged =
              existing.slot.measurementChannel !== slotCfg.measurementChannel ||
              prevEffectiveRef !== nextEffectiveRef;
            existing.slot = slotCfg;
            existing.pipeline.updateConfig({ ...slotCfg.config, sampleRate });
            if (presetChanged) {
              existing.simulatorRig.setConfig(slotCfg.simulatorPreset);
              existing.pipeline.resetAveraging();
            } else if (channelChanged && inputMode === 'hardware') {
              existing.pipeline.resetAveraging();
            }
          } else {
            const pipeline = new MeasurementPipeline({
              ...slotCfg.config,
              sampleRate,
            });
            const simulatorRig = new SyntheticAcousticRig(
              sampleRate,
              slotCfg.simulatorPreset
            );
            slots.set(slotCfg.id, { slot: slotCfg, pipeline, simulatorRig });
          }
        }
        break;
      }

      case 'set-simulator-preset': {
        const rt = getOrCreateSlotRuntime(msg.slotId);
        rt.simulatorRig.setConfig(msg.preset);
        if (typeof msg.preset === 'string') {
          rt.slot = { ...rt.slot, simulatorPreset: msg.preset };
        }
        rt.pipeline.resetAveraging();
        self.postMessage({
          type: 'simulator-config-updated',
          slotId: rt.slot.id,
          config: rt.simulatorRig.getConfig(),
        });
        break;
      }

      case 'update-measurement-config': {
        if (
          msg.config.sampleRate !== undefined &&
          msg.config.sampleRate !== sampleRate
        ) {
          sampleRate = msg.config.sampleRate;
          generator.setSampleRate(sampleRate);
          for (const item of slots.values()) {
            item.simulatorRig.setSampleRate(sampleRate);
            item.pipeline.updateConfig({ sampleRate });
          }
        }
        const { sharedPartial, perSlotPartial } = splitMeasurementConfigPartial(
          msg.config
        );
        const hasShared = Object.keys(sharedPartial).length > 0;
        if (hasShared) {
          for (const item of slots.values()) {
            item.pipeline.updateConfig(sharedPartial);
            item.slot = { ...item.slot, config: item.pipeline.getConfig() };
          }
        }
        const rt = getOrCreateSlotRuntime(msg.slotId);
        if (Object.keys(perSlotPartial).length > 0) {
          rt.pipeline.updateConfig(perSlotPartial);
          rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
        }
        if (hasShared) {
          for (const item of slots.values()) {
            self.postMessage({
              type: 'measurement-config-updated',
              slotId: item.slot.id,
              config: item.pipeline.getConfig(),
            });
          }
        } else {
          self.postMessage({
            type: 'measurement-config-updated',
            slotId: rt.slot.id,
            config: rt.pipeline.getConfig(),
          });
        }
        break;
      }

      case 'update-generator-config':
        generator.updateConfig(msg.config);
        break;

      case 'load-calibration': {
        const rt = getOrCreateSlotRuntime(msg.slotId);
        const curve = parseCalibrationFile(msg.text, msg.name);
        rt.pipeline.setCalibrationCurve(curve);
        rt.pipeline.updateConfig({ calibrationEnabled: curve.points.length > 0 });
        rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
        self.postMessage({
          type: 'calibration-loaded',
          slotId: rt.slot.id,
          name: curve.name,
          pointCount: curve.points.length,
        });
        break;
      }

      case 'clear-calibration': {
        const rt = getOrCreateSlotRuntime(msg.slotId);
        rt.pipeline.setCalibrationCurve(null);
        rt.pipeline.updateConfig({ calibrationEnabled: false });
        rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
        break;
      }

      case 'find-delay': {
        const rt = getOrCreateSlotRuntime(msg.slotId);
        const est = rt.pipeline.findDelayNow();
        self.postMessage({
          type: 'delay-found',
          slotId: rt.slot.id,
          estimate: est,
        });
        break;
      }

      case 'apply-estimated-delay': {
        const rt = getOrCreateSlotRuntime(msg.slotId);
        const est = rt.pipeline.findDelayNow();
        const roundedMs = Math.round(est.delayMs * 100) / 100;
        rt.pipeline.updateConfig({ delayMs: roundedMs });
        rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
        self.postMessage({
          type: 'measurement-config-updated',
          slotId: rt.slot.id,
          config: rt.pipeline.getConfig(),
        });
        break;
      }

      case 'reset-averaging':
        if (msg.slotId) {
          getOrCreateSlotRuntime(msg.slotId).pipeline.resetAveraging();
        } else {
          for (const rt of slots.values()) {
            rt.pipeline.resetAveraging();
          }
        }
        break;

      case 'reset-spl-history':
        if (msg.slotId) {
          getOrCreateSlotRuntime(msg.slotId).pipeline.resetSplHistory();
        } else {
          for (const rt of slots.values()) {
            rt.pipeline.resetSplHistory();
          }
        }
        break;

      case 'set-spl-history-window':
        for (const rt of slots.values()) {
          rt.pipeline.setSplHistoryWindowSec(msg.windowSec);
        }
        break;

      case 'hydrate-spl-history':
        for (const cp of msg.checkpoints) {
          const rt = slots.get(cp.id);
          if (rt) {
            rt.pipeline.getSplHistoryTracker().hydrateCheckpoint(cp);
          }
        }
        break;

      case 'export-spl-csv': {
        const slotTrackers = Array.from(slots.values()).map((rt) => ({
          slotId: rt.slot.id,
          slotName: rt.slot.name,
          tracker: rt.pipeline.getSplHistoryTracker(),
        }));
        const csv = formatSplHistoryCsv(slotTrackers);
        self.postMessage({
          type: 'spl-csv-exported',
          csv,
        });
        break;
      }

      case 'audio-chunk':
        if (inputMode === 'hardware' && !isPaused && msg.channels.length > 0) {
          routeHardwareSamplesToSlots(msg.channels, msg.channels[0].length);
        }
        break;

      case 'pause':
        isPaused = msg.paused;
        if (ringBuffer) {
          ringBuffer.clear();
        }
        break;
    }
  } catch (err) {
    self.postMessage({
      type: 'worker-error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// Exported for unit test teardown (clearInterval) and simulator preset lookup
export { intervalId, SIMULATOR_PRESETS };
