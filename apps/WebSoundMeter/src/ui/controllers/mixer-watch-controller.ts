// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type MixerDeviceMode,
  type MixerPatchLibraryState,
  type MixerTapMode,
  type MixerWatchChannelConfig,
  type MixerWatchSessionConfig,
  bindProfileToDevice,
  createDefaultMixerWatchSessionConfig,
  deleteMixerPatchProfile,
  findAffinityProfileForDevice,
  hydrateMixerPatchData,
  loadMixerPatchLibrary,
  saveMixerPatchLibrary,
  upsertMixerPatchProfile,
} from '../../sources/mixer-patch-storage.js';

export interface MixerDeviceIdentity {
  readonly deviceId: string;
  readonly deviceLabel: string;
}

/**
 * Stateful controller for `Mixer Input Watch` configuration, named patch preset library
 * CRUD, and hardware `deviceId` / `deviceLabel` affinity auto-recall.
 */
export class MixerWatchController {
  public config: MixerWatchSessionConfig = createDefaultMixerWatchSessionConfig();
  public library: MixerPatchLibraryState = {
    version: 1,
    profiles: [],
    deviceAffinity: {},
  };
  public draftPresetName = '';
  public modalOpen = false;
  public revision = 0;

  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly onConfigChange: (nextConfig: MixerWatchSessionConfig) => void
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

  public hydrate(initialConfig?: MixerWatchSessionConfig): void {
    this.library = loadMixerPatchLibrary();
    this.config = initialConfig ?? createDefaultMixerWatchSessionConfig();
    this.notify();
  }

  public get enabledChannelCount(): number {
    return this.config.patch.channels.filter((c) => c.enabled).length;
  }

  public openModal(): void {
    if (this.modalOpen) return;
    this.modalOpen = true;
    this.notify();
  }

  public closeModal(): void {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.notify();
  }

  public setDraftPresetName(name: string): void {
    this.draftPresetName = name;
    this.notify();
  }

  public syncFromEngine(engineConfig: MixerWatchSessionConfig): void {
    this.config = engineConfig;
    this.notify();
  }

  private applyUpdate(nextConfig: MixerWatchSessionConfig): void {
    this.config = nextConfig;
    this.notify();
    this.onConfigChange(nextConfig);
  }

  public updateConfig(partial: Partial<MixerWatchSessionConfig>): void {
    this.applyUpdate({
      ...this.config,
      ...partial,
    });
  }

  public updatePatch(partial: {
    readonly tapMode?: MixerTapMode;
    readonly mixBusChannel?: number;
    readonly channels?: readonly MixerWatchChannelConfig[];
  }): void {
    this.applyUpdate({
      ...this.config,
      patch: {
        ...this.config.patch,
        ...partial,
      },
    });
  }

  public saveNewPreset(name: string, dev: MixerDeviceIdentity): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { library, profile } = upsertMixerPatchProfile(this.library, {
      name: trimmed,
      patch: this.config.patch,
      deviceId: dev.deviceId,
      deviceLabel: dev.deviceLabel,
    });
    this.library = library;
    saveMixerPatchLibrary(library);
    this.draftPresetName = '';
    this.applyUpdate({
      ...this.config,
      activeProfileId: profile.id,
    });
  }

  public updateActivePreset(dev: MixerDeviceIdentity): void {
    const activeId = this.config.activeProfileId;
    if (!activeId) return;
    const existing = this.library.profiles.find((p) => p.id === activeId);
    if (!existing) return;
    const { library } = upsertMixerPatchProfile(this.library, {
      id: existing.id,
      name: existing.name,
      patch: this.config.patch,
      deviceId: dev.deviceId || existing.lastDeviceId,
      deviceLabel: dev.deviceLabel || existing.lastDeviceLabel,
    });
    this.library = library;
    saveMixerPatchLibrary(library);
    this.notify();
  }

  public deleteActivePreset(): void {
    const activeId = this.config.activeProfileId;
    if (!activeId) return;
    const nextLib = deleteMixerPatchProfile(this.library, activeId);
    this.library = nextLib;
    saveMixerPatchLibrary(nextLib);
    this.applyUpdate({
      ...this.config,
      activeProfileId: null,
    });
  }

  public selectPreset(profileId: string | null, dev: MixerDeviceIdentity): void {
    if (!profileId) {
      this.applyUpdate({
        ...this.config,
        activeProfileId: null,
      });
      return;
    }
    const prof = this.library.profiles.find((p) => p.id === profileId);
    if (!prof) return;
    if (dev.deviceId || dev.deviceLabel) {
      this.library = bindProfileToDevice(
        this.library,
        prof.id,
        dev.deviceId,
        dev.deviceLabel
      );
      saveMixerPatchLibrary(this.library);
    }
    this.applyUpdate({
      ...this.config,
      activeProfileId: prof.id,
      patch: hydrateMixerPatchData(prof, Math.max(16, prof.channels.length)),
    });
  }

  public selectMixerDevice(
    mode: MixerDeviceMode,
    deviceId: string,
    deviceLabel: string
  ): void {
    const matched = findAffinityProfileForDevice(this.library, deviceId, deviceLabel);
    const nextPatch = matched
      ? hydrateMixerPatchData(matched, Math.max(16, matched.channels.length))
      : mode === 'separate-device' && this.config.patch.mixBusChannel === -2
        ? { ...this.config.patch, mixBusChannel: -1 }
        : this.config.patch;
    this.applyUpdate({
      ...this.config,
      deviceMode: mode,
      separateDeviceId: mode === 'separate-device' ? deviceId : '',
      separateDeviceLabel: mode === 'separate-device' ? deviceLabel : '',
      activeProfileId: matched ? matched.id : this.config.activeProfileId,
      patch: nextPatch,
    });
  }

  public maybeRecallProfileForDevice(deviceId: string, deviceLabel: string): void {
    const matched = findAffinityProfileForDevice(this.library, deviceId, deviceLabel);
    if (!matched) return;
    this.applyUpdate({
      ...this.config,
      activeProfileId: matched.id,
      patch: hydrateMixerPatchData(matched, Math.max(16, matched.channels.length)),
    });
  }
}
