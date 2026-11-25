// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dual-Device Hardware Capture Coordinator (`DualDeviceCaptureCoordinator`).
 *
 * Coordinates the primary `HardwareAudioRouter` (up to 8 measurement taps + internal loopback)
 * alongside an optional independent secondary USB console `HardwareAudioRouter` (up to 32 mixer
 * input taps on its own native-clock `AudioContext` + `SharedArrayBuffer` ring buffer), including
 * automatic single-route mobile OS preemption recovery.
 */

import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../dsp/signal-generator.js';
import {
  MixerWatchSessionConfig,
  collectEnabledMixerPhysicalChannels,
} from '../sources/mixer-patch-storage.js';
import { AudioDeviceOption, HardwareAudioRouter } from './hardware-audio-router.js';
import {
  MAX_CAPTURE_TAP_SLOTS,
  MIXER_CAPTURE_TAP_SLOTS,
  RingBufferStorage,
  TOTAL_RING_BUFFER_SLOTS,
  createRingBufferStorage,
} from './ring-buffer.js';

export interface DualDeviceCaptureCallbacks {
  readonly onPrimaryFallbackChunk: (channels: Float32Array[]) => void;
  readonly onMixerFallbackChunk: (channels: Float32Array[]) => void;
}

export class DualDeviceCaptureCoordinator {
  public readonly primaryRouter = new HardwareAudioRouter(MAX_CAPTURE_TAP_SLOTS, false);
  public readonly secondaryMixerRouter = new HardwareAudioRouter(
    MIXER_CAPTURE_TAP_SLOTS,
    true
  );
  public ringBufferStorage: RingBufferStorage;
  public mixerRingBufferStorage: RingBufferStorage;

  private mixerDeviceSwitchSeq = 0;
  private statusNotice = '';

  constructor(private readonly callbacks: DualDeviceCaptureCallbacks) {
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
  }

  public canShareRingBuffer(): boolean {
    return (
      typeof SharedArrayBuffer !== 'undefined' &&
      this.ringBufferStorage.headerBuffer instanceof SharedArrayBuffer
    );
  }

  public downgradeToLocalRingBuffers(): void {
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

  public getStatusNotice(): string {
    return this.statusNotice;
  }

  public clearStatusNotice(): void {
    this.statusNotice = '';
  }

  public listInputDevices(): Promise<AudioDeviceOption[]> {
    return this.primaryRouter.listInputDevices();
  }

  public setPaused(paused: boolean): void {
    this.primaryRouter.setPaused(paused);
    this.secondaryMixerRouter.setPaused(paused);
  }

  public stopAllStreams(closeContext: boolean = true): void {
    this.primaryRouter.stopStream(closeContext);
    this.secondaryMixerRouter.stopStream(closeContext);
  }

  public hasActiveCapture(): boolean {
    return (
      this.primaryRouter.hasOpenMediaStream() ||
      this.secondaryMixerRouter.hasOpenMediaStream()
    );
  }

  public isSeparateMixerActive(
    isHardwareMode: boolean,
    selectedDeviceId: string,
    cfg: MixerWatchSessionConfig
  ): boolean {
    return (
      isHardwareMode &&
      cfg.enabled &&
      cfg.deviceMode === 'separate-device' &&
      cfg.separateDeviceId.length > 0 &&
      cfg.separateDeviceId !== selectedDeviceId
    );
  }

  public async startPrimaryStream(params: {
    readonly deviceId: string;
    readonly activePhysicalChannels: readonly number[];
    readonly generatorConfig: SignalGeneratorConfig;
    readonly isPaused: boolean;
  }): Promise<number> {
    return this.primaryRouter.startStream({
      deviceId: params.deviceId,
      activePhysicalChannels: params.activePhysicalChannels,
      generatorOutputChannel: this.primaryRouter.getGeneratorOutputChannel(),
      generatorConfig: params.generatorConfig,
      isPaused: params.isPaused,
      ringBufferStorage: this.ringBufferStorage,
      onFallbackChunk: this.callbacks.onPrimaryFallbackChunk,
    });
  }

  /**
   * Starts or updates the secondary USB console stream when `deviceMode === 'separate-device'`.
   * Returns an updated `MixerWatchSessionConfig` if a single-route mobile OS preempted the
   * primary measurement mic and forced a fallback to `'follow-main'`.
   */
  public async startSecondaryMixerStream(params: {
    readonly isHardwareMode: boolean;
    readonly selectedDeviceId: string;
    readonly isPaused: boolean;
    readonly config: MixerWatchSessionConfig;
  }): Promise<MixerWatchSessionConfig> {
    const seq = ++this.mixerDeviceSwitchSeq;
    const { isHardwareMode, selectedDeviceId, isPaused, config } = params;

    if (!this.isSeparateMixerActive(isHardwareMode, selectedDeviceId, config)) {
      this.secondaryMixerRouter.stopStream();
      return config;
    }

    try {
      await this.secondaryMixerRouter.startStream({
        deviceId: config.separateDeviceId,
        activePhysicalChannels: collectEnabledMixerPhysicalChannels(config, -1),
        generatorOutputChannel: -2,
        generatorConfig: { ...DEFAULT_GENERATOR_CONFIG, enabled: false },
        isPaused,
        ringBufferStorage: this.mixerRingBufferStorage,
        onFallbackChunk: this.callbacks.onMixerFallbackChunk,
      });

      if (seq !== this.mixerDeviceSwitchSeq) return config;

      if (!this.primaryRouter.isStreamHealthy()) {
        this.secondaryMixerRouter.stopStream();
        await this.primaryRouter.recoverStreamIfInterrupted();
        this.statusNotice =
          'This OS only allows one active audio interface — switched Mixer Watch to Follow Main Input.';
        return {
          ...config,
          deviceMode: 'follow-main',
        };
      }
    } catch (err) {
      if (seq === this.mixerDeviceSwitchSeq) {
        this.secondaryMixerRouter.stopStream();
        const reason =
          err instanceof Error && err.message ? err.message : 'Device unavailable.';
        this.statusNotice = `Could not open separate mixer device (${reason})`;
      }
    }

    return config;
  }

  public dispose(): void {
    this.primaryRouter.dispose();
    this.secondaryMixerRouter.dispose();
  }
}
