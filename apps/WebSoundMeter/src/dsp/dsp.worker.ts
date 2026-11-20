// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dedicated Background DSP Web Worker (`dsp.worker.ts`) running multi-slot
 * `MeasurementPipeline` instances at 25 Hz in either hardware or simulator mode.
 */

import { parseCalibrationFile } from '@foh/acoustics';
import {
  INTERNAL_LOOPBACK_SLOT_INDEX,
  MultiChannelRingBuffer,
  TOTAL_RING_BUFFER_SLOTS,
} from '../audio/ring-buffer.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipeline,
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
} from './analyzer-pipeline.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
  WorkerInboundMessage,
} from './dsp-worker-protocol.js';
import { SignalGenerator } from './signal-generator.js';
import {
  SplHistoryCheckpoint,
  SplHistoryWindowSec,
  formatSplHistoryCsv,
} from './spl-history.js';
import { SIMULATOR_PRESETS, SyntheticAcousticRig } from './synthetic-rig.js';

export {
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
};
export type { InputSourceMode, LiveMeasurementSlotConfig, WorkerInboundMessage };

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
let currentSplWindowSec: SplHistoryWindowSec = 900;

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
    const pipeline = new MeasurementPipeline(slotCfg.config);
    pipeline.setSplHistoryWindowSec(currentSplWindowSec);
    rt = {
      slot: slotCfg,
      pipeline,
      simulatorRig: new SyntheticAcousticRig(sampleRate, slotCfg.simulatorPreset),
    };
    slots.set(slotCfg.id, rt);
  }
  return rt;
}

getOrCreateSlotRuntime('live-measurement');

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

const intervalId = setInterval(tick, 40);

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
            pipeline.setSplHistoryWindowSec(currentSplWindowSec);
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

      case 'reset-averaging': {
        if (msg.slotId) {
          getOrCreateSlotRuntime(msg.slotId).pipeline.resetAveraging();
        } else {
          for (const rt of slots.values()) {
            rt.pipeline.resetAveraging();
          }
        }
        const frames = Array.from(slots.values()).map((rt) => ({
          ...rt.pipeline.getSnapshot(),
          id: rt.slot.id,
          name: rt.slot.name,
          color: rt.slot.color,
          visible: rt.slot.visible,
        }));
        if (frames.length > 0) {
          self.postMessage({ type: 'measurement-frames', frames });
        }
        break;
      }

      case 'reset-spl-history': {
        if (msg.slotId) {
          getOrCreateSlotRuntime(msg.slotId).pipeline.resetSplHistory();
        } else {
          for (const rt of slots.values()) {
            rt.pipeline.resetSplHistory();
          }
        }
        const frames = Array.from(slots.values()).map((rt) => ({
          ...rt.pipeline.getSnapshot(),
          id: rt.slot.id,
          name: rt.slot.name,
          color: rt.slot.color,
          visible: rt.slot.visible,
        }));
        if (frames.length > 0) {
          self.postMessage({ type: 'measurement-frames', frames });
        }
        break;
      }

      case 'set-spl-history-window': {
        currentSplWindowSec = msg.windowSec;
        const frames = [];
        for (const rt of slots.values()) {
          rt.pipeline.setSplHistoryWindowSec(msg.windowSec);
          const snapshot = rt.pipeline.computeTransform(0.04);
          frames.push({
            ...snapshot,
            splHistory: rt.pipeline
              .getSplHistoryTracker()
              .exportWindow(msg.windowSec),
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
        break;
      }

      case 'hydrate-spl-history': {
        const frames = [];
        for (const cp of msg.checkpoints) {
          const rt = slots.get(cp.id);
          if (rt) {
            rt.pipeline.getSplHistoryTracker().hydrateCheckpoint(cp);
          }
        }
        for (const rt of slots.values()) {
          const snapshot = rt.pipeline.computeTransform(0.04);
          frames.push({
            ...snapshot,
            splHistory: rt.pipeline
              .getSplHistoryTracker()
              .exportWindow(currentSplWindowSec),
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
        break;
      }

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

export { intervalId, SIMULATOR_PRESETS };
