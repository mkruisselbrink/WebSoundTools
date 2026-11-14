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
 * AudioEngine & Multi-Slot DSP Worker Controller (`src/audio/audio-engine.ts`).
 *
 * Manages background `dsp.worker.ts` lifecycle, multi-slot Live Measurement configurations,
 * message dispatch, and dynamic physical hardware channel routing via `HardwareAudioRouter`.
 */

import {
  DEFAULT_MEASUREMENT_CONFIG,
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
} from '../dsp/dsp.worker.js';
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
  DEFAULT_SOURCE_PALETTE,
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../sources/source-data.js';
import { AudioDeviceOption, HardwareAudioRouter } from './hardware-audio-router.js';
import { createRingBufferStorage, RingBufferStorage } from './ring-buffer.js';

export {
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
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

const SIMULATOR_PRESET_CYCLE: readonly SimulatorPresetId[] = [
  'pa-room-modes',
  'sub-top-misaligned',
  'comb-filtering',
  'flat-delayed',
  'noisy-crowd',
];

export function createDefaultLiveSlot(
  id: string = 'live-measurement',
  index: number = 0
): LiveMeasurementSlotConfig {
  const paletteIdx = index % DEFAULT_SOURCE_PALETTE.length;
  const preset = SIMULATOR_PRESET_CYCLE[index % SIMULATOR_PRESET_CYCLE.length];
  return {
    id,
    name: index === 0 ? 'Live Measurement' : `Live Measurement #${index + 1}`,
    color: DEFAULT_SOURCE_PALETTE[paletteIdx],
    visible: true,
    simulatorPreset: preset,
    measurementChannel: index === 0 ? 0 : index * 2,
    referenceChannel: REFERENCE_CHANNEL_GLOBAL,
    config: { ...DEFAULT_MEASUREMENT_CONFIG },
    activeCalibrationId: null,
  };
}

export function createSkeletonLiveFrame(slot: LiveMeasurementSlotConfig): SourceData {
  const N = slot.config.fftSize || 4096;
  const binCount = (N >>> 1) + 1;
  const sr = slot.config.sampleRate || 48000;
  return {
    id: slot.id,
    name: slot.name,
    kind: 'measurement',
    color: slot.color,
    visible: slot.visible,
    active: true,
    sampleRate: sr,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: slot.config.invertPolarity,
    createdAt: new Date().toISOString(),
    notes: '',
    freqData: createEmptyFrequencyDomainData(binCount, sr),
    timeData: createEmptyTimeDomainData(N, sr),
  };
}

export class AudioEngine {
  private readonly worker: Worker;
  private readonly hardwareRouter = new HardwareAudioRouter();
  private ringBufferStorage: RingBufferStorage | null = null;

  private inputMode: InputSourceMode = 'simulator';
  private inputModeSwitchSeq: number = 0;
  private globalReferenceChannel: number = 1; // Default physical In Ch 2 (0-based index 1)
  private liveSlots: LiveMeasurementSlotConfig[] = [createDefaultLiveSlot()];
  private readonly latestFramesById = new Map<string, SourceData>();
  private generatorConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };

  private selectedDeviceId: string = '';
  private isPaused: boolean = false;
  private readonly calibrationNames = new Map<string, string>();

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
        const slotId = (msg.slotId as string) || this.liveSlots[0].id;
        const updatedConfig = msg.config as MeasurementPipelineConfig;
        this.liveSlots = this.liveSlots.map((s) =>
          s.id === slotId ? { ...s, config: updatedConfig } : s
        );
        for (const listener of this.configListeners) {
          listener(slotId, updatedConfig);
        }
      } else if (msg.type === 'calibration-loaded' && msg.slotId) {
        this.calibrationNames.set(
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
    const chs: number[] = [];
    for (const slot of this.liveSlots) {
      if (slot.measurementChannel >= 0) {
        chs.push(slot.measurementChannel);
      }
      const effectiveRef = resolveEffectiveReferenceChannel(
        slot.referenceChannel,
        this.globalReferenceChannel
      );
      if (effectiveRef >= 0) {
        chs.push(effectiveRef);
      }
    }
    return chs;
  }

  private emitCurrentFrames(): void {
    const frames = this.liveSlots.map((slot) => {
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
      slots: this.liveSlots,
      channelTapMap: tapMap,
      globalReferenceChannel: this.globalReferenceChannel,
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
    return this.globalReferenceChannel;
  }

  setGlobalReferenceChannel(refChannel: number): void {
    this.globalReferenceChannel = refChannel;
    this.syncSlotsToRouterAndWorker();
  }

  getLiveSlots(): readonly LiveMeasurementSlotConfig[] {
    return this.liveSlots;
  }

  getLiveSlot(slotId: string = 'live-measurement'): LiveMeasurementSlotConfig {
    return (
      this.liveSlots.find((s) => s.id === slotId) ??
      this.liveSlots[0] ??
      createDefaultLiveSlot()
    );
  }

  setLiveSlots(slots: readonly LiveMeasurementSlotConfig[]): void {
    this.liveSlots = slots.length > 0 ? [...slots] : [createDefaultLiveSlot()];
    this.syncSlotsToRouterAndWorker();
  }

  addLiveSlot(partial?: Partial<LiveMeasurementSlotConfig>): LiveMeasurementSlotConfig {
    const idx = this.liveSlots.length;
    const uid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 6)
        : `${Date.now().toString(36)}-${idx}`;
    const base = createDefaultLiveSlot(`live-${uid}`, idx);
    const primaryCfg = this.liveSlots[0]?.config ?? DEFAULT_MEASUREMENT_CONFIG;
    const { sharedPartial } = splitMeasurementConfigPartial(primaryCfg);
    const created: LiveMeasurementSlotConfig = {
      ...base,
      ...partial,
      config: {
        ...base.config,
        ...sharedPartial,
        ...(partial?.config ?? {}),
      },
    };
    this.liveSlots = [...this.liveSlots, created];
    this.syncSlotsToRouterAndWorker();
    return created;
  }

  removeLiveSlot(slotId: string): void {
    if (this.liveSlots.length <= 1) return;
    this.liveSlots = this.liveSlots.filter((s) => s.id !== slotId);
    this.calibrationNames.delete(slotId);
    this.syncSlotsToRouterAndWorker();
  }

  updateLiveSlot(
    slotId: string,
    partial: Partial<LiveMeasurementSlotConfig>
  ): void {
    this.liveSlots = this.liveSlots.map((slot) => {
      if (slot.id !== slotId) return slot;
      return {
        ...slot,
        ...partial,
        config: partial.config ? { ...slot.config, ...partial.config } : slot.config,
      };
    });
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
    return this.calibrationNames.get(slotId) ?? null;
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
    slotId: string = this.liveSlots[0].id
  ): void {
    this.liveSlots = this.liveSlots.map((s) =>
      s.id === slotId ? { ...s, simulatorPreset: presetId } : s
    );
    this.sendToWorker({ type: 'set-simulator-preset', slotId, preset: presetId });
  }

  setCustomSimulatorConfig(
    config: SimulatorRigConfig,
    slotId: string = this.liveSlots[0].id
  ): void {
    this.sendToWorker({ type: 'set-simulator-preset', slotId, preset: config });
  }

  updateMeasurementConfig(
    partial: Partial<MeasurementPipelineConfig>,
    slotId: string = this.liveSlots[0].id
  ): void {
    const { sharedPartial, perSlotPartial } = splitMeasurementConfigPartial(partial);
    const hasShared = Object.keys(sharedPartial).length > 0;
    this.liveSlots = this.liveSlots.map((s) => {
      let nextCfg = s.config;
      if (hasShared) {
        nextCfg = { ...nextCfg, ...sharedPartial };
      }
      if (s.id === slotId && Object.keys(perSlotPartial).length > 0) {
        nextCfg = { ...nextCfg, ...perSlotPartial };
      }
      return nextCfg !== s.config ? { ...s, config: nextCfg } : s;
    });
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
    slotId: string = this.liveSlots[0].id
  ): void {
    this.sendToWorker({ type: 'load-calibration', slotId, text, name });
  }

  clearCalibration(slotId: string = this.liveSlots[0].id): void {
    this.calibrationNames.delete(slotId);
    this.sendToWorker({ type: 'clear-calibration', slotId });
  }

  findAndApplyDelay(slotId: string = this.liveSlots[0].id): void {
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
    slotId: string = this.liveSlots[0].id
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
    slotId: string = this.liveSlots[0].id
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
      if (hwSampleRate !== this.liveSlots[0].config.sampleRate) {
        this.updateMeasurementConfig({ sampleRate: hwSampleRate }, this.liveSlots[0].id);
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
