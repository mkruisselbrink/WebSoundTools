// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * AudioEngine & Multi-Slot / Dual-Device DSP Worker Controller.
 *
 * Manages background `dsp.worker.ts` lifecycle, multi-slot Live Measurement configurations
 * via `LiveSlotManager`, primary hardware routing via `HardwareAudioRouter`, and an optional
 * independent secondary USB console capture stream (`secondaryMixerRouter`) for 32-channel
 * Mixer Input Watch feedback attribution.
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
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
  SimulatorRigConfig,
} from '../dsp/synthetic-rig.js';
import {
  MixerWatchSessionConfig,
  collectEnabledMixerPhysicalChannels,
  createDefaultMixerWatchSessionConfig,
} from '../sources/mixer-patch-storage.js';
import { SourceData } from '../sources/source-data.js';
import { AudioDeviceOption, HardwareAudioRouter } from './hardware-audio-router.js';
import {
  LiveSlotManager,
  createDefaultLiveSlot,
  createSkeletonLiveFrame,
} from './live-slot-manager.js';
import {
  MAX_CAPTURE_TAP_SLOTS,
  MIXER_CAPTURE_TAP_SLOTS,
  RingBufferStorage,
  TOTAL_RING_BUFFER_SLOTS,
  createRingBufferStorage,
} from './ring-buffer.js';

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
  private readonly hardwareRouter = new HardwareAudioRouter(MAX_CAPTURE_TAP_SLOTS, false);
  private readonly secondaryMixerRouter = new HardwareAudioRouter(
    MIXER_CAPTURE_TAP_SLOTS,
    true
  );
  private readonly slotManager = new LiveSlotManager();
  private ringBufferStorage: RingBufferStorage | null = null;
  private mixerRingBufferStorage: RingBufferStorage | null = null;

  private inputMode: InputSourceMode = 'simulator';
  private inputModeSwitchSeq = 0;
  private mixerDeviceSwitchSeq = 0;
  private readonly latestFramesById = new Map<string, SourceData>();
  private latestMixerTelemetry: MixerWatchTelemetry = {
    channelLevelsDbFs: {},
    mixerOnlyFeedbackTracks: [],
  };
  private generatorConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };
  private mixerWatchConfig: MixerWatchSessionConfig =
    createDefaultMixerWatchSessionConfig();
  private mixerWatchStatusNotice = '';

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

    const allowSharedMemory =
      typeof SharedArrayBuffer !== 'undefined' &&
      ((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? true);

    try {
      this.ringBufferStorage = createRingBufferStorage(
        32768,
        allowSharedMemory,
        TOTAL_RING_BUFFER_SLOTS
      );
      this.mixerRingBufferStorage = createRingBufferStorage(
        32768,
        allowSharedMemory,
        MIXER_CAPTURE_TAP_SLOTS
      );
    } catch {
      this.ringBufferStorage = createRingBufferStorage(
        32768,
        false,
        TOTAL_RING_BUFFER_SLOTS
      );
      this.mixerRingBufferStorage = createRingBufferStorage(
        32768,
        false,
        MIXER_CAPTURE_TAP_SLOTS
      );
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
      allowSharedMemory &&
      this.ringBufferStorage !== null &&
      typeof SharedArrayBuffer !== 'undefined' &&
      this.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer;

    try {
      this.sendToWorker({
        type: 'init',
        sampleRate: 48000,
        ringBufferStorage: canShareRingBuffer ? this.ringBufferStorage! : undefined,
        mixerRingBufferStorage:
          canShareRingBuffer && this.mixerRingBufferStorage
            ? this.mixerRingBufferStorage
            : undefined,
      });
    } catch {
      this.ringBufferStorage = createRingBufferStorage(
        32768,
        false,
        TOTAL_RING_BUFFER_SLOTS
      );
      this.mixerRingBufferStorage = createRingBufferStorage(
        32768,
        false,
        MIXER_CAPTURE_TAP_SLOTS
      );
      this.sendToWorker({
        type: 'init',
        sampleRate: 48000,
      });
    }
    this.syncSlotsToRouterAndWorker();
  }

  private sendToWorker(msg: WorkerInboundMessage): void {
    this.worker.postMessage(msg);
  }

  collectActivePhysicalChannels(): number[] {
    const slotChs = this.slotManager.collectActivePhysicalChannels();
    if (
      !this.mixerWatchConfig.enabled ||
      this.mixerWatchConfig.deviceMode !== 'follow-main'
    ) {
      return slotChs;
    }
    const mixerChs = collectEnabledMixerPhysicalChannels(
      this.mixerWatchConfig,
      this.slotManager.getGlobalReferenceChannel()
    );
    return [...slotChs, ...mixerChs];
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
      listener(frames, this.latestMixerTelemetry);
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
    this.syncMixerWatchToWorker(tapMap);
    this.emitCurrentFrames();
  }

  private syncMixerWatchToWorker(primaryTapMap?: Record<number, number>): void {
    const useSeparate =
      this.inputMode === 'hardware' &&
      this.mixerWatchConfig.enabled &&
      this.mixerWatchConfig.deviceMode === 'separate-device' &&
      this.mixerWatchConfig.separateDeviceId.length > 0 &&
      this.mixerWatchConfig.separateDeviceId !== this.selectedDeviceId;

    const tapMap = useSeparate
      ? this.secondaryMixerRouter.setActivePhysicalChannels(
          collectEnabledMixerPhysicalChannels(this.mixerWatchConfig, -1)
        )
      : (primaryTapMap ?? this.hardwareRouter.getChannelTapMap());

    const mixerSr = useSeparate
      ? this.secondaryMixerRouter.getSampleRate()
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
    if (this.inputMode === 'simulator') {
      return 16;
    }
    if (
      this.mixerWatchConfig.deviceMode === 'separate-device' &&
      this.mixerWatchConfig.separateDeviceId &&
      this.mixerWatchConfig.separateDeviceId !== this.selectedDeviceId &&
      this.secondaryMixerRouter.isStreamHealthy()
    ) {
      return this.secondaryMixerRouter.getAvailableChannels();
    }
    return this.hardwareRouter.getAvailableChannels();
  }

  getMixerWatchSampleRate(): number {
    if (
      this.inputMode === 'hardware' &&
      this.mixerWatchConfig.deviceMode === 'separate-device' &&
      this.secondaryMixerRouter.isStreamHealthy()
    ) {
      return this.secondaryMixerRouter.getSampleRate();
    }
    return this.getMeasurementConfig().sampleRate;
  }

  getMixerWatchStatusNotice(): string {
    return this.mixerWatchStatusNotice;
  }

  getLatestMixerTelemetry(): MixerWatchTelemetry {
    return this.latestMixerTelemetry;
  }

  async setMixerWatchConfig(nextConfig: MixerWatchSessionConfig): Promise<void> {
    const prev = this.mixerWatchConfig;
    this.mixerWatchConfig = nextConfig;
    this.mixerWatchStatusNotice = '';

    const needsSeparateStream =
      this.inputMode === 'hardware' &&
      !this.isPaused &&
      nextConfig.enabled &&
      nextConfig.deviceMode === 'separate-device' &&
      nextConfig.separateDeviceId.length > 0 &&
      nextConfig.separateDeviceId !== this.selectedDeviceId;

    if (!needsSeparateStream) {
      this.secondaryMixerRouter.stopStream();
      this.syncSlotsToRouterAndWorker();
      return;
    }

    const deviceChanged =
      prev.deviceMode !== 'separate-device' ||
      prev.separateDeviceId !== nextConfig.separateDeviceId ||
      !this.secondaryMixerRouter.isStreamHealthy();

    if (!deviceChanged) {
      this.syncSlotsToRouterAndWorker();
      return;
    }

    await this.startSecondaryMixerStream();
  }

  private async startSecondaryMixerStream(): Promise<void> {
    const seq = ++this.mixerDeviceSwitchSeq;
    const cfg = this.mixerWatchConfig;
    if (
      this.inputMode !== 'hardware' ||
      !cfg.enabled ||
      cfg.deviceMode !== 'separate-device' ||
      !cfg.separateDeviceId ||
      cfg.separateDeviceId === this.selectedDeviceId
    ) {
      this.secondaryMixerRouter.stopStream();
      this.syncSlotsToRouterAndWorker();
      return;
    }

    try {
      await this.secondaryMixerRouter.startStream({
        deviceId: cfg.separateDeviceId,
        activePhysicalChannels: collectEnabledMixerPhysicalChannels(cfg, -1),
        generatorOutputChannel: -2,
        generatorConfig: { ...DEFAULT_GENERATOR_CONFIG, enabled: false },
        isPaused: this.isPaused,
        ringBufferStorage: this.mixerRingBufferStorage,
        onFallbackChunk: (channels) => {
          this.sendToWorker({ type: 'mixer-audio-chunk', channels });
        },
      });

      if (seq !== this.mixerDeviceSwitchSeq) return;

      // Single-route mobile OS guard: if opening a second USB input preempted the primary mic, recover primary immediately
      if (this.hardwareRouter && !this.hardwareRouter.isStreamHealthy()) {
        this.secondaryMixerRouter.stopStream();
        await this.hardwareRouter.recoverStreamIfInterrupted();
        this.mixerWatchConfig = {
          ...this.mixerWatchConfig,
          deviceMode: 'follow-main',
        };
        this.mixerWatchStatusNotice =
          'This OS only allows one active audio interface — switched Mixer Watch to Follow Main Input.';
      }
    } catch (err) {
      if (seq === this.mixerDeviceSwitchSeq) {
        this.secondaryMixerRouter.stopStream();
        const reason =
          err instanceof Error && err.message
            ? err.message
            : 'Device unavailable.';
        this.mixerWatchStatusNotice = `Could not open separate mixer device (${reason})`;
      }
    }

    this.syncSlotsToRouterAndWorker();
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
    this.secondaryMixerRouter.setPaused(paused);
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
      this.secondaryMixerRouter.stopStream();
      this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      this.syncMixerWatchToWorker();
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
          this.secondaryMixerRouter.stopStream();
        }
        return;
      }

      const primarySlot = this.slotManager.getSlot();
      if (hwSampleRate !== primarySlot.config.sampleRate) {
        this.updateMeasurementConfig({ sampleRate: hwSampleRate }, primarySlot.id);
      }

      if (
        !this.isPaused &&
        this.mixerWatchConfig.enabled &&
        this.mixerWatchConfig.deviceMode === 'separate-device' &&
        this.mixerWatchConfig.separateDeviceId &&
        this.mixerWatchConfig.separateDeviceId !== this.selectedDeviceId
      ) {
        await this.startSecondaryMixerStream();
      } else {
        this.secondaryMixerRouter.stopStream();
        this.syncSlotsToRouterAndWorker();
      }

      this.sendToWorker({ type: 'set-input-mode', mode: 'hardware' });
    } catch (err) {
      if (switchSeq === this.inputModeSwitchSeq) {
        this.inputMode = 'simulator';
        this.secondaryMixerRouter.stopStream();
        this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      }
      throw err;
    }
  }

  isHardwareStreamHealthy(): boolean {
    return this.hardwareRouter.isStreamHealthy();
  }

  async recoverHardwareStreamIfInterrupted(): Promise<boolean> {
    if (this.inputMode !== 'hardware' || this.isPaused) return true;
    if (this.hardwareRouter.isStreamHealthy()) {
      if (
        this.mixerWatchConfig.enabled &&
        this.mixerWatchConfig.deviceMode === 'separate-device' &&
        this.mixerWatchConfig.separateDeviceId &&
        this.mixerWatchConfig.separateDeviceId !== this.selectedDeviceId &&
        !this.secondaryMixerRouter.isStreamHealthy()
      ) {
        await this.startSecondaryMixerStream();
      }
      return true;
    }
    try {
      const sr = await this.hardwareRouter.recoverStreamIfInterrupted();
      if (sr !== null) {
        const primarySlot = this.slotManager.getSlot();
        if (sr !== primarySlot.config.sampleRate) {
          this.updateMeasurementConfig({ sampleRate: sr }, primarySlot.id);
        }
      }
      if (
        this.hardwareRouter.isStreamHealthy() &&
        this.mixerWatchConfig.enabled &&
        this.mixerWatchConfig.deviceMode === 'separate-device' &&
        this.mixerWatchConfig.separateDeviceId &&
        this.mixerWatchConfig.separateDeviceId !== this.selectedDeviceId
      ) {
        await this.startSecondaryMixerStream();
      }
      return this.hardwareRouter.isStreamHealthy();
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.hardwareRouter.dispose();
    this.secondaryMixerRouter.dispose();
    this.worker.terminate();
    this.liveFramesListeners.clear();
    this.configListeners.clear();
    this.splCheckpointsListeners.clear();
    this.splCsvExportListeners.clear();
  }
}
