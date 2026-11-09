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
 *  - `navigator.mediaDevices.enumerateDevices()` and raw `getUserMedia` capture (up to 64 channels)
 *  - `AudioContext`, `ChannelSplitterNode`, `ChannelMergerNode`, and `CaptureWorkletNode`
 *  - Dynamic multi-channel input routing: connects up to 8 actively used physical device channels
 *    from a 2..64+ channel interface into the worklet's 8 capture tap inputs
 *  - Multi-channel hardware output routing for the real-time Signal Generator
 */

import { SignalGeneratorConfig } from '../dsp/signal-generator.js';
import { MAX_CAPTURE_TAP_SLOTS, RingBufferStorage } from './ring-buffer.js';
import CaptureWorkletUrl from './worklets/capture-worklet.ts?worker&url';

export interface AudioDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

export interface HardwareStreamStartOptions {
  readonly deviceId: string;
  readonly activePhysicalChannels: readonly number[];
  readonly generatorOutputChannel: number;
  readonly generatorConfig: SignalGeneratorConfig;
  readonly isPaused: boolean;
  readonly ringBufferStorage: RingBufferStorage | null;
  readonly onFallbackChunk: (channels: Float32Array[]) => void;
}

export class HardwareAudioRouter {
  private audioContext: AudioContext | null = null;
  private workletModuleLoaded = false;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private splitterNode: ChannelSplitterNode | null = null;
  private captureWorkletNode: AudioWorkletNode | null = null;
  private outputMergerNode: ChannelMergerNode | null = null;

  private activePhysicalChannels: number[] = [0, 1];
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
        .filter((d) => d.kind === 'audioinput' && Boolean(d.deviceId))
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

  getGeneratorOutputChannel(): number {
    return this.generatorOutputChannel;
  }

  getActivePhysicalChannels(): readonly number[] {
    return this.activePhysicalChannels;
  }

  /**
   * Computes the mapping from physical hardware channel index (0-based, e.g. 0..63)
   * to capture worklet tap slot index (0..7).
   */
  getChannelTapMap(): Record<number, number> {
    const map: Record<number, number> = {};
    for (let tapIdx = 0; tapIdx < this.activePhysicalChannels.length; tapIdx++) {
      const ch = this.activePhysicalChannels[tapIdx];
      map[ch] = tapIdx;
    }
    return map;
  }

  setActivePhysicalChannels(physicalChannels: readonly number[]): Record<number, number> {
    const deduped: number[] = [];
    for (const ch of physicalChannels) {
      if (ch >= 0 && !deduped.includes(ch) && deduped.length < MAX_CAPTURE_TAP_SLOTS) {
        deduped.push(ch);
      }
    }
    if (deduped.length === 0) {
      deduped.push(0);
    }
    this.activePhysicalChannels = deduped;
    this.reconnectChannels();
    return this.getChannelTapMap();
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
    this.generatorOutputChannel = options.generatorOutputChannel;
    this.setActivePhysicalChannels(options.activePhysicalChannels);

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      this.workletModuleLoaded = false;
    }
    if (!this.workletModuleLoaded) {
      await this.audioContext.audioWorklet.addModule(CaptureWorkletUrl);
      this.workletModuleLoaded = true;
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const maxOut = Math.min(64, Math.max(2, this.audioContext.destination.maxChannelCount || 2));
    this.availableOutputChannels = maxOut;
    try {
      this.audioContext.destination.channelCount = maxOut;
      this.audioContext.destination.channelCountMode = 'explicit';
      this.audioContext.destination.channelInterpretation = 'discrete';
    } catch {
      // Fallback to default stereo destination if browser disallows explicit channelCount
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
          channelCount: { ideal: 64 },
          sampleRate: { ideal: this.audioContext.sampleRate },
        },
      });
    } catch (err) {
      // If a saved deviceId was unplugged or the driver rejected `{ exact: false }`,
      // retry with ideal boolean constraints before failing.
      const errName = (err as { name?: string })?.name;
      if (errName === 'OverconstrainedError' || errName === 'NotFoundError') {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: options.deviceId ? { ideal: options.deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 64 },
            sampleRate: { ideal: this.audioContext.sampleRate },
          },
        });
      } else {
        throw err;
      }
    }

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
        numberOfInputs: MAX_CAPTURE_TAP_SLOTS,
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
        if (e.data?.type === 'audio-chunk' && Array.isArray(e.data.channels)) {
          options.onFallbackChunk(e.data.channels as Float32Array[]);
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

    for (let tapIdx = 0; tapIdx < this.activePhysicalChannels.length; tapIdx++) {
      const requestedCh = this.activePhysicalChannels[tapIdx];
      const physicalCh = Math.max(0, Math.min(requestedCh, this.availableChannels - 1));
      this.splitterNode.connect(this.captureWorkletNode, physicalCh, tapIdx);
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
      this.workletModuleLoaded = false;
    }
  }
}
