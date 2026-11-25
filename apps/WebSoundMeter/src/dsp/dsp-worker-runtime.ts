// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure, zero-DOM multi-slot DSP & 32-channel Mixer Watch worker runtime.
 *
 * Instantiated by `dsp.worker.ts` in production and directly by Vitest unit tests
 * without requiring Web Worker globals or timers.
 */

import { parseCalibrationFile } from '@foh/acoustics';
import {
  INTERNAL_LOOPBACK_SLOT_INDEX,
  MIXER_CAPTURE_TAP_SLOTS,
  MultiChannelRingBuffer,
  TOTAL_RING_BUFFER_SLOTS,
} from '../audio/ring-buffer.js';
import { createDefaultMixerWatchSessionConfig } from '../sources/mixer-patch-storage.js';
import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipeline,
  REFERENCE_CHANNEL_GLOBAL,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
} from './analyzer-pipeline.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
  WorkerInboundMessage,
} from './dsp-worker-protocol.js';
import { resolveFeedbackEvents } from './feedback-culprit-resolver.js';
import type { DetectedFeedbackTrack } from './feedback-detector.js';
import { MixerInputWatchScanner } from './mixer-watch-scanner.js';
import { SignalGenerator } from './signal-generator.js';
import { SimulatedStageMixerRig } from './simulated-stage-mixer-rig.js';
import {
  SplHistoryCheckpoint,
  SplHistoryWindowSec,
  formatSplHistoryCsv,
} from './spl-history.js';
import { SyntheticAcousticRig } from './synthetic-rig.js';

interface LiveSlotRuntime {
  slot: LiveMeasurementSlotConfig;
  pipeline: MeasurementPipeline;
  simulatorRig: SyntheticAcousticRig;
}

export type WorkerPostMessageFn = (msg: Record<string, unknown>) => void;

const SIM_CHUNK_SIZE = 2048;
const HW_READ_CHUNK_SIZE = 4096;

export class DspWorkerRuntime {
  private sampleRate = 48000;
  private inputMode: InputSourceMode = 'simulator';
  private paused = false;
  private channelTapMap: Record<number, number> = { 0: 0, 1: 1 };
  private mixerChannelTapMap: Record<number, number> = {};
  private useSeparateMixerRingBuffer = false;
  private globalReferenceChannel = 1;
  private currentSplWindowSec: SplHistoryWindowSec = 900;
  private ticksSinceCheckpoint = 0;

  private readonly generator = new SignalGenerator(48000);
  private readonly mixerWatchScanner = new MixerInputWatchScanner(48000);
  private readonly stageMixerSim = new SimulatedStageMixerRig(48000);
  private ringBuffer: MultiChannelRingBuffer | null = null;
  private mixerRingBuffer: MultiChannelRingBuffer | null = null;
  private readonly slots = new Map<string, LiveSlotRuntime>();

  private readonly simRefBuf = new Float32Array(SIM_CHUNK_SIZE);
  private readonly simMeasBuf = new Float32Array(SIM_CHUNK_SIZE);
  private readonly hwReadChannels: Float32Array[] = Array.from(
    { length: TOTAL_RING_BUFFER_SLOTS },
    () => new Float32Array(HW_READ_CHUNK_SIZE)
  );
  private readonly mixerHwReadChannels: Float32Array[] = Array.from(
    { length: MIXER_CAPTURE_TAP_SLOTS },
    () => new Float32Array(HW_READ_CHUNK_SIZE)
  );
  private readonly zeroHwChannel = new Float32Array(HW_READ_CHUNK_SIZE);

  constructor(private readonly postMessage: WorkerPostMessageFn) {
    this.mixerWatchScanner.updateConfig(createDefaultMixerWatchSessionConfig());
    this.getOrCreateSlotRuntime('live-measurement');
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  private createDefaultPrimarySlot(): LiveMeasurementSlotConfig {
    return {
      id: 'live-measurement',
      name: 'Live Measurement',
      color: '#38bdf8',
      visible: true,
      simulatorPreset: 'pa-room-modes',
      measurementChannel: 0,
      referenceChannel: REFERENCE_CHANNEL_GLOBAL,
      config: { ...DEFAULT_MEASUREMENT_CONFIG, sampleRate: this.sampleRate },
      activeCalibrationId: null,
    };
  }

  private getOrCreateSlotRuntime(slotId: string): LiveSlotRuntime {
    let rt = this.slots.get(slotId);
    if (!rt) {
      const primary = this.slots.values().next().value;
      const def = this.createDefaultPrimarySlot();
      const sharedPartial = primary
        ? splitMeasurementConfigPartial(primary.slot.config).sharedPartial
        : {};
      const slotCfg: LiveMeasurementSlotConfig = {
        ...def,
        id: slotId,
        config: { ...def.config, ...sharedPartial, sampleRate: this.sampleRate },
      };
      const pipeline = new MeasurementPipeline(slotCfg.config);
      pipeline.setSplHistoryWindowSec(this.currentSplWindowSec);
      rt = {
        slot: slotCfg,
        pipeline,
        simulatorRig: new SyntheticAcousticRig(this.sampleRate, slotCfg.simulatorPreset),
      };
      this.slots.set(slotCfg.id, rt);
    }
    return rt;
  }

  private resolveMixerBusPhysicalChannel(): number {
    const mw = this.mixerWatchScanner.getConfig();
    if (mw.patch.mixBusChannel === -2) {
      return this.useSeparateMixerRingBuffer ? -1 : this.globalReferenceChannel;
    }
    return mw.patch.mixBusChannel;
  }

  private routeHardwareSamplesToSlots(
    channels: readonly Float32Array[],
    sampleCount: number
  ): void {
    const zeroSlice =
      this.zeroHwChannel.length >= sampleCount
        ? this.zeroHwChannel.subarray(0, sampleCount)
        : new Float32Array(sampleCount);

    const loopbackSlotIdx = Math.min(
      INTERNAL_LOOPBACK_SLOT_INDEX,
      Math.max(0, channels.length - 1)
    );

    for (const rt of this.slots.values()) {
      const tapM = this.channelTapMap[rt.slot.measurementChannel];
      const bufM =
        tapM !== undefined && channels[tapM]
          ? channels[tapM].subarray(0, sampleCount)
          : zeroSlice;

      const effectiveRef = resolveEffectiveReferenceChannel(
        rt.slot.referenceChannel,
        this.globalReferenceChannel
      );

      let bufR: Float32Array;
      if (effectiveRef < 0) {
        bufR = channels[loopbackSlotIdx]?.subarray(0, sampleCount) ?? zeroSlice;
      } else {
        const tapR = this.channelTapMap[effectiveRef];
        bufR =
          tapR !== undefined && channels[tapR]
            ? channels[tapR].subarray(0, sampleCount)
            : zeroSlice;
      }
      rt.pipeline.writeSamples(bufM, bufR, sampleCount);
    }

    if (!this.useSeparateMixerRingBuffer && this.mixerWatchScanner.getConfig().enabled) {
      this.mixerWatchScanner.writeHardwareSamples(
        channels,
        this.mixerChannelTapMap,
        sampleCount,
        this.resolveMixerBusPhysicalChannel()
      );
    }
  }

  private propagateSampleRate(nextSr: number): void {
    this.sampleRate = nextSr;
    this.generator.setSampleRate(nextSr);
    this.stageMixerSim.setSampleRate(nextSr);
    if (!this.useSeparateMixerRingBuffer) {
      this.mixerWatchScanner.setSampleRate(nextSr);
    }
    for (const rt of this.slots.values()) {
      rt.simulatorRig.setSampleRate(nextSr);
      rt.pipeline.updateConfig({ sampleRate: nextSr });
    }
  }

  public tick(dtSeconds: number, nowEpochMs: number = Date.now()): void {
    if (this.paused) return;
    const clampedDt = Math.max(0.005, Math.min(0.25, dtSeconds));

    try {
      if (this.inputMode === 'simulator') {
        this.generator.fillBuffer(this.simRefBuf, SIM_CHUNK_SIZE);
        let anySimFeedbackPreset = false;
        for (const rt of this.slots.values()) {
          rt.simulatorRig.processBlock(this.simRefBuf, this.simMeasBuf, SIM_CHUNK_SIZE);
          rt.pipeline.writeSamples(this.simMeasBuf, this.simRefBuf, SIM_CHUNK_SIZE);
          if ((rt.simulatorRig.getConfig().simulatedFeedbackRings?.length ?? 0) > 0) {
            anySimFeedbackPreset = true;
          }
        }
        const mwCfg = this.mixerWatchScanner.getConfig();
        if (mwCfg.enabled) {
          this.stageMixerSim.processBlock(SIM_CHUNK_SIZE, anySimFeedbackPreset);
          const busForSim =
            mwCfg.patch.mixBusChannel === -1
              ? undefined
              : this.stageMixerSim.busOut.subarray(0, SIM_CHUNK_SIZE);
          this.mixerWatchScanner.writeDirectChannelMap(
            this.stageMixerSim.channelMap,
            SIM_CHUNK_SIZE,
            busForSim
          );
        }
      } else {
        if (this.ringBuffer) {
          let avail = this.ringBuffer.availableRead();
          while (avail > 0) {
            const toRead = Math.min(avail, HW_READ_CHUNK_SIZE);
            const readCount = this.ringBuffer.read(this.hwReadChannels, toRead);
            if (readCount <= 0) break;
            this.routeHardwareSamplesToSlots(this.hwReadChannels, readCount);
            avail -= readCount;
          }
        }
        if (
          this.useSeparateMixerRingBuffer &&
          this.mixerRingBuffer &&
          this.mixerWatchScanner.getConfig().enabled
        ) {
          let mAvail = this.mixerRingBuffer.availableRead();
          while (mAvail > 0) {
            const toRead = Math.min(mAvail, HW_READ_CHUNK_SIZE);
            const readCount = this.mixerRingBuffer.read(this.mixerHwReadChannels, toRead);
            if (readCount <= 0) break;
            this.mixerWatchScanner.writeHardwareSamples(
              this.mixerHwReadChannels,
              this.mixerChannelTapMap,
              readCount,
              this.resolveMixerBusPhysicalChannel()
            );
            mAvail -= readCount;
          }
        }
      }

      const rawFrames = [];
      const slotTracksMap = new Map<string, readonly DetectedFeedbackTrack[]>();
      for (const rt of this.slots.values()) {
        const snapshot = rt.pipeline.computeTransform(clampedDt);
        const frame = {
          ...snapshot,
          id: rt.slot.id,
          name: rt.slot.name,
          color: rt.slot.color,
          visible: rt.slot.visible,
        };
        rawFrames.push(frame);
        slotTracksMap.set(frame.id, frame.feedbackTracks ?? []);
      }

      const mwCfg = this.mixerWatchScanner.getConfig();
      let mixerLevelsDbFs: Record<number, number> = {};
      let mixerOnlyFeedbackTracks: DetectedFeedbackTrack[] = [];
      let finalFrames = rawFrames;

      if (mwCfg.enabled) {
        const mixerRes = this.mixerWatchScanner.processTick(clampedDt);
        mixerLevelsDbFs = mixerRes.channelLevelsDbFs;
        const resolved = resolveFeedbackEvents({
          slotTracksBySlotId: slotTracksMap,
          mixerObservations: mixerRes.observations,
          tapMode: mwCfg.patch.tapMode,
          hasActiveMixBus: mixerRes.hasActiveMixBus,
          enabledWatchChannelCount: mixerRes.enabledChannelCount,
        });
        mixerOnlyFeedbackTracks = resolved.mixerOnlyTracks;
        finalFrames = rawFrames.map((f) => ({
          ...f,
          feedbackTracks:
            resolved.enrichedSlotTracksBySlotId.get(f.id) ?? f.feedbackTracks,
        }));
      }

      if (finalFrames.length > 0) {
        this.postMessage({
          type: 'measurement-frames',
          frames: finalFrames,
          mixerTelemetry: {
            channelLevelsDbFs: mixerLevelsDbFs,
            mixerOnlyFeedbackTracks,
          },
        });
      }

      this.ticksSinceCheckpoint++;
      if (this.ticksSinceCheckpoint >= 250) {
        this.ticksSinceCheckpoint = 0;
        const checkpoints: SplHistoryCheckpoint[] = [];
        for (const rt of this.slots.values()) {
          const tracker = rt.pipeline.getSplHistoryTracker();
          if (tracker.getTierBCount() > 0) {
            checkpoints.push(tracker.serializeCheckpoint(rt.slot.id, nowEpochMs));
          }
        }
        if (checkpoints.length > 0) {
          this.postMessage({
            type: 'spl-history-checkpoints',
            checkpoints,
          });
        }
      }
    } catch (err) {
      this.postMessage({
        type: 'worker-error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public handleMessage(msg: WorkerInboundMessage): void {
    try {
      switch (msg.type) {
        case 'init':
          this.propagateSampleRate(msg.sampleRate || 48000);
          if (msg.ringBufferStorage) {
            this.ringBuffer = new MultiChannelRingBuffer(msg.ringBufferStorage);
          }
          if (msg.mixerRingBufferStorage) {
            this.mixerRingBuffer = new MultiChannelRingBuffer(
              msg.mixerRingBufferStorage
            );
          }
          break;

        case 'set-input-mode':
          if (msg.mode === 'hardware') {
            this.ringBuffer?.clear();
            this.mixerRingBuffer?.clear();
          }
          this.inputMode = msg.mode;
          this.mixerWatchScanner.reset();
          this.stageMixerSim.reset();
          for (const rt of this.slots.values()) {
            rt.pipeline.resetAveraging();
          }
          break;

        case 'sync-live-slots': {
          this.channelTapMap = { ...msg.channelTapMap };
          if (!this.useSeparateMixerRingBuffer) {
            this.mixerChannelTapMap = { ...msg.channelTapMap };
          }
          const prevGlobalRef = this.globalReferenceChannel;
          if (typeof msg.globalReferenceChannel === 'number') {
            this.globalReferenceChannel = msg.globalReferenceChannel;
          }
          const incomingIds = new Set(msg.slots.map((s) => s.id));
          for (const existingId of Array.from(this.slots.keys())) {
            if (!incomingIds.has(existingId)) {
              this.slots.delete(existingId);
            }
          }
          for (const slotCfg of msg.slots) {
            const existing = this.slots.get(slotCfg.id);
            if (existing) {
              const presetChanged =
                existing.slot.simulatorPreset !== slotCfg.simulatorPreset;
              const prevEffectiveRef = resolveEffectiveReferenceChannel(
                existing.slot.referenceChannel,
                prevGlobalRef
              );
              const nextEffectiveRef = resolveEffectiveReferenceChannel(
                slotCfg.referenceChannel,
                this.globalReferenceChannel
              );
              const channelChanged =
                existing.slot.measurementChannel !== slotCfg.measurementChannel ||
                prevEffectiveRef !== nextEffectiveRef;
              existing.slot = slotCfg;
              existing.pipeline.updateConfig({
                ...slotCfg.config,
                sampleRate: this.sampleRate,
              });
              if (presetChanged) {
                existing.simulatorRig.setConfig(slotCfg.simulatorPreset);
                existing.pipeline.resetAveraging();
              } else if (channelChanged && this.inputMode === 'hardware') {
                existing.pipeline.resetAveraging();
              }
            } else {
              const pipeline = new MeasurementPipeline({
                ...slotCfg.config,
                sampleRate: this.sampleRate,
              });
              pipeline.setSplHistoryWindowSec(this.currentSplWindowSec);
              const simulatorRig = new SyntheticAcousticRig(
                this.sampleRate,
                slotCfg.simulatorPreset
              );
              this.slots.set(slotCfg.id, { slot: slotCfg, pipeline, simulatorRig });
            }
          }
          break;
        }

        case 'sync-mixer-watch': {
          const nextSeparate = Boolean(msg.useSeparateRingBuffer);
          if (nextSeparate !== this.useSeparateMixerRingBuffer) {
            this.mixerRingBuffer?.clear();
            this.mixerWatchScanner.reset();
          }
          this.useSeparateMixerRingBuffer = nextSeparate;
          this.mixerChannelTapMap = { ...msg.channelTapMap };
          const targetSr =
            this.inputMode === 'simulator'
              ? this.sampleRate
              : msg.mixerSampleRate || this.sampleRate;
          this.mixerWatchScanner.setSampleRate(targetSr);
          this.mixerWatchScanner.updateConfig(msg.config);
          break;
        }

        case 'set-simulator-preset': {
          const rt = this.getOrCreateSlotRuntime(msg.slotId);
          rt.simulatorRig.setConfig(msg.preset);
          if (typeof msg.preset === 'string') {
            rt.slot = { ...rt.slot, simulatorPreset: msg.preset };
          }
          rt.pipeline.resetAveraging();
          this.mixerWatchScanner.reset();
          this.postMessage({
            type: 'simulator-config-updated',
            slotId: rt.slot.id,
            config: rt.simulatorRig.getConfig(),
          });
          break;
        }

        case 'update-measurement-config': {
          if (
            msg.config.sampleRate !== undefined &&
            msg.config.sampleRate !== this.sampleRate
          ) {
            this.propagateSampleRate(msg.config.sampleRate);
          }
          const { sharedPartial, perSlotPartial } = splitMeasurementConfigPartial(
            msg.config
          );
          const hasShared = Object.keys(sharedPartial).length > 0;
          if (hasShared) {
            for (const item of this.slots.values()) {
              item.pipeline.updateConfig(sharedPartial);
              item.slot = { ...item.slot, config: item.pipeline.getConfig() };
            }
          }
          const rt = this.getOrCreateSlotRuntime(msg.slotId);
          if (Object.keys(perSlotPartial).length > 0) {
            rt.pipeline.updateConfig(perSlotPartial);
            rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
          }
          if (hasShared) {
            for (const item of this.slots.values()) {
              this.postMessage({
                type: 'measurement-config-updated',
                slotId: item.slot.id,
                config: item.pipeline.getConfig(),
              });
            }
          } else {
            this.postMessage({
              type: 'measurement-config-updated',
              slotId: rt.slot.id,
              config: rt.pipeline.getConfig(),
            });
          }
          break;
        }

        case 'update-generator-config':
          this.generator.updateConfig(msg.config);
          break;

        case 'load-calibration': {
          const rt = this.getOrCreateSlotRuntime(msg.slotId);
          const curve = parseCalibrationFile(msg.text, msg.name);
          rt.pipeline.setCalibrationCurve(curve);
          rt.pipeline.updateConfig({ calibrationEnabled: curve.points.length > 0 });
          rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
          this.postMessage({
            type: 'calibration-loaded',
            slotId: rt.slot.id,
            name: curve.name,
            pointCount: curve.points.length,
          });
          break;
        }

        case 'clear-calibration': {
          const rt = this.getOrCreateSlotRuntime(msg.slotId);
          rt.pipeline.setCalibrationCurve(null);
          rt.pipeline.updateConfig({ calibrationEnabled: false });
          rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
          break;
        }

        case 'find-delay': {
          const rt = this.getOrCreateSlotRuntime(msg.slotId);
          const est = rt.pipeline.findDelayNow();
          this.postMessage({
            type: 'delay-found',
            slotId: rt.slot.id,
            estimate: est,
          });
          break;
        }

        case 'apply-estimated-delay': {
          const rt = this.getOrCreateSlotRuntime(msg.slotId);
          const est = rt.pipeline.findDelayNow();
          const roundedMs = Math.round(est.delayMs * 100) / 100;
          rt.pipeline.updateConfig({ delayMs: roundedMs });
          rt.slot = { ...rt.slot, config: rt.pipeline.getConfig() };
          this.postMessage({
            type: 'measurement-config-updated',
            slotId: rt.slot.id,
            config: rt.pipeline.getConfig(),
          });
          break;
        }

        case 'reset-averaging': {
          if (msg.slotId) {
            this.getOrCreateSlotRuntime(msg.slotId).pipeline.resetAveraging();
          } else {
            for (const rt of this.slots.values()) {
              rt.pipeline.resetAveraging();
            }
            this.mixerWatchScanner.reset();
          }
          const frames = Array.from(this.slots.values()).map((rt) => ({
            ...rt.pipeline.getSnapshot(),
            id: rt.slot.id,
            name: rt.slot.name,
            color: rt.slot.color,
            visible: rt.slot.visible,
          }));
          if (frames.length > 0) {
            this.postMessage({
              type: 'measurement-frames',
              frames,
              mixerTelemetry: {
                channelLevelsDbFs: {},
                mixerOnlyFeedbackTracks: [],
              },
            });
          }
          break;
        }

        case 'reset-spl-history': {
          if (msg.slotId) {
            this.getOrCreateSlotRuntime(msg.slotId).pipeline.resetSplHistory();
          } else {
            for (const rt of this.slots.values()) {
              rt.pipeline.resetSplHistory();
            }
          }
          const frames = Array.from(this.slots.values()).map((rt) => ({
            ...rt.pipeline.getSnapshot(),
            id: rt.slot.id,
            name: rt.slot.name,
            color: rt.slot.color,
            visible: rt.slot.visible,
          }));
          if (frames.length > 0) {
            this.postMessage({ type: 'measurement-frames', frames });
          }
          break;
        }

        case 'set-spl-history-window': {
          this.currentSplWindowSec = msg.windowSec;
          const frames = [];
          for (const rt of this.slots.values()) {
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
            this.postMessage({ type: 'measurement-frames', frames });
          }
          break;
        }

        case 'hydrate-spl-history': {
          const frames = [];
          for (const cp of msg.checkpoints) {
            const rt = this.slots.get(cp.id);
            if (rt) {
              rt.pipeline.getSplHistoryTracker().hydrateCheckpoint(cp);
            }
          }
          for (const rt of this.slots.values()) {
            const snapshot = rt.pipeline.computeTransform(0.04);
            frames.push({
              ...snapshot,
              splHistory: rt.pipeline
                .getSplHistoryTracker()
                .exportWindow(this.currentSplWindowSec),
              id: rt.slot.id,
              name: rt.slot.name,
              color: rt.slot.color,
              visible: rt.slot.visible,
            });
          }
          if (frames.length > 0) {
            this.postMessage({ type: 'measurement-frames', frames });
          }
          break;
        }

        case 'export-spl-csv': {
          const slotTrackers = Array.from(this.slots.values()).map((rt) => ({
            slotId: rt.slot.id,
            slotName: rt.slot.name,
            tracker: rt.pipeline.getSplHistoryTracker(),
          }));
          const csv = formatSplHistoryCsv(slotTrackers);
          this.postMessage({ type: 'spl-csv-exported', csv });
          break;
        }

        case 'audio-chunk':
          if (this.inputMode === 'hardware' && !this.paused && msg.channels.length > 0) {
            this.routeHardwareSamplesToSlots(msg.channels, msg.channels[0].length);
          }
          break;

        case 'mixer-audio-chunk':
          if (
            this.inputMode === 'hardware' &&
            !this.paused &&
            this.useSeparateMixerRingBuffer &&
            this.mixerWatchScanner.getConfig().enabled &&
            msg.channels.length > 0
          ) {
            this.mixerWatchScanner.writeHardwareSamples(
              msg.channels,
              this.mixerChannelTapMap,
              msg.channels[0].length,
              this.resolveMixerBusPhysicalChannel()
            );
          }
          break;

        case 'pause':
          this.paused = msg.paused;
          this.ringBuffer?.clear();
          this.mixerRingBuffer?.clear();
          break;
      }
    } catch (err) {
      this.postMessage({
        type: 'worker-error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
