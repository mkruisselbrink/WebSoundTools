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
 * Hardware Web Audio graph and device router (`src/audio/hardware-audio-router.ts`).
 *
 * Manages:
 *  - `navigator.mediaDevices.enumerateDevices()` and raw `getUserMedia` capture
 *  - `AudioContext`, `ChannelSplitterNode`, `ChannelMergerNode`, and `CaptureWorkletNode`
 *  - Multi-channel input routing (Measurement + Reference or Internal Generator loopback)
 *  - Multi-channel hardware output routing for the real-time Signal Generator
 */

import { SignalGeneratorConfig } from '../dsp/signal-generator.js';
import { RingBufferStorage } from './ring-buffer.js';
import CaptureWorkletUrl from './worklets/capture-worklet.ts?worker&url';

export interface AudioDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

export interface HardwareStreamStartOptions {
  readonly deviceId: string;
  readonly measurementChannel: number;
  readonly referenceChannel: number;
  readonly generatorOutputChannel: number;
  readonly generatorConfig: SignalGeneratorConfig;
  readonly isPaused: boolean;
  readonly ringBufferStorage: RingBufferStorage | null;
  readonly onFallbackChunk: (m: Float32Array, r: Float32Array) => void;
}

export class HardwareAudioRouter {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private splitterNode: ChannelSplitterNode | null = null;
  private captureWorkletNode: AudioWorkletNode | null = null;
  private outputMergerNode: ChannelMergerNode | null = null;

  private measurementChannel = 0;
  private referenceChannel = 1;
  private generatorOutputChannel = -1;
  private availableChannels = 2;
  private availableOutputChannels = 2;

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

  updateGeneratorConfig(config: SignalGeneratorConfig): void {
    if (this.captureWorkletNode) {
      this.captureWorkletNode.port.postMessage({
        type: 'update-generator-config',
        config,
      });
    }
  }

  setPaused(paused: boolean): void {
    if (this.captureWorkletNode) {
      this.captureWorkletNode.port.postMessage({ type: 'pause', paused });
    }
  }

  async startStream(options: HardwareStreamStartOptions): Promise<number> {
    this.stopStream();
    this.measurementChannel = options.measurementChannel;
    this.referenceChannel = options.referenceChannel;
    this.generatorOutputChannel = options.generatorOutputChannel;

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      await this.audioContext.audioWorklet.addModule(CaptureWorkletUrl);
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const maxOut = Math.min(32, Math.max(2, this.audioContext.destination.maxChannelCount || 2));
    this.availableOutputChannels = maxOut;
    try {
      this.audioContext.destination.channelCount = maxOut;
      this.audioContext.destination.channelCountMode = 'explicit';
      this.audioContext.destination.channelInterpretation = 'discrete';
    } catch {
      // Fallback to default stereo destination if browser disallows explicit channelCount
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
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
      config: options.generatorConfig,
    });
    if (options.isPaused) {
      this.captureWorkletNode.port.postMessage({
        type: 'pause',
        paused: true,
      });
    }

    if (
      options.ringBufferStorage &&
      options.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer
    ) {
      this.captureWorkletNode.port.postMessage({
        type: 'init-ring-buffer',
        storage: options.ringBufferStorage,
      });
    } else {
      this.captureWorkletNode.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'audio-chunk') {
          options.onFallbackChunk(e.data.m, e.data.r);
        }
      };
    }

    this.sourceNode.connect(this.splitterNode);
    this.reconnectChannels();

    return this.audioContext.sampleRate;
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

  stopStream(): void {
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

  dispose(): void {
    this.stopStream();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
