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
 * Manages:
 *  - Background `dsp.worker.ts` lifecycle and message routing
 *  - Input mode switching between 'simulator' (Built-in Demo Simulator) and 'hardware' (Web Audio `getUserMedia`)
 *  - Raw measurement audio constraints (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`)
 *  - Multi-channel `ChannelSplitterNode` routing for Measurement (M) and Reference (R)
 *  - Optional Web Audio monitor output for the Signal Generator
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
import { createRingBufferStorage, RingBufferStorage } from './ring-buffer.js';
import CaptureWorkletUrl from './worklets/capture-worklet.ts?worker&url';

export interface AudioDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

export type FrameUpdateCallback = (liveSource: SourceData) => void;
export type ConfigUpdateCallback = (config: MeasurementPipelineConfig) => void;

export class AudioEngine {
  private worker: Worker;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private splitterNode: ChannelSplitterNode | null = null;
  private captureWorkletNode: AudioWorkletNode | null = null;
  private outputMergerNode: ChannelMergerNode | null = null;
  private ringBufferStorage: RingBufferStorage | null = null;

  private inputMode: InputSourceMode = 'simulator';
  private simulatorPreset: SimulatorPresetId = 'pa-room-modes';
  private simulatorConfig: SimulatorRigConfig = SIMULATOR_PRESETS['pa-room-modes'];
  private measurementConfig: MeasurementPipelineConfig = { ...DEFAULT_MEASUREMENT_CONFIG };
  private generatorConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };

  private selectedDeviceId: string = '';
  private measurementChannel: number = 0;
  /** Reference input channel index (0..N-1), or -1 to use internal Signal Generator loopback */
  private referenceChannel: number = 1;
  /** Hardware output channel index (0..N-1), -1 for Stereo (Ch 1+2), or -2 for Muted */
  private generatorOutputChannel: number = -1;
  private availableChannels: number = 2;
  private availableOutputChannels: number = 2;
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

    this.sendToWorker({
      type: 'init',
      sampleRate: 48000,
      ringBufferStorage:
        this.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer
          ? this.ringBufferStorage
          : undefined,
    });
  }

  private sendToWorker(message: WorkerInboundMessage): void {
    this.worker.postMessage(message);
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
    if (this.captureWorkletNode) {
      this.captureWorkletNode.port.postMessage({ type: 'pause', paused });
    }
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
    if (this.captureWorkletNode) {
      this.captureWorkletNode.port.postMessage({
        type: 'update-generator-config',
        config: this.generatorConfig,
      });
    }
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

  async listInputDevices(): Promise<AudioDeviceOption[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Audio Input ${idx + 1}`,
        }));
    } catch {
      return [];
    }
  }

  async setInputMode(
    mode: InputSourceMode,
    deviceId?: string,
    measChannel: number = this.measurementChannel,
    refChannel: number = this.referenceChannel
  ): Promise<void> {
    this.inputMode = mode;
    this.measurementChannel = measChannel;
    this.referenceChannel = refChannel;

    if (mode === 'simulator') {
      this.stopHardwareStream();
      this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      return;
    }

    if (deviceId !== undefined) {
      this.selectedDeviceId = deviceId;
    }

    try {
      await this.startHardwareStream();
    } catch (err) {
      this.inputMode = 'simulator';
      this.sendToWorker({ type: 'set-input-mode', mode: 'simulator' });
      throw err;
    }
  }

  getAvailableChannels(): number {
    return this.availableChannels;
  }

  getAvailableOutputChannels(): number {
    return this.availableOutputChannels;
  }

  getChannelRouting(): {
    measurementChannel: number;
    referenceChannel: number;
    generatorOutputChannel: number;
  } {
    return {
      measurementChannel: this.measurementChannel,
      referenceChannel: this.referenceChannel,
      generatorOutputChannel: this.generatorOutputChannel,
    };
  }

  setChannelRouting(
    measurementChannel: number,
    referenceChannel: number,
    generatorOutputChannel: number = this.generatorOutputChannel
  ): void {
    this.measurementChannel = measurementChannel;
    this.referenceChannel = referenceChannel;
    this.generatorOutputChannel = generatorOutputChannel;
    this.reconnectChannels();
  }

  setGeneratorOutputChannel(outputChannel: number): void {
    this.generatorOutputChannel = outputChannel;
    this.reconnectChannels();
  }

  private async startHardwareStream(): Promise<void> {
    this.stopHardwareStream();

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      await this.audioContext.audioWorklet.addModule(CaptureWorkletUrl);
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Configure multi-channel hardware output if supported by the audio interface
    const maxOut = Math.min(32, Math.max(2, this.audioContext.destination.maxChannelCount || 2));
    this.availableOutputChannels = maxOut;
    try {
      this.audioContext.destination.channelCount = maxOut;
      this.audioContext.destination.channelCountMode = 'explicit';
      this.audioContext.destination.channelInterpretation = 'discrete';
    } catch {
      // Fallback to default stereo destination if browser disallows explicit channelCount
    }

    if (this.audioContext.sampleRate !== this.measurementConfig.sampleRate) {
      this.updateMeasurementConfig({ sampleRate: this.audioContext.sampleRate });
    }
    this.sendToWorker({ type: 'set-input-mode', mode: 'hardware' });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.selectedDeviceId ? { exact: this.selectedDeviceId } : undefined,
        echoCancellation: { exact: false },
        noiseSuppression: { exact: false },
        autoGainControl: { exact: false },
        channelCount: { ideal: 32 },
        sampleRate: { ideal: this.audioContext.sampleRate },
      },
    });

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    const trackSettings = this.mediaStream.getAudioTracks()[0]?.getSettings?.();
    this.availableChannels = Math.max(
      2,
      trackSettings?.channelCount || this.sourceNode.channelCount || 2
    );
    this.splitterNode = this.audioContext.createChannelSplitter(this.availableChannels);
    this.outputMergerNode = this.audioContext.createChannelMerger(this.availableOutputChannels);
    this.outputMergerNode.connect(this.audioContext.destination);

    this.captureWorkletNode = new AudioWorkletNode(
      this.audioContext,
      'capture-tap-processor',
      {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      }
    );

    this.captureWorkletNode.port.postMessage({
      type: 'update-generator-config',
      config: this.generatorConfig,
    });
    if (this.isPaused) {
      this.captureWorkletNode.port.postMessage({
        type: 'pause',
        paused: true,
      });
    }

    if (
      this.ringBufferStorage &&
      this.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer
    ) {
      this.captureWorkletNode.port.postMessage({
        type: 'init-ring-buffer',
        storage: this.ringBufferStorage,
      });
    } else {
      this.captureWorkletNode.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'audio-chunk') {
          this.sendToWorker({
            type: 'audio-chunk',
            m: e.data.m,
            r: e.data.r,
          });
        }
      };
    }

    this.sourceNode.connect(this.splitterNode);
    this.reconnectChannels();
  }

  private reconnectChannels(): void {
    if (!this.splitterNode || !this.captureWorkletNode) return;
    this.splitterNode.disconnect();
    this.captureWorkletNode.disconnect();

    const mCh = Math.max(0, Math.min(this.measurementChannel, this.availableChannels - 1));
    this.splitterNode.connect(this.captureWorkletNode, mCh, 0);

    const useInternalGenAsRef = this.referenceChannel < 0;
    this.captureWorkletNode.port.postMessage({
      type: 'set-ref-loopback',
      useInternalGenAsRef,
    });
    if (!useInternalGenAsRef) {
      const rCh = Math.max(0, Math.min(this.referenceChannel, this.availableChannels - 1));
      this.splitterNode.connect(this.captureWorkletNode, rCh, 1);
    }

    if (this.outputMergerNode && this.generatorOutputChannel !== -2) {
      if (this.generatorOutputChannel === -1) {
        // Stereo Ch 1 + Ch 2
        this.captureWorkletNode.connect(this.outputMergerNode, 0, 0);
        if (this.availableOutputChannels > 1) {
          this.captureWorkletNode.connect(this.outputMergerNode, 0, 1);
        }
      } else {
        const outCh = Math.max(
          0,
          Math.min(this.generatorOutputChannel, this.availableOutputChannels - 1)
        );
        this.captureWorkletNode.connect(this.outputMergerNode, 0, outCh);
      }
    }
  }

  private stopHardwareStream(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.splitterNode) {
      this.splitterNode.disconnect();
      this.splitterNode = null;
    }
    if (this.captureWorkletNode) {
      this.captureWorkletNode.disconnect();
      this.captureWorkletNode = null;
    }
    if (this.outputMergerNode) {
      this.outputMergerNode.disconnect();
      this.outputMergerNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
  }

  /**
   * Stops hardware streams, closes the Web Audio context, and terminates the background DSP worker.
   */
  dispose(): void {
    this.stopHardwareStream();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.worker.terminate();
    this.frameListeners.clear();
    this.configListeners.clear();
  }
}

