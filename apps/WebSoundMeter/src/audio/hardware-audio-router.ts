// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Hardware Web Audio graph and device router (`src/audio/hardware-audio-router.ts`).
 *
 * Manages:
 *  - `navigator.mediaDevices.enumerateDevices()` and raw `getUserMedia` capture (up to 64 channels)
 *  - `AudioContext`, `ChannelSplitterNode`, `ChannelMergerNode`, and `CaptureWorkletNode`
 *  - Dynamic multi-channel input routing: connects up to `maxTapSlots` actively used physical
 *    device channels from a 2..64+ channel interface into the worklet's capture tap inputs
 *  - Optional `inputOnly` mode for a secondary USB console stream running on its own independent
 *    native-clock `AudioContext` without touching generator outputs
 *  - iOS / iPadOS standalone PWA lifecycle resilience
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
  private readonly maxTapSlots: number;
  private readonly inputOnly: boolean;

  private audioContext: AudioContext | null = null;
  private workletModuleLoaded = false;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private splitterNode: ChannelSplitterNode | null = null;
  private captureWorkletNode: AudioWorkletNode | null = null;
  private fallbackScriptNode: ScriptProcessorNode | null = null;
  private outputMergerNode: ChannelMergerNode | null = null;
  private lastStartOptions: HardwareStreamStartOptions | null = null;

  private activePhysicalChannels: number[] = [0, 1];
  private generatorOutputChannel = -1;
  private availableChannels = 2;
  private availableOutputChannels = 2;

  constructor(maxTapSlots: number = MAX_CAPTURE_TAP_SLOTS, inputOnly: boolean = false) {
    this.maxTapSlots = Math.max(1, maxTapSlots);
    this.inputOnly = inputOnly;
  }

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

  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 48000;
  }

  getGeneratorOutputChannel(): number {
    return this.generatorOutputChannel;
  }

  getActivePhysicalChannels(): readonly number[] {
    return this.activePhysicalChannels;
  }

  isStreamHealthy(): boolean {
    if (!this.audioContext || !this.mediaStream) return false;
    if ((this.audioContext.state as string) !== 'running') return false;
    const tracks = this.mediaStream.getAudioTracks?.() ?? [];
    if (tracks.length === 0) return false;
    return tracks.some((t) => (t.readyState ?? 'live') !== 'ended');
  }

  hasOpenMediaStream(): boolean {
    if (!this.mediaStream) return false;
    const tracks = this.mediaStream.getTracks?.() ?? [];
    if (tracks.length === 0) return true;
    return tracks.some((t) => (t.readyState ?? 'live') !== 'ended');
  }

  async recoverStreamIfInterrupted(): Promise<number | null> {
    if (!this.lastStartOptions) return null;
    const tracks = this.mediaStream?.getAudioTracks?.() ?? [];
    const hasLiveTrack =
      tracks.length > 0 && tracks.some((t) => (t.readyState ?? 'live') !== 'ended');

    if (hasLiveTrack && this.audioContext) {
      if ((this.audioContext.state as string) !== 'running') {
        await this.audioContext.resume();
      }
      return this.audioContext.sampleRate;
    }

    return this.startStream(this.lastStartOptions);
  }

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
      if (ch >= 0 && !deduped.includes(ch) && deduped.length < this.maxTapSlots) {
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
    if (this.inputOnly) return;
    if (this.captureWorkletNode) {
      this.captureWorkletNode.port.postMessage({
        type: 'update-generator-config',
        config,
      });
    }
  }

  setPaused(paused: boolean): void {
    if (this.lastStartOptions) {
      this.lastStartOptions = { ...this.lastStartOptions, isPaused: paused };
    }
    if (this.captureWorkletNode) {
      this.captureWorkletNode.port.postMessage({ type: 'pause', paused });
    }
    if (!paused && this.audioContext && (this.audioContext.state as string) !== 'running') {
      void this.audioContext.resume().catch(() => {});
    }
  }

  private async acquireMediaStream(deviceId: string): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is unavailable in this browser context.');
    }

    const baseProcessingOff: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 64 },
    };

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { ...baseProcessingOff, deviceId: { exact: deviceId } }
          : baseProcessingOff,
      });
    } catch (err) {
      const errName = (err as { name?: string })?.name;
      if (
        deviceId &&
        !this.inputOnly &&
        (errName === 'OverconstrainedError' || errName === 'NotFoundError')
      ) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            audio: baseProcessingOff,
          });
        } catch (innerErr) {
          const innerName = (innerErr as { name?: string })?.name;
          if (innerName === 'OverconstrainedError') {
            return navigator.mediaDevices.getUserMedia({ audio: true });
          }
          throw innerErr;
        }
      }
      if (errName === 'OverconstrainedError') {
        return navigator.mediaDevices.getUserMedia(
          deviceId && this.inputOnly
            ? { audio: { deviceId: { exact: deviceId } } }
            : { audio: true }
        );
      }
      throw err;
    }
  }

  async startStream(options: HardwareStreamStartOptions): Promise<number> {
    this.stopStream(true);
    this.lastStartOptions = options;
    this.generatorOutputChannel = options.generatorOutputChannel;
    this.setActivePhysicalChannels(options.activePhysicalChannels);

    if (!this.audioContext || (this.audioContext.state as string) === 'closed') {
      this.audioContext = new AudioContext({ latencyHint: 'interactive' });
      this.workletModuleLoaded = false;
      this.audioContext.onstatechange = () => {
        if (
          this.mediaStream &&
          this.lastStartOptions &&
          !this.lastStartOptions.isPaused &&
          this.audioContext &&
          (this.audioContext.state as string) === 'interrupted'
        ) {
          void this.audioContext.resume().catch(() => {});
        }
      };
    }
    void this.audioContext.resume().catch(() => {});

    const streamPromise = this.acquireMediaStream(options.deviceId);
    this.mediaStream = await streamPromise;

    let useWorklet = Boolean(this.audioContext.audioWorklet?.addModule);
    if (useWorklet && !this.workletModuleLoaded) {
      try {
        await this.audioContext.audioWorklet.addModule(CaptureWorkletUrl);
        this.workletModuleLoaded = true;
      } catch {
        useWorklet = false;
      }
    }

    if (!this.inputOnly) {
      const maxOut = Math.min(64, Math.max(2, this.audioContext.destination.maxChannelCount || 2));
      this.availableOutputChannels = maxOut;
      try {
        this.audioContext.destination.channelCount = maxOut;
        this.audioContext.destination.channelCountMode = 'explicit';
        this.audioContext.destination.channelInterpretation = 'discrete';
      } catch {
        // Fallback to default stereo destination if browser disallows explicit channelCount
      }
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    const trackSettings = this.mediaStream.getAudioTracks()[0]?.getSettings?.();
    this.availableChannels = Math.max(
      2,
      trackSettings?.channelCount || this.sourceNode.channelCount || 2
    );
    this.splitterNode = this.audioContext.createChannelSplitter(this.availableChannels);
    if (!this.inputOnly) {
      this.outputMergerNode = this.audioContext.createChannelMerger(this.availableOutputChannels);
      this.outputMergerNode.connect(this.audioContext.destination);
    }

    if (useWorklet) {
      this.captureWorkletNode = new AudioWorkletNode(
        this.audioContext,
        'capture-tap-processor',
        {
          numberOfInputs: this.maxTapSlots,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        }
      );

      this.captureWorkletNode.port.postMessage({
        type: 'configure-taps',
        channelCount: this.inputOnly ? this.maxTapSlots : this.maxTapSlots + 1,
        inputOnly: this.inputOnly,
      });

      if (!this.inputOnly) {
        this.captureWorkletNode.port.postMessage({
          type: 'update-generator-config',
          config: options.generatorConfig,
        });
      }
      if (options.isPaused) {
        this.captureWorkletNode.port.postMessage({
          type: 'pause',
          paused: true,
        });
      }

      const canShareRingBuffer =
        options.ringBufferStorage !== null &&
        typeof SharedArrayBuffer !== 'undefined' &&
        options.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer &&
        ((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? true);

      if (canShareRingBuffer) {
        try {
          this.captureWorkletNode.port.postMessage({
            type: 'init-ring-buffer',
            storage: options.ringBufferStorage,
            inputOnly: this.inputOnly,
          });
        } catch {
          this.captureWorkletNode.port.onmessage = (e: MessageEvent) => {
            if (e.data?.type === 'audio-chunk' && Array.isArray(e.data.channels)) {
              options.onFallbackChunk(e.data.channels as Float32Array[]);
            }
          };
        }
      } else {
        this.captureWorkletNode.port.onmessage = (e: MessageEvent) => {
          if (e.data?.type === 'audio-chunk' && Array.isArray(e.data.channels)) {
            options.onFallbackChunk(e.data.channels as Float32Array[]);
          }
        };
      }

      this.sourceNode.connect(this.splitterNode);
      this.reconnectChannels();
    } else if (typeof this.audioContext.createScriptProcessor === 'function') {
      const tapCount = Math.min(this.maxTapSlots, this.availableChannels);
      const sp = this.audioContext.createScriptProcessor(2048, tapCount, 1);
      const chunkChannelCount = this.inputOnly ? this.maxTapSlots : this.maxTapSlots + 1;
      sp.onaudioprocess = (ev: AudioProcessingEvent) => {
        if (this.lastStartOptions?.isPaused) return;
        const inBuf = ev.inputBuffer;
        const len = inBuf.length;
        const zero = new Float32Array(len);
        const chunks: Float32Array[] = new Array(chunkChannelCount);
        for (let t = 0; t < this.maxTapSlots; t++) {
          const physCh = this.activePhysicalChannels[t];
          if (physCh !== undefined && physCh < inBuf.numberOfChannels) {
            chunks[t] = new Float32Array(inBuf.getChannelData(physCh));
          } else {
            chunks[t] = zero;
          }
        }
        if (!this.inputOnly) {
          chunks[this.maxTapSlots] = zero;
        }
        options.onFallbackChunk(chunks);
      };
      this.fallbackScriptNode = sp;
      this.sourceNode.connect(sp);
      sp.connect(this.audioContext.destination);
    }

    if ((this.audioContext.state as string) !== 'running') {
      await this.audioContext.resume();
    }

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

    if (this.inputOnly) {
      // Keep zero-filled output 0 connected to destination so pull-based audio graphs always tick process()
      if (this.audioContext) {
        this.captureWorkletNode.connect(this.audioContext.destination);
      }
      return;
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

  stopStream(preserveRestartConfig: boolean = false): void {
    if (!preserveRestartConfig) {
      this.lastStartOptions = null;
    }
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
    if (this.fallbackScriptNode) {
      this.fallbackScriptNode.onaudioprocess = null;
      this.fallbackScriptNode.disconnect();
      this.fallbackScriptNode = null;
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
    this.stopStream(false);
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
      this.workletModuleLoaded = false;
    }
  }
}
