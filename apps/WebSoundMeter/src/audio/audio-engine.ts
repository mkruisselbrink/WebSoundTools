// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * AudioEngine & Multi-Slot DSP Worker Controller.
 *
 * Manages background `dsp.worker.ts` lifecycle, multi-slot Live Measurement configurations
 * via `LiveSlotManager`, and single/dual-device capture routing via `DualDeviceCaptureCoordinator`.
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
import type { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  SplHistoryCheckpoint,
  SplHistoryWindowSec,
} from '../dsp/spl-history.js';
import type { SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  MixerWatchSessionConfig,
  collectEnabledMixerPhysicalChannels,
  createDefaultMixerWatchSessionConfig,
} from '../sources/mixer-patch-storage.js';
import { SourceData } from '../sources/source-data.js';
import { DualDeviceCaptureCoordinator } from './dual-device-capture.js';
import type { AudioDeviceOption } from './hardware-audio-router.js';
import {
  LiveSlotManager,
  createDefaultLiveSlot,
  createSkeletonLiveFrame,
} from './live-slot-manager.js';

export {
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  createDefaultLiveSlot,
  createSkeletonLiveFrame,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
};
export type { AudioDeviceOption, LiveMeasurementSlotConfig };

export interface MixerWatchTelemetry {
  readonly channelLevelsDbFs: Readonly<Record<number, number>>;
  readonly mixerOnlyFeedbackTracks: readonly DetectedFeedbackTrack[];
}

export type LiveFramesCallback = (
  liveFrames: SourceData[],
  mixerTelemetry?: MixerWatchTelemetry
) => void;
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
  private readonly capture: DualDeviceCaptureCoordinator;
  public readonly slots = new LiveSlotManager();

  private inputMode: InputSourceMode = 'simulator';
  private inputModeSwitchSeq = 0;
  private readonly latestFramesById = new Map<string, SourceData>();
  private latestMixerTelemetry: MixerWatchTelemetry = {
    channelLevelsDbFs: {},
    mixerOnlyFeedbackTracks: [],
  };
  private generatorConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };
  private mixerWatchConfig: MixerWatchSessionConfig =
    createDefaultMixerWatchSessionConfig();

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

    this.capture = new DualDeviceCaptureCoordinator({
      onPrimaryFallbackChunk: (channels) => {
        this.sendToWorker({ type: 'audio-chunk', channels });
      },
      onMixerFallbackChunk: (channels) => {
        this.sendToWorker({ type: 'mixer-audio-chunk', channels });
      },
    });

    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'measurement-frames' && Array.isArray(msg.frames)) {
        for (const f of msg.frames as SourceData[]) {
          const prev = this.latestFramesById.get(f.id);
          const merged: SourceData =
            f.splHistory === undefined && prev?.splHistory !== undefined
              ? { ...f, splHistory: prev.splHistory }
              : f;
          this.latestFramesById.set(f.id, merged);
        }
        if (msg.mixerTelemetry) {
          this.latestMixerTelemetry = msg.mixerTelemetry as MixerWatchTelemetry;
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
        const slotId = (msg.slotId as string) || this.slots.getSlot().id;
        const updatedConfig = msg.config as MeasurementPipelineConfig;
        this.slots.replaceSlotConfig(slotId, updatedConfig);
        for (const listener of this.configListeners) {
          listener(slotId, updatedConfig);
        }
      } else if (msg.type === 'calibration-loaded' && msg.slotId) {
        this.slots.setCalibrationLabel(
          msg.slotId as string,
          `${msg.name} (${msg.pointCount} pts)`
        );
      }
    };

    try {
      const share = this.capture.canShareRingBuffer();
      this.sendToWorker({
        type: 'init',
        sampleRate: 48000,
        ringBufferStorage: share ? this.capture.ringBufferStorage : undefined,
        mixerRingBufferStorage: share ? this.capture.mixerRingBufferStorage : undefined,
      });
    } catch {
      this.capture.downgradeToLocalRingBuffers();
      this.sendToWorker({ type: 'init', sampleRate: 48000 });
    }
    this.syncSlotsToRouterAndWorker();
  }

  private sendToWorker(msg: WorkerInboundMessage): void {
    this.worker.postMessage(msg);
  }

  collectActivePhysicalChannels(): number[] {
    const slotChs = this.slots.collectActivePhysicalChannels();
    if (
      !this.mixerWatchConfig.enabled ||
      this.mixerWatchConfig.deviceMode !== 'follow-main'
    ) {
      return slotChs;
    }
    const mixerChs = collectEnabledMixerPhysicalChannels(
      this.mixerWatchConfig,
      this.slots.getGlobalReferenceChannel()
    );
    return [...slotChs, ...mixerChs];
  }

  private emitCurrentFrames(): void {
    const frames = this.slots.getSlots().map((slot) => {
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
      listener(frames, this.latestMixerTelemetry);
    }
  }

  private syncSlotsToRouterAndWorker(): void {
    const tapMap = this.capture.primaryRouter.setActivePhysicalChannels(
      this.collectActivePhysicalChannels()
    );
    this.sendToWorker({
      type: 'sync-live-slots',
      slots: this.slots.getSlots(),
      channelTapMap: tapMap,
      globalReferenceChannel: this.slots.getGlobalReferenceChannel(),
    });
    this.syncMixerWatchToWorker(tapMap);
    this.emitCurrentFrames();
  }

  private syncMixerWatchToWorker(primaryTapMap?: Record<number, number>): void {
    const useSeparate = this.capture.isSeparateMixerActive(
      this.inputMode === 'hardware',
      this.selectedDeviceId,
      this.mixerWatchConfig
    );

    const tapMap = useSeparate
      ? this.capture.secondaryMixerRouter.setActivePhysicalChannels(
          collectEnabledMixerPhysicalChannels(this.mixerWatchConfig, -1)
        )
      : (primaryTapMap ?? this.capture.primaryRouter.getChannelTapMap());

    const mixerSr = useSeparate
      ? this.capture.secondaryMixerRouter.getSampleRate()
      : this.getMeasurementConfig().sampleRate;

    this.sendToWorker({
      type: 'sync-mixer-watch',
      config: this.mixerWatchConfig,
      channelTapMap: tapMap,
      mixerSampleRate: mixerSr,
      useSeparateRingBuffer: useSeparate,
    });
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

  getMixerWatchConfig(): MixerWatchSessionConfig {
    return this.mixerWatchConfig;
  }

  getMixerWatchAvailableChannels(): number {
    if (this.inputMode === 'simulator') return 16;
    if (
      this.capture.isSeparateMixerActive(
        true,
        this.selectedDeviceId,
        this.mixerWatchConfig
      ) &&
      this.capture.secondaryMixerRouter.isStreamHealthy()
    ) {
      return this.capture.secondaryMixerRouter.getAvailableChannels();
    }
    return this.capture.primaryRouter.getAvailableChannels();
  }

  getMixerWatchSampleRate(): number {
    if (
      this.inputMode === 'hardware' &&
      this.mixerWatchConfig.deviceMode === 'separate-device' &&
      this.capture.secondaryMixerRouter.isStreamHealthy()
    ) {
      return this.capture.secondaryMixerRouter.getSampleRate();
    }
    return this.getMeasurementConfig().sampleRate;
  }

  getMixerWatchStatusNotice(): string {
    return this.capture.getStatusNotice();
  }

  getLatestMixerTelemetry(): MixerWatchTelemetry {
    return this.latestMixerTelemetry;
  }

  async setMixerWatchConfig(nextConfig: MixerWatchSessionConfig): Promise<void> {
    const prev = this.mixerWatchConfig;
    this.mixerWatchConfig = nextConfig;
    this.capture.clearStatusNotice();

    const needsSeparateStream =
      !this.isPaused &&
      this.capture.isSeparateMixerActive(
        this.inputMode === 'hardware',
        this.selectedDeviceId,
        nextConfig
      );

    if (!needsSeparateStream) {
      this.capture.secondaryMixerRouter.stopStream();
      this.syncSlotsToRouterAndWorker();
      return;
    }

    const deviceChanged =
      prev.deviceMode !== 'separate-device' ||
      prev.separateDeviceId !== nextConfig.separateDeviceId ||
      !this.capture.secondaryMixerRouter.isStreamHealthy();

    if (!deviceChanged) {
      this.syncSlotsToRouterAndWorker();
      return;
    }

    this.mixerWatchConfig = await this.capture.startSecondaryMixerStream({
      isHardwareMode: this.inputMode === 'hardware',
      selectedDeviceId: this.selectedDeviceId,
      isPaused: this.isPaused,
      config: this.mixerWatchConfig,
    });
    this.syncSlotsToRouterAndWorker();
  }

  getGlobalReferenceChannel(): number {
    return this.slots.getGlobalReferenceChannel();
  }

  setGlobalReferenceChannel(refChannel: number): void {
    this.slots.setGlobalReferenceChannel(refChannel);
    this.syncSlotsToRouterAndWorker();
  }

  getLiveSlots(): readonly LiveMeasurementSlotConfig[] {
    return this.slots.getSlots();
  }

  getLiveSlot(slotId: string = 'live-measurement'): LiveMeasurementSlotConfig {
    return this.slots.getSlot(slotId);
  }

  setLiveSlots(slots: readonly LiveMeasurementSlotConfig[]): void {
    this.slots.setSlots(slots);
    this.syncSlotsToRouterAndWorker();
  }

  addLiveSlot(partial?: Partial<LiveMeasurementSlotConfig>): LiveMeasurementSlotConfig {
    const created = this.slots.addSlot(partial);
    this.syncSlotsToRouterAndWorker();
    return created;
  }

  removeLiveSlot(slotId: string): void {
    if (this.slots.removeSlot(slotId)) {
      this.latestFramesById.delete(slotId);
      this.syncSlotsToRouterAndWorker();
    }
  }

  updateLiveSlot(slotId: string, partial: Partial<LiveMeasurementSlotConfig>): void {
    this.slots.updateSlot(slotId, partial);
    this.syncSlotsToRouterAndWorker();
  }

  getMeasurementConfig(slotId?: string): MeasurementPipelineConfig {
    return this.getLiveSlot(slotId).config;
  }

  getGeneratorConfig(): SignalGeneratorConfig {
    return this.generatorConfig;
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.sendToWorker({ type: 'pause', paused });
    this.capture.setPaused(paused);
  }

  /**
   * Stops and releases all active `MediaStreamTrack`s at the OS/browser level (turning off
   * OS mic recording indicators) while preserving `inputMode === 'hardware'` and routing settings.
   */
  disconnectHardwareStreams(): void {
    this.isPaused = true;
    this.sendToWorker({ type: 'pause', paused: true });
    this.capture.stopAllStreams(false);
  }

  hasActiveHardwareCapture(): boolean {
    return this.capture.hasActiveCapture();
  }

  setSimulatorPreset(
    presetId: SimulatorPresetId,
    slotId: string = this.slots.getSlot().id
  ): void {
    this.slots.updateSlot(slotId, { simulatorPreset: presetId });
    this.sendToWorker({ type: 'set-simulator-preset', slotId, preset: presetId });
  }

  updateMeasurementConfig(
    partial: Partial<MeasurementPipelineConfig>,
    slotId: string = this.slots.getSlot().id
  ): void {
    this.slots.applyMeasurementConfigPartial(partial, slotId);
    this.sendToWorker({
      type: 'update-measurement-config',
      slotId,
      config: partial,
    });
  }

  updateGeneratorConfig(partial: Partial<SignalGeneratorConfig>): void {
    this.generatorConfig = { ...this.generatorConfig, ...partial };
    this.sendToWorker({ type: 'update-generator-config', config: partial });
    this.capture.primaryRouter.updateGeneratorConfig(this.generatorConfig);
  }

  loadCalibrationFile(
    text: string,
    name: string,
    slotId: string = this.slots.getSlot().id
  ): void {
    this.sendToWorker({ type: 'load-calibration', slotId, text, name });
  }

  clearCalibration(slotId: string = this.slots.getSlot().id): void {
    this.slots.clearCalibrationLabel(slotId);
    this.sendToWorker({ type: 'clear-calibration', slotId });
  }

  findAndApplyDelay(slotId: string = this.slots.getSlot().id): void {
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
    return this.capture.listInputDevices();
  }

  getAvailableChannels(): number {
    return this.capture.primaryRouter.getAvailableChannels();
  }

  getAvailableOutputChannels(): number {
    return this.capture.primaryRouter.getAvailableOutputChannels();
  }

  setGeneratorOutputChannel(outputChannel: number): void {
    this.capture.primaryRouter.setGeneratorOutputChannel(outputChannel);
  }

  async setInputMode(
    mode: InputSourceMode,
    deviceId?: string,
    measChannel?: number,
    refChannel?: number,
    slotId: string = this.slots.getSlot().id
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
      this.capture.stopAllStreams();
      this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      this.syncMixerWatchToWorker();
      return;
    }

    if (deviceId !== undefined) {
      this.selectedDeviceId = deviceId;
    }

    try {
      const hwSampleRate = await this.capture.startPrimaryStream({
        deviceId: this.selectedDeviceId,
        activePhysicalChannels: this.collectActivePhysicalChannels(),
        generatorConfig: this.generatorConfig,
        isPaused: this.isPaused,
      });

      if (switchSeq !== this.inputModeSwitchSeq) {
        if (this.inputMode === 'simulator') {
          this.capture.stopAllStreams();
        }
        return;
      }

      const primarySlot = this.slots.getSlot();
      if (hwSampleRate !== primarySlot.config.sampleRate) {
        this.updateMeasurementConfig({ sampleRate: hwSampleRate }, primarySlot.id);
      }

      if (
        !this.isPaused &&
        this.capture.isSeparateMixerActive(true, this.selectedDeviceId, this.mixerWatchConfig)
      ) {
        this.mixerWatchConfig = await this.capture.startSecondaryMixerStream({
          isHardwareMode: true,
          selectedDeviceId: this.selectedDeviceId,
          isPaused: this.isPaused,
          config: this.mixerWatchConfig,
        });
      } else {
        this.capture.secondaryMixerRouter.stopStream();
      }
      this.syncSlotsToRouterAndWorker();
      this.sendToWorker({ type: 'set-input-mode', mode: 'hardware' });
    } catch (err) {
      if (switchSeq === this.inputModeSwitchSeq) {
        this.inputMode = 'simulator';
        this.capture.secondaryMixerRouter.stopStream();
        this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      }
      throw err;
    }
  }

  isHardwareStreamHealthy(): boolean {
    return this.capture.primaryRouter.isStreamHealthy();
  }

  async recoverHardwareStreamIfInterrupted(): Promise<boolean> {
    if (this.inputMode !== 'hardware' || this.isPaused) return true;
    if (this.capture.primaryRouter.isStreamHealthy()) {
      if (
        this.capture.isSeparateMixerActive(true, this.selectedDeviceId, this.mixerWatchConfig) &&
        !this.capture.secondaryMixerRouter.isStreamHealthy()
      ) {
        this.mixerWatchConfig = await this.capture.startSecondaryMixerStream({
          isHardwareMode: true,
          selectedDeviceId: this.selectedDeviceId,
          isPaused: this.isPaused,
          config: this.mixerWatchConfig,
        });
        this.syncSlotsToRouterAndWorker();
      }
      return true;
    }
    try {
      const sr = await this.capture.primaryRouter.recoverStreamIfInterrupted();
      if (sr !== null) {
        const primarySlot = this.slots.getSlot();
        if (sr !== primarySlot.config.sampleRate) {
          this.updateMeasurementConfig({ sampleRate: sr }, primarySlot.id);
        }
      }
      if (
        this.capture.primaryRouter.isStreamHealthy() &&
        this.capture.isSeparateMixerActive(true, this.selectedDeviceId, this.mixerWatchConfig)
      ) {
        this.mixerWatchConfig = await this.capture.startSecondaryMixerStream({
          isHardwareMode: true,
          selectedDeviceId: this.selectedDeviceId,
          isPaused: this.isPaused,
          config: this.mixerWatchConfig,
        });
        this.syncSlotsToRouterAndWorker();
      }
      return this.capture.primaryRouter.isStreamHealthy();
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.capture.dispose();
    this.worker.terminate();
    this.liveFramesListeners.clear();
    this.configListeners.clear();
    this.splCheckpointsListeners.clear();
    this.splCsvExportListeners.clear();
  }
}
