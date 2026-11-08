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
 * AudioEngine & DSP Worker Controller (`src/audio/audio-engine.ts`).
 *
 * Manages background `dsp.worker.ts` lifecycle, message dispatch, and state synchronization,
 * delegating Web Audio hardware stream/channel routing to `HardwareAudioRouter`.
 */

import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipelineConfig,
} from '../dsp/analyzer-pipeline.js';
import { InputSourceMode, WorkerInboundMessage } from '../dsp/dsp.worker.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
  SimulatorRigConfig,
} from '../dsp/synthetic-rig.js';
import { SourceData } from '../sources/source-data.js';
import { AudioDeviceOption, HardwareAudioRouter } from './hardware-audio-router.js';
import { createRingBufferStorage, RingBufferStorage } from './ring-buffer.js';

export type { AudioDeviceOption };

export type FrameUpdateCallback = (liveSource: SourceData) => void;
export type ConfigUpdateCallback = (config: MeasurementPipelineConfig) => void;

export class AudioEngine {
  private readonly worker: Worker;
  private readonly hardwareRouter = new HardwareAudioRouter();
  private ringBufferStorage: RingBufferStorage | null = null;

  private inputMode: InputSourceMode = 'simulator';
  private simulatorPreset: SimulatorPresetId = 'pa-room-modes';
  private simulatorConfig: SimulatorRigConfig = SIMULATOR_PRESETS['pa-room-modes'];
  private measurementConfig: MeasurementPipelineConfig = { ...DEFAULT_MEASUREMENT_CONFIG };
  private generatorConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };

  private selectedDeviceId: string = '';
  private isPaused: boolean = false;
  private calibrationName: string | null = null;

  private readonly frameListeners = new Set<FrameUpdateCallback>();
  private readonly configListeners = new Set<ConfigUpdateCallback>();

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

      if (msg.type === 'measurement-frame' && msg.sourceData) {
        const sd = msg.sourceData as SourceData;
        for (const listener of this.frameListeners) {
          listener(sd);
        }
      } else if (msg.type === 'measurement-config-updated' && msg.config) {
        this.measurementConfig = msg.config as MeasurementPipelineConfig;
        for (const listener of this.configListeners) {
          listener(this.measurementConfig);
        }
      } else if (msg.type === 'simulator-config-updated' && msg.config) {
        this.simulatorConfig = msg.config as SimulatorRigConfig;
      } else if (msg.type === 'calibration-loaded') {
        this.calibrationName = `${msg.name} (${msg.pointCount} pts)`;
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
  }

  private sendToWorker(msg: WorkerInboundMessage): void {
    this.worker.postMessage(msg);
  }

  onFrame(listener: FrameUpdateCallback): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onMeasurementConfigChange(listener: ConfigUpdateCallback): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  getInputMode(): InputSourceMode {
    return this.inputMode;
  }

  getSimulatorPreset(): SimulatorPresetId {
    return this.simulatorPreset;
  }

  getSimulatorConfig(): SimulatorRigConfig {
    return this.simulatorConfig;
  }

  getMeasurementConfig(): MeasurementPipelineConfig {
    return this.measurementConfig;
  }

  getGeneratorConfig(): SignalGeneratorConfig {
    return this.generatorConfig;
  }

  getCalibrationName(): string | null {
    return this.calibrationName;
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.sendToWorker({ type: 'pause', paused });
    this.hardwareRouter.setPaused(paused);
  }

  setSimulatorPreset(presetId: SimulatorPresetId): void {
    this.simulatorPreset = presetId;
    this.simulatorConfig = SIMULATOR_PRESETS[presetId];
    this.sendToWorker({ type: 'set-simulator-preset', preset: presetId });
  }

  setCustomSimulatorConfig(config: SimulatorRigConfig): void {
    this.simulatorConfig = config;
    this.sendToWorker({ type: 'set-simulator-preset', preset: config });
  }

  updateMeasurementConfig(partial: Partial<MeasurementPipelineConfig>): void {
    this.measurementConfig = { ...this.measurementConfig, ...partial };
    this.sendToWorker({ type: 'update-measurement-config', config: partial });
  }

  updateGeneratorConfig(partial: Partial<SignalGeneratorConfig>): void {
    this.generatorConfig = { ...this.generatorConfig, ...partial };
    this.sendToWorker({ type: 'update-generator-config', config: partial });
    this.hardwareRouter.updateGeneratorConfig(this.generatorConfig);
  }

  loadCalibrationFile(text: string, name: string): void {
    this.sendToWorker({ type: 'load-calibration', text, name });
  }

  clearCalibration(): void {
    this.calibrationName = null;
    this.sendToWorker({ type: 'clear-calibration' });
  }

  findAndApplyDelay(): void {
    this.sendToWorker({ type: 'apply-estimated-delay' });
  }

  resetAveraging(): void {
    this.sendToWorker({ type: 'reset-averaging' });
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

  getChannelRouting(): {
    measurementChannel: number;
    referenceChannel: number;
    generatorOutputChannel: number;
  } {
    return this.hardwareRouter.getChannelRouting();
  }

  setChannelRouting(
    measurementChannel: number,
    referenceChannel: number,
    generatorOutputChannel?: number
  ): void {
    this.hardwareRouter.setChannelRouting(
      measurementChannel,
      referenceChannel,
      generatorOutputChannel
    );
  }

  setGeneratorOutputChannel(outputChannel: number): void {
    this.hardwareRouter.setGeneratorOutputChannel(outputChannel);
  }

  async setInputMode(
    mode: InputSourceMode,
    deviceId?: string,
    measChannel?: number,
    refChannel?: number
  ): Promise<void> {
    this.inputMode = mode;
    const currentRouting = this.hardwareRouter.getChannelRouting();
    const nextMeas = measChannel ?? currentRouting.measurementChannel;
    const nextRef = refChannel ?? currentRouting.referenceChannel;

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
        measurementChannel: nextMeas,
        referenceChannel: nextRef,
        generatorOutputChannel: currentRouting.generatorOutputChannel,
        generatorConfig: this.generatorConfig,
        isPaused: this.isPaused,
        ringBufferStorage: this.ringBufferStorage,
        onFallbackChunk: (m, r) => {
          this.sendToWorker({ type: 'audio-chunk', m, r });
        },
      });

      if (hwSampleRate !== this.measurementConfig.sampleRate) {
        this.updateMeasurementConfig({ sampleRate: hwSampleRate });
      }
      this.sendToWorker({ type: 'set-input-mode', mode: 'hardware' });
    } catch (err) {
      this.inputMode = 'simulator';
      this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      throw err;
    }
  }

  dispose(): void {
    this.hardwareRouter.dispose();
    this.worker.terminate();
    this.frameListeners.clear();
    this.configListeners.clear();
  }
}
