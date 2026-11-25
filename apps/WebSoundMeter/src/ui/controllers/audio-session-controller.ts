// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { downloadTextFile } from '@foh/ui';
import {
  AudioDeviceOption,
  AudioEngine,
  LiveMeasurementSlotConfig,
} from '../../audio/audio-engine.js';
import type { MeasurementPipelineConfig } from '../../dsp/analyzer-pipeline.js';
import type { InputSourceMode } from '../../dsp/dsp-worker-protocol.js';
import {
  DEFAULT_GENERATOR_CONFIG,
  SignalGeneratorConfig,
} from '../../dsp/signal-generator.js';
import type { SplHistoryWindowSec } from '../../dsp/spl-history.js';
import { CalibrationManager } from '../../sources/calibration-manager.js';
import {
  clearSplShowCheckpointsFromDb,
  loadAllSplShowCheckpointsFromDb,
  saveSplShowCheckpointsToDb,
} from '../../sources/session-storage.js';
import { isLiveSourceId, SourceStore } from '../../sources/source-store.js';
import {
  DEFAULT_AUTO_RELEASE_MINUTES,
  WorkspaceSessionSnapshot,
} from '../../sources/workspace-session.js';
import { ScreenWakeLockController } from '../wake-lock.js';
import { WorkspaceLayoutController } from '../workspace-store.js';
import {
  MixerDeviceIdentity,
  MixerWatchController,
} from './mixer-watch-controller.js';

/**
 * Stateful audio, hardware routing, warm-pause / disconnect standby, calibration,
 * wake-lock, and session-persistence controller for `<web-sound-meter-app>`.
 */
export class AudioSessionController {
  public engine: AudioEngine | null = null;
  public readonly calibrationMgr = new CalibrationManager();

  public audioDevices: AudioDeviceOption[] = [];
  public selectedDeviceId = '';
  public selectedDeviceLabel = '';
  public availableChannels = 2;
  public availableOutputChannels = 2;
  public globalReferenceChannel = 1;
  public generatorOutputChannel = -1;
  public autoReleaseMinutes = DEFAULT_AUTO_RELEASE_MINUTES;
  public genConfig: SignalGeneratorConfig = { ...DEFAULT_GENERATOR_CONFIG };
  public isPaused = false;
  public hardwareStreamDeferred = false;
  public hardwareDisconnectReason: 'launch' | 'manual' | 'auto-idle' = 'launch';
  public audioStatusError = '';
  public wakeLockActive = false;
  public mixerChannelLevelsDbFs: Readonly<Record<number, number>> = {};
  public revision = 0;

  private readonly listeners = new Set<() => void>();
  private pauseAutoReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveringHardwareAudio = false;

  private readonly wakeLock = new ScreenWakeLockController({
    onChange: (active) => {
      if (this.wakeLockActive !== active) {
        this.wakeLockActive = active;
        this.notify();
      }
    },
  });

  private readonly foregroundAudioRecoveryHandler = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    void this.recoverHardwareAudioIfNeeded();
  };

  private readonly gestureAudioRecoveryHandler = (): void => {
    if (
      this.workspace.audioInputMode === 'hardware' &&
      !this.isPaused &&
      !this.hardwareStreamDeferred &&
      this.engine &&
      !this.engine.isHardwareStreamHealthy()
    ) {
      void this.recoverHardwareAudioIfNeeded();
    }
  };

  constructor(
    public readonly workspace: WorkspaceLayoutController,
    public readonly sourceStore: SourceStore,
    public readonly mixerWatch: MixerWatchController
  ) {}

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify(): void {
    this.revision++;
    for (const fn of this.listeners) {
      fn();
    }
  }

  public get isHardwareDisconnected(): boolean {
    return (
      this.workspace.audioInputMode === 'hardware' &&
      (this.hardwareStreamDeferred || !(this.engine?.hasActiveHardwareCapture() ?? false))
    );
  }

  public connect(
    session: WorkspaceSessionSnapshot,
    initialSimulatorPreset: LiveMeasurementSlotConfig['simulatorPreset']
  ): void {
    this.selectedDeviceId = session.hardwareRouting.selectedDeviceId;
    this.selectedDeviceLabel = session.hardwareRouting.selectedDeviceLabel;
    this.globalReferenceChannel = session.hardwareRouting.globalReferenceChannel;
    this.generatorOutputChannel = session.hardwareRouting.generatorOutputChannel;
    this.autoReleaseMinutes =
      session.hardwareRouting.autoReleaseMinutes ?? DEFAULT_AUTO_RELEASE_MINUTES;

    const hydratedSlots = session.liveSlots.map((slot, idx) =>
      idx === 0 && this.workspace.audioInputMode === 'simulator'
        ? { ...slot, simulatorPreset: initialSimulatorPreset }
        : slot
    );

    this.engine = new AudioEngine();
    this.engine.setGlobalReferenceChannel(this.globalReferenceChannel);
    this.engine.setLiveSlots(hydratedSlots);
    void this.engine.setMixerWatchConfig(this.mixerWatch.config);

    const safeGenConfig =
      this.workspace.workspaceMode === 'show' &&
      this.workspace.audioInputMode === 'hardware'
        ? { ...session.genConfig, enabled: false }
        : session.genConfig;
    this.engine.updateGeneratorConfig(safeGenConfig);
    this.engine.setGeneratorOutputChannel(this.generatorOutputChannel);
    this.genConfig = { ...this.engine.getGeneratorConfig() };

    if (this.workspace.audioInputMode === 'hardware') {
      this.isPaused = true;
      this.hardwareStreamDeferred = true;
      this.hardwareDisconnectReason = 'launch';
      this.engine.setPaused(true);
    }

    void this.engine.listInputDevices().then((devices) => {
      if (devices.length > 0) {
        this.audioDevices = devices;
        this.notify();
      }
    });

    this.engine.onLiveFrames((frames, mixerTelemetry) => {
      this.mixerChannelLevelsDbFs = mixerTelemetry?.channelLevelsDbFs ?? {};
      this.sourceStore.setLiveFrames(frames, mixerTelemetry?.mixerOnlyFeedbackTracks, {
        trustFrameVisibility: true,
      });
    });

    this.engine.onMeasurementConfigChange(() => {
      this.persistState('none');
      this.notify();
    });

    this.engine.onSplHistoryCheckpoints((checkpoints) => {
      void saveSplShowCheckpointsToDb(checkpoints);
    });

    this.engine.onSplCsvExported((csvText: string) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadTextFile(
        csvText,
        `websoundmeter-spl-log-${stamp}.csv`,
        'text/csv;charset=utf-8'
      );
    });

    void this.hydratePersistentStores();
    this.syncWakeLock();

    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', this.foregroundAudioRecoveryHandler);
      window.addEventListener('pointerdown', this.gestureAudioRecoveryHandler, {
        passive: true,
      });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.foregroundAudioRecoveryHandler);
    }
  }

  public disconnect(): void {
    this.clearPauseAutoReleaseTimer();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pageshow', this.foregroundAudioRecoveryHandler);
      window.removeEventListener('pointerdown', this.gestureAudioRecoveryHandler);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        this.foregroundAudioRecoveryHandler
      );
    }
    this.wakeLock.dispose();
    this.engine?.dispose();
    this.engine = null;
  }

  private async hydratePersistentStores(): Promise<void> {
    const [, , splCheckpoints] = await Promise.all([
      this.sourceStore.loadFromPersistence(),
      this.calibrationMgr.hydrateAndSyncEngine(this.engine),
      loadAllSplShowCheckpointsFromDb(),
    ]);
    if (this.engine && splCheckpoints.length > 0) {
      this.engine.hydrateSplHistory(splCheckpoints);
    }
    this.persistState('replace');
    this.notify();
  }

  public persistState(urlMode: 'push' | 'replace' | 'none' = 'replace'): void {
    const activeSlot = this.engine?.getLiveSlot(
      this.sourceStore.getActiveLiveSourceId()
    );
    const currentSlots = [...(this.engine?.getLiveSlots() ?? [])];

    this.workspace.persist({
      urlMode,
      simulatorPreset: activeSlot?.simulatorPreset ?? 'pa-room-modes',
      selectedSourceId: this.sourceStore.getSelectedSourceId(),
      liveSlots: currentSlots,
      genConfig: this.genConfig,
      hardwareRouting: {
        selectedDeviceId: this.selectedDeviceId,
        selectedDeviceLabel: this.selectedDeviceLabel,
        globalReferenceChannel: this.globalReferenceChannel,
        generatorOutputChannel: this.generatorOutputChannel,
        autoReleaseMinutes: this.autoReleaseMinutes,
      },
      mixerWatch: this.mixerWatch.config,
    });
  }

  public flushPendingPersistence(): void {
    this.sourceStore.flushPendingPersistence();
    this.persistState('none');
  }

  public syncWakeLock(): void {
    void this.wakeLock.setDesired(
      this.workspace.workspaceMode === 'show' && !this.isPaused
    );
  }

  public enforceShowHardwareGeneratorInterlock(): void {
    if (
      this.workspace.workspaceMode === 'show' &&
      this.workspace.audioInputMode === 'hardware' &&
      this.genConfig.enabled
    ) {
      this.updateGenerator({ enabled: false });
    }
  }

  public getEffectiveMixerDeviceIdentity(): MixerDeviceIdentity {
    if (this.workspace.audioInputMode !== 'hardware') {
      return { deviceId: '', deviceLabel: '' };
    }
    if (
      this.mixerWatch.config.deviceMode === 'separate-device' &&
      this.mixerWatch.config.separateDeviceId
    ) {
      return {
        deviceId: this.mixerWatch.config.separateDeviceId,
        deviceLabel: this.mixerWatch.config.separateDeviceLabel,
      };
    }
    return {
      deviceId: this.selectedDeviceId,
      deviceLabel: this.selectedDeviceLabel,
    };
  }

  public syncMixerWatchToEngine(nextConfig = this.mixerWatch.config): void {
    if (!this.engine) {
      this.persistState('none');
      return;
    }
    void this.engine.setMixerWatchConfig(nextConfig).then(() => {
      if (this.engine) {
        this.mixerWatch.syncFromEngine(this.engine.getMixerWatchConfig());
      }
      this.persistState('none');
      this.notify();
    });
  }

  private clearPauseAutoReleaseTimer(): void {
    if (this.pauseAutoReleaseTimer !== null) {
      clearTimeout(this.pauseAutoReleaseTimer);
      this.pauseAutoReleaseTimer = null;
    }
  }

  private schedulePauseAutoReleaseTimer(): void {
    this.clearPauseAutoReleaseTimer();
    if (
      this.workspace.audioInputMode === 'hardware' &&
      this.isPaused &&
      !this.hardwareStreamDeferred &&
      this.autoReleaseMinutes > 0
    ) {
      const delayMs = this.autoReleaseMinutes * 60_000;
      this.pauseAutoReleaseTimer = setTimeout(() => {
        this.pauseAutoReleaseTimer = null;
        this.disconnectHardware('auto-idle');
      }, delayMs);
    }
  }

  private async recoverHardwareAudioIfNeeded(): Promise<void> {
    if (
      this.recoveringHardwareAudio ||
      !this.engine ||
      this.workspace.audioInputMode !== 'hardware' ||
      this.isPaused ||
      this.hardwareStreamDeferred ||
      this.engine.isHardwareStreamHealthy()
    ) {
      return;
    }
    this.recoveringHardwareAudio = true;
    try {
      const ok = await this.engine.recoverHardwareStreamIfInterrupted();
      if (ok) {
        this.audioStatusError = '';
      } else {
        this.clearPauseAutoReleaseTimer();
        this.isPaused = true;
        this.hardwareStreamDeferred = true;
        this.hardwareDisconnectReason = 'launch';
        this.engine.setPaused(true);
        this.syncWakeLock();
      }
      this.notify();
    } finally {
      this.recoveringHardwareAudio = false;
    }
  }

  public readonly selectInputSource = async (
    mode: InputSourceMode,
    deviceId: string
  ): Promise<void> => {
    if (!this.engine) return;
    const modeChanged = this.workspace.audioInputMode !== mode;
    this.workspace.audioInputMode = mode;
    this.audioStatusError = '';
    if (mode === 'hardware') {
      if (
        (modeChanged || this.workspace.workspaceMode === 'show') &&
        this.genConfig.enabled
      ) {
        this.updateGenerator({ enabled: false });
      }
      this.selectedDeviceId = deviceId;
      const dev = this.audioDevices.find((d) => d.deviceId === deviceId);
      this.selectedDeviceLabel = dev ? dev.label : '';
    }
    this.clearPauseAutoReleaseTimer();
    this.hardwareStreamDeferred = false;
    if (this.isPaused) {
      this.isPaused = false;
      this.engine.setPaused(false);
      this.syncWakeLock();
    }
    try {
      await this.engine.setInputMode(mode, this.selectedDeviceId);
      if (mode === 'hardware') {
        this.audioDevices = await this.engine.listInputDevices();
        this.availableChannels = this.engine.getAvailableChannels();
        this.availableOutputChannels = this.engine.getAvailableOutputChannels();
        const activeDev = this.audioDevices.find(
          (d) => d.deviceId === this.selectedDeviceId
        );
        if (activeDev) {
          this.selectedDeviceLabel = activeDev.label;
        }
        if (this.mixerWatch.config.deviceMode === 'follow-main') {
          this.mixerWatch.maybeRecallProfileForDevice(
            this.selectedDeviceId,
            this.selectedDeviceLabel
          );
        }
      }
    } catch (err) {
      this.workspace.audioInputMode = this.engine.getInputMode();
      const reason =
        err instanceof Error && err.message
          ? err.message
          : 'Microphone permission denied or unavailable.';
      this.audioStatusError = `Could not open audio input (${reason})`;
    }
    this.persistState(modeChanged ? 'push' : 'none');
    this.workspace.notify();
    this.notify();
  };

  public readonly disconnectHardware = (
    reason: 'manual' | 'auto-idle' = 'manual'
  ): void => {
    if (this.workspace.audioInputMode !== 'hardware' || !this.engine) return;
    this.clearPauseAutoReleaseTimer();
    this.engine.disconnectHardwareStreams();
    this.isPaused = true;
    this.hardwareStreamDeferred = true;
    this.hardwareDisconnectReason = reason;
    this.audioStatusError = '';
    this.syncWakeLock();
    this.notify();
  };

  public readonly togglePause = async (): Promise<void> => {
    const nextPaused = !this.isPaused;
    this.isPaused = nextPaused;
    this.engine?.setPaused(this.isPaused);
    this.syncWakeLock();

    if (nextPaused) {
      this.schedulePauseAutoReleaseTimer();
      this.notify();
      return;
    }

    this.clearPauseAutoReleaseTimer();
    if (this.workspace.audioInputMode === 'hardware' && this.engine) {
      this.audioStatusError = '';
      if (this.hardwareStreamDeferred || !this.engine.isHardwareStreamHealthy()) {
        try {
          await this.engine.setInputMode('hardware', this.selectedDeviceId);
          this.hardwareStreamDeferred = false;
          this.audioDevices = await this.engine.listInputDevices();
          this.availableChannels = this.engine.getAvailableChannels();
          this.availableOutputChannels = this.engine.getAvailableOutputChannels();
        } catch (err) {
          this.workspace.audioInputMode = this.engine.getInputMode();
          const reason =
            err instanceof Error && err.message
              ? err.message
              : 'Microphone permission denied or unavailable.';
          this.audioStatusError = `Could not open microphone (${reason})`;
          this.persistState('replace');
          this.workspace.notify();
        }
      }
    }
    this.notify();
  };

  public setAutoReleaseMinutes(minutes: number): void {
    this.autoReleaseMinutes = minutes;
    this.schedulePauseAutoReleaseTimer();
    this.persistState('none');
    this.notify();
  }

  public setGlobalReferenceChannel(refCh: number): void {
    this.globalReferenceChannel = refCh;
    this.engine?.setGlobalReferenceChannel(refCh);
    this.persistState('none');
    this.notify();
  }

  public setGeneratorOutputChannel(outCh: number): void {
    this.generatorOutputChannel = outCh;
    this.engine?.setGeneratorOutputChannel(outCh);
    this.persistState('none');
    this.notify();
  }

  public updateGenerator(partial: Partial<SignalGeneratorConfig>): void {
    if (!this.engine) return;
    this.engine.updateGeneratorConfig(partial);
    this.genConfig = { ...this.engine.getGeneratorConfig() };
    this.persistState('none');
    this.notify();
  }

  public dismissAudioError(): void {
    this.audioStatusError = '';
    this.notify();
  }

  public readonly addLiveSlot = (): void => {
    if (!this.engine) return;
    const created = this.engine.addLiveSlot();
    this.sourceStore.setSelectedSourceId(created.id);
    this.persistState('replace');
    this.notify();
  };

  public readonly removeLiveSlot = (slotId: string): void => {
    if (!this.engine || this.engine.getLiveSlots().length <= 1) return;
    this.engine.removeLiveSlot(slotId);
    this.sourceStore.removeLiveSource(slotId);
    this.persistState('replace');
    this.notify();
  };

  public updateLiveSlotMeta(
    slotId: string,
    partial: Partial<
      Pick<
        LiveMeasurementSlotConfig,
        'name' | 'simulatorPreset' | 'measurementChannel' | 'referenceChannel' | 'visible'
      >
    >
  ): void {
    this.engine?.updateLiveSlot(slotId, partial);
    this.persistState(partial.simulatorPreset !== undefined ? 'push' : 'none');
    this.notify();
  }

  public toggleSourceVisibility(id: string, visible: boolean): void {
    if (isLiveSourceId(id)) {
      this.engine?.updateLiveSlot(id, { visible });
      this.persistState('none');
      this.notify();
      return;
    }
    this.sourceStore.toggleVisibility(id, visible);
    this.persistState('none');
  }

  public updateMeasurementConfig(
    partial: Partial<MeasurementPipelineConfig>,
    slotId: string
  ): void {
    this.engine?.updateMeasurementConfig(partial, slotId);
    this.persistState('none');
    this.notify();
  }

  public findAndApplyDelay(slotId?: string): void {
    const targetId = slotId ?? this.sourceStore.getActiveLiveSourceId();
    this.engine?.findAndApplyDelay(targetId);
  }

  public resetAveraging(slotId?: string, includeSplInTuning = false): void {
    const targetId = slotId ?? this.sourceStore.getActiveLiveSourceId();
    this.engine?.resetAveraging(targetId);
    if (includeSplInTuning && this.workspace.workspaceMode !== 'show') {
      this.engine?.resetSplHistory(targetId);
    }
  }

  public resetShowLog(): void {
    this.engine?.resetSplHistory();
    void clearSplShowCheckpointsFromDb();
  }

  public exportSplCsv(): void {
    this.engine?.exportSplCsv();
  }

  public setSplHistoryWindow(windowSec: SplHistoryWindowSec): void {
    this.engine?.setSplHistoryWindow(windowSec);
  }

  public selectCalibration(slotId: string, calId: string | null): void {
    this.calibrationMgr.selectForSlot(slotId, calId, this.engine);
    this.persistState('none');
    this.notify();
  }

  public deleteCalibration(slotId: string, calId: string): void {
    this.calibrationMgr.deleteCalibration(calId, this.engine);
    this.persistState('none');
    this.notify();
  }

  public uploadCalibrationFile(slotId: string, file: File): void {
    void this.calibrationMgr.uploadFileForSlot(slotId, file, this.engine).then(() => {
      this.persistState('none');
      this.notify();
    });
  }
}
