// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * AudioEngine & Multi-Slot DSP Worker Controller.
 *
 * Manages background `dsp.worker.ts` lifecycle, multi-slot Live Measurement configurations
 * via `LiveSlotManager`, message dispatch, and physical hardware routing via `HardwareAudioRouter`.
 */

import {
  MeasurementPipelineConfig,
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
} from '../dsp/analyzer-pipeline.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
  WorkerInboundMessage,
} from '../dsp/dsp-worker-protocol.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  SplHistoryCheckpoint,
  SplHistoryWindowSec,
} from '../dsp/spl-history.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
  SimulatorRigConfig,
} from '../dsp/synthetic-rig.js';
import { SourceData } from '../sources/source-data.js';
import { AudioDeviceOption, HardwareAudioRouter } from './hardware-audio-router.js';
import {
  LiveSlotManager,
  createDefaultLiveSlot,
  createSkeletonLiveFrame,
} from './live-slot-manager.js';
import { RingBufferStorage, createRingBufferStorage } from './ring-buffer.js';

export {
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  createDefaultLiveSlot,
  createSkeletonLiveFrame,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
};
export type { AudioDeviceOption, LiveMeasurementSlotConfig };

export type LiveFramesCallback = (liveFrames: SourceData[]) => void;
export type SlotConfigUpdateCallback = (
  slotId: string,
  config: MeasurementPipelineConfig
) => void;
export type SplCheckpointsCallback = (
  checkpoints: readonly SplHistoryCheckpoint[]
) => void;
export type SplCsvExportCallback = (csv: string) => void;

export class AudioEngine {
  private readonly worker: Worker;
  private readonly hardwareRouter = new HardwareAudioRouter();
  private readonly slotManager = new LiveSlotManager();
  private ringBufferStorage: RingBufferStorage | null = null;

  private inputMode: InputSourceMode = 'simulator';
  private inputModeSwitchSeq = 0;
  private readonly latestFramesById = new Map<string, SourceData>();
  private generatorConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };

  private selectedDeviceId = '';
  private isPaused = false;

  private readonly liveFramesListeners = new Set<LiveFramesCallback>();
  private readonly configListeners = new Set<SlotConfigUpdateCallback>();
  private readonly splCheckpointsListeners = new Set<SplCheckpointsCallback>();
  private readonly splCsvExportListeners = new Set<SplCsvExportCallback>();

  constructor() {
    this.worker = new Worker(new URL('../dsp/dsp.worker.ts', import.meta.url), {
      type: 'module',
    });

    try {
      this.ringBufferStorage = createRingBufferStorage(65536, true);
    } catch {
      this.ringBufferStorage = createRingBufferStorage(65536, false);
    }

    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'measurement-frames' && Array.isArray(msg.frames)) {
        const frames = msg.frames as SourceData[];
        for (const f of frames) {
          const prev = this.latestFramesById.get(f.id);
          const merged: SourceData =
            f.splHistory === undefined && prev?.splHistory !== undefined
              ? { ...f, splHistory: prev.splHistory }
              : f;
          this.latestFramesById.set(f.id, merged);
        }
        this.emitCurrentFrames();
      } else if (msg.type === 'measurement-frame' && msg.sourceData) {
        const sd = msg.sourceData as SourceData;
        const prev = this.latestFramesById.get(sd.id);
        const merged: SourceData =
          sd.splHistory === undefined && prev?.splHistory !== undefined
            ? { ...sd, splHistory: prev.splHistory }
            : sd;
        this.latestFramesById.set(sd.id, merged);
        this.emitCurrentFrames();
      } else if (msg.type === 'spl-history-checkpoints' && Array.isArray(msg.checkpoints)) {
        const cps = msg.checkpoints as SplHistoryCheckpoint[];
        for (const listener of this.splCheckpointsListeners) {
          listener(cps);
        }
      } else if (msg.type === 'spl-csv-exported' && typeof msg.csv === 'string') {
        for (const listener of this.splCsvExportListeners) {
          listener(msg.csv);
        }
      } else if (msg.type === 'measurement-config-updated' && msg.config) {
        const slotId = (msg.slotId as string) || this.slotManager.getSlot().id;
        const updatedConfig = msg.config as MeasurementPipelineConfig;
        this.slotManager.replaceSlotConfig(slotId, updatedConfig);
        for (const listener of this.configListeners) {
          listener(slotId, updatedConfig);
        }
      } else if (msg.type === 'calibration-loaded' && msg.slotId) {
        this.slotManager.setCalibrationLabel(
          msg.slotId as string,
          `${msg.name} (${msg.pointCount} pts)`
        );
      }
    };

    const canShareRingBuffer =
      this.ringBufferStorage !== null &&
      this.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer;

    this.sendToWorker({
      type: 'init',
      sampleRate: 48000,
      ringBufferStorage: canShareRingBuffer ? this.ringBufferStorage! : undefined,
    });
    this.syncSlotsToRouterAndWorker();
  }

  private sendToWorker(msg: WorkerInboundMessage): void {
    this.worker.postMessage(msg);
  }

  collectActivePhysicalChannels(): number[] {
    return this.slotManager.collectActivePhysicalChannels();
  }

  private emitCurrentFrames(): void {
    const frames = this.slotManager.getSlots().map((slot) => {
      const existing = this.latestFramesById.get(slot.id);
      if (existing) {
        return {
          ...existing,
          id: slot.id,
          name: slot.name,
          color: slot.color,
          visible: slot.visible,
        };
      }
      const skeleton = createSkeletonLiveFrame(slot);
      this.latestFramesById.set(slot.id, skeleton);
      return skeleton;
    });
    for (const listener of this.liveFramesListeners) {
      listener(frames);
    }
  }

  private syncSlotsToRouterAndWorker(): void {
    const tapMap = this.hardwareRouter.setActivePhysicalChannels(
      this.collectActivePhysicalChannels()
    );
    this.sendToWorker({
      type: 'sync-live-slots',
      slots: this.slotManager.getSlots(),
      channelTapMap: tapMap,
      globalReferenceChannel: this.slotManager.getGlobalReferenceChannel(),
    });
    this.emitCurrentFrames();
  }

  onLiveFrames(listener: LiveFramesCallback): () => void {
    this.liveFramesListeners.add(listener);
    this.emitCurrentFrames();
    return () => this.liveFramesListeners.delete(listener);
  }

  onMeasurementConfigChange(listener: SlotConfigUpdateCallback): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  onSplHistoryCheckpoints(listener: SplCheckpointsCallback): () => void {
    this.splCheckpointsListeners.add(listener);
    return () => this.splCheckpointsListeners.delete(listener);
  }

  onSplCsvExported(listener: SplCsvExportCallback): () => void {
    this.splCsvExportListeners.add(listener);
    return () => this.splCsvExportListeners.delete(listener);
  }

  getInputMode(): InputSourceMode {
    return this.inputMode;
  }

  getGlobalReferenceChannel(): number {
    return this.slotManager.getGlobalReferenceChannel();
  }

  setGlobalReferenceChannel(refChannel: number): void {
    this.slotManager.setGlobalReferenceChannel(refChannel);
    this.syncSlotsToRouterAndWorker();
  }

  getLiveSlots(): readonly LiveMeasurementSlotConfig[] {
    return this.slotManager.getSlots();
  }

  getLiveSlot(slotId: string = 'live-measurement'): LiveMeasurementSlotConfig {
    return this.slotManager.getSlot(slotId);
  }

  setLiveSlots(slots: readonly LiveMeasurementSlotConfig[]): void {
    this.slotManager.setSlots(slots);
    this.syncSlotsToRouterAndWorker();
  }

  addLiveSlot(partial?: Partial<LiveMeasurementSlotConfig>): LiveMeasurementSlotConfig {
    const created = this.slotManager.addSlot(partial);
    this.syncSlotsToRouterAndWorker();
    return created;
  }

  removeLiveSlot(slotId: string): void {
    if (this.slotManager.removeSlot(slotId)) {
      this.syncSlotsToRouterAndWorker();
    }
  }

  updateLiveSlot(slotId: string, partial: Partial<LiveMeasurementSlotConfig>): void {
    this.slotManager.updateSlot(slotId, partial);
    this.syncSlotsToRouterAndWorker();
  }

  getSimulatorPreset(slotId?: string): SimulatorPresetId {
    return this.getLiveSlot(slotId).simulatorPreset;
  }

  getSimulatorConfig(slotId?: string): SimulatorRigConfig {
    return SIMULATOR_PRESETS[this.getSimulatorPreset(slotId)];
  }

  getMeasurementConfig(slotId?: string): MeasurementPipelineConfig {
    return this.getLiveSlot(slotId).config;
  }

  getGeneratorConfig(): SignalGeneratorConfig {
    return this.generatorConfig;
  }

  getCalibrationName(slotId: string = 'live-measurement'): string | null {
    return this.slotManager.getCalibrationLabel(slotId);
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.sendToWorker({ type: 'pause', paused });
    this.hardwareRouter.setPaused(paused);
  }

  setSimulatorPreset(
    presetId: SimulatorPresetId,
    slotId: string = this.slotManager.getSlot().id
  ): void {
    this.slotManager.updateSlot(slotId, { simulatorPreset: presetId });
    this.sendToWorker({ type: 'set-simulator-preset', slotId, preset: presetId });
  }

  setCustomSimulatorConfig(
    config: SimulatorRigConfig,
    slotId: string = this.slotManager.getSlot().id
  ): void {
    this.sendToWorker({ type: 'set-simulator-preset', slotId, preset: config });
  }

  updateMeasurementConfig(
    partial: Partial<MeasurementPipelineConfig>,
    slotId: string = this.slotManager.getSlot().id
  ): void {
    this.slotManager.applyMeasurementConfigPartial(partial, slotId);
    this.sendToWorker({
      type: 'update-measurement-config',
      slotId,
      config: partial,
    });
  }

  updateGeneratorConfig(partial: Partial<SignalGeneratorConfig>): void {
    this.generatorConfig = { ...this.generatorConfig, ...partial };
    this.sendToWorker({ type: 'update-generator-config', config: partial });
    this.hardwareRouter.updateGeneratorConfig(this.generatorConfig);
  }

  loadCalibrationFile(
    text: string,
    name: string,
    slotId: string = this.slotManager.getSlot().id
  ): void {
    this.sendToWorker({ type: 'load-calibration', slotId, text, name });
  }

  clearCalibration(slotId: string = this.slotManager.getSlot().id): void {
    this.slotManager.clearCalibrationLabel(slotId);
    this.sendToWorker({ type: 'clear-calibration', slotId });
  }

  findAndApplyDelay(slotId: string = this.slotManager.getSlot().id): void {
    this.sendToWorker({ type: 'apply-estimated-delay', slotId });
  }

  resetAveraging(slotId?: string): void {
    this.sendToWorker({ type: 'reset-averaging', slotId });
  }

  resetSplHistory(slotId?: string): void {
    if (slotId) {
      const existing = this.latestFramesById.get(slotId);
      if (existing) {
        this.latestFramesById.set(slotId, { ...existing, splHistory: undefined });
      }
    } else {
      for (const [id, existing] of this.latestFramesById.entries()) {
        this.latestFramesById.set(id, { ...existing, splHistory: undefined });
      }
    }
    this.sendToWorker({ type: 'reset-spl-history', slotId });
  }

  setSplHistoryWindow(windowSec: SplHistoryWindowSec): void {
    this.sendToWorker({ type: 'set-spl-history-window', windowSec });
  }

  hydrateSplHistory(checkpoints: readonly SplHistoryCheckpoint[]): void {
    if (checkpoints.length > 0) {
      this.sendToWorker({ type: 'hydrate-spl-history', checkpoints });
    }
  }

  exportSplCsv(): void {
    this.sendToWorker({ type: 'export-spl-csv' });
  }

  listInputDevices(): Promise<AudioDeviceOption[]> {
    return this.hardwareRouter.listInputDevices();
  }

  getAvailableChannels(): number {
    return this.hardwareRouter.getAvailableChannels();
  }

  getAvailableOutputChannels(): number {
    return this.hardwareRouter.getAvailableOutputChannels();
  }

  getChannelRouting(slotId?: string): {
    measurementChannel: number;
    referenceChannel: number;
    generatorOutputChannel: number;
  } {
    const slot = this.getLiveSlot(slotId);
    return {
      measurementChannel: slot.measurementChannel,
      referenceChannel: slot.referenceChannel,
      generatorOutputChannel: this.hardwareRouter.getGeneratorOutputChannel(),
    };
  }

  setChannelRouting(
    measurementChannel: number,
    referenceChannel: number,
    generatorOutputChannel?: number,
    slotId: string = this.slotManager.getSlot().id
  ): void {
    if (generatorOutputChannel !== undefined) {
      this.hardwareRouter.setGeneratorOutputChannel(generatorOutputChannel);
    }
    this.updateLiveSlot(slotId, { measurementChannel, referenceChannel });
  }

  setGeneratorOutputChannel(outputChannel: number): void {
    this.hardwareRouter.setGeneratorOutputChannel(outputChannel);
  }

  async setInputMode(
    mode: InputSourceMode,
    deviceId?: string,
    measChannel?: number,
    refChannel?: number,
    slotId: string = this.slotManager.getSlot().id
  ): Promise<void> {
    const switchSeq = ++this.inputModeSwitchSeq;
    this.inputMode = mode;
    if (measChannel !== undefined || refChannel !== undefined) {
      const slot = this.getLiveSlot(slotId);
      this.updateLiveSlot(slot.id, {
        measurementChannel: measChannel ?? slot.measurementChannel,
        referenceChannel: refChannel ?? slot.referenceChannel,
      });
    }

    if (mode === 'simulator') {
      this.hardwareRouter.stopStream();
      this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      return;
    }

    if (deviceId !== undefined) {
      this.selectedDeviceId = deviceId;
    }

    try {
      const hwSampleRate = await this.hardwareRouter.startStream({
        deviceId: this.selectedDeviceId,
        activePhysicalChannels: this.collectActivePhysicalChannels(),
        generatorOutputChannel: this.hardwareRouter.getGeneratorOutputChannel(),
        generatorConfig: this.generatorConfig,
        isPaused: this.isPaused,
        ringBufferStorage: this.ringBufferStorage,
        onFallbackChunk: (channels) => {
          this.sendToWorker({ type: 'audio-chunk', channels });
        },
      });

      if (switchSeq !== this.inputModeSwitchSeq) {
        if (this.inputMode === 'simulator') {
          this.hardwareRouter.stopStream();
        }
        return;
      }

      this.syncSlotsToRouterAndWorker();
      const primarySlot = this.slotManager.getSlot();
      if (hwSampleRate !== primarySlot.config.sampleRate) {
        this.updateMeasurementConfig({ sampleRate: hwSampleRate }, primarySlot.id);
      }
      this.sendToWorker({ type: 'set-input-mode', mode: 'hardware' });
    } catch (err) {
      if (switchSeq === this.inputModeSwitchSeq) {
        this.inputMode = 'simulator';
        this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      }
      throw err;
    }
  }

  dispose(): void {
    this.hardwareRouter.dispose();
    this.worker.terminate();
    this.liveFramesListeners.clear();
    this.configListeners.clear();
    this.splCheckpointsListeners.clear();
    this.splCsvExportListeners.clear();
  }
}
