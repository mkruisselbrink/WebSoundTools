// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Mixer Input Watch Configuration & Named Patch Profile Persistence (`src/sources/mixer-patch-storage.ts`).
 *
 * Supports both:
 *  1. Manual named patch presets (e.g. "X32 — Band A", "SQ-5 — Sunday Lavs") selectable anytime.
 *  2. Automatic hardware device affinity (matching both `deviceId` and normalized `deviceLabel`
 *     so browser UUID rotation never loses a console's channel names).
 */

import { type StorageLike, readStorageJson, writeStorageJson } from '@foh/state';

export const MIXER_PATCH_STORAGE_KEY = 'web-sound-meter:mixer-patches:v1';
export const MAX_MIXER_WATCH_CHANNELS = 32;
export const MAX_MIXER_HARDWARE_CHANNELS = 64;

export type MixerTapMode = 'pre-fader' | 'post-fader';
export type MixerDeviceMode = 'follow-main' | 'separate-device';
export type MixerWatchSensitivityMode = 'foh-normal' | 'monitor-sensitive';

export interface MixerWatchChannelConfig {
  readonly channelIndex: number;
  readonly name: string;
  readonly enabled: boolean;
}

export interface MixerPatchData {
  readonly tapMode: MixerTapMode;
  /** -2 = Follow Global Ref (when sharing main device), -1 = None, 0..63 = Physical Ch on mixer device */
  readonly mixBusChannel: number;
  readonly channels: readonly MixerWatchChannelConfig[];
}

export interface MixerPatchProfile extends MixerPatchData {
  readonly id: string;
  readonly name: string;
  readonly lastDeviceId?: string;
  readonly lastDeviceLabel?: string;
  readonly updatedAt: string;
}

export interface MixerWatchSessionConfig {
  readonly enabled: boolean;
  readonly deviceMode: MixerDeviceMode;
  readonly separateDeviceId: string;
  readonly separateDeviceLabel: string;
  readonly activeProfileId: string | null;
  readonly sensitivity: MixerWatchSensitivityMode;
  readonly patch: MixerPatchData;
}

export interface MixerPatchLibraryState {
  readonly version: 1;
  readonly profiles: readonly MixerPatchProfile[];
  /** Maps `'id:<deviceId>'` and `'label:<normalizedLabel>'` to `MixerPatchProfile.id` */
  readonly deviceAffinity: Readonly<Record<string, string>>;
}

const DEFAULT_STAGE_LABELS: Readonly<Record<number, string>> = {
  0: 'Lead Vox',
  1: 'Stage Vox 2',
  2: 'Acoustic Gtr',
  3: 'Spare Mic',
};

export function createDefaultMixerWatchChannels(
  count: number = 16
): MixerWatchChannelConfig[] {
  const total = Math.max(4, Math.min(MAX_MIXER_HARDWARE_CHANNELS, count));
  return Array.from({ length: total }, (_, idx) => ({
    channelIndex: idx,
    name: DEFAULT_STAGE_LABELS[idx] ?? `Ch ${idx + 1}`,
    enabled: idx < 4,
  }));
}

export function createDefaultMixerPatchData(channelCount: number = 16): MixerPatchData {
  return {
    tapMode: 'pre-fader',
    mixBusChannel: -2,
    channels: createDefaultMixerWatchChannels(channelCount),
  };
}

export function createDefaultMixerWatchSessionConfig(): MixerWatchSessionConfig {
  return {
    enabled: false,
    deviceMode: 'follow-main',
    separateDeviceId: '',
    separateDeviceLabel: '',
    activeProfileId: null,
    sensitivity: 'foh-normal',
    patch: createDefaultMixerPatchData(16),
  };
}

export function sanitizeMixerChannels(
  rawChannels: readonly Partial<MixerWatchChannelConfig>[] | undefined,
  minCount: number = 16
): MixerWatchChannelConfig[] {
  const byIdx = new Map<number, MixerWatchChannelConfig>();
  let maxIdx = minCount - 1;

  if (Array.isArray(rawChannels)) {
    for (const item of rawChannels) {
      if (
        typeof item?.channelIndex !== 'number' ||
        !Number.isInteger(item.channelIndex) ||
        item.channelIndex < 0 ||
        item.channelIndex >= MAX_MIXER_HARDWARE_CHANNELS
      ) {
        continue;
      }
      if (item.channelIndex > maxIdx) {
        maxIdx = item.channelIndex;
      }
      const cleanName =
        typeof item.name === 'string' && item.name.trim().length > 0
          ? item.name.trim().slice(0, 32)
          : DEFAULT_STAGE_LABELS[item.channelIndex] ?? `Ch ${item.channelIndex + 1}`;
      byIdx.set(item.channelIndex, {
        channelIndex: item.channelIndex,
        name: cleanName,
        enabled: Boolean(item.enabled),
      });
    }
  }

  let enabledSoFar = 0;
  const result: MixerWatchChannelConfig[] = [];
  for (let ch = 0; ch <= maxIdx; ch++) {
    const existing = byIdx.get(ch);
    let enabled = existing ? existing.enabled : false;
    if (enabled) {
      if (enabledSoFar >= MAX_MIXER_WATCH_CHANNELS) {
        enabled = false;
      } else {
        enabledSoFar++;
      }
    }
    result.push({
      channelIndex: ch,
      name: existing?.name ?? DEFAULT_STAGE_LABELS[ch] ?? `Ch ${ch + 1}`,
      enabled,
    });
  }
  return result;
}

export function hydrateMixerPatchData(
  raw: Partial<MixerPatchData> | undefined,
  minChannels: number = 16
): MixerPatchData {
  if (!raw) {
    return createDefaultMixerPatchData(minChannels);
  }
  const tapMode: MixerTapMode = raw.tapMode === 'post-fader' ? 'post-fader' : 'pre-fader';
  const mixBusChannel =
    typeof raw.mixBusChannel === 'number' &&
    raw.mixBusChannel >= -2 &&
    raw.mixBusChannel < MAX_MIXER_HARDWARE_CHANNELS
      ? Math.trunc(raw.mixBusChannel)
      : -2;
  const channels = Array.isArray(raw.channels)
    ? sanitizeMixerChannels(raw.channels, minChannels)
    : createDefaultMixerWatchChannels(minChannels);
  return { tapMode, mixBusChannel, channels };
}

export function hydrateMixerWatchSessionConfig(
  raw: Partial<MixerWatchSessionConfig> | undefined
): MixerWatchSessionConfig {
  const defaults = createDefaultMixerWatchSessionConfig();
  if (!raw) {
    return defaults;
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    deviceMode:
      raw.deviceMode === 'separate-device' ? 'separate-device' : 'follow-main',
    separateDeviceId:
      typeof raw.separateDeviceId === 'string' ? raw.separateDeviceId : '',
    separateDeviceLabel:
      typeof raw.separateDeviceLabel === 'string' ? raw.separateDeviceLabel : '',
    activeProfileId:
      typeof raw.activeProfileId === 'string' && raw.activeProfileId.length > 0
        ? raw.activeProfileId
        : null,
    sensitivity:
      raw.sensitivity === 'monitor-sensitive' ? 'monitor-sensitive' : 'foh-normal',
    patch: hydrateMixerPatchData(raw.patch, 16),
  };
}

export function normalizeDeviceAffinityLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .replace(/\s+/g, ' ');
}

export function loadMixerPatchLibrary(
  storage?: Pick<StorageLike, 'getItem'> | null
): MixerPatchLibraryState {
  const parsed = readStorageJson<Partial<MixerPatchLibraryState>>(
    MIXER_PATCH_STORAGE_KEY,
    storage
  );
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
    return { version: 1, profiles: [], deviceAffinity: {} };
  }
  const profiles: MixerPatchProfile[] = parsed.profiles
    .filter((p): p is MixerPatchProfile => Boolean(p && typeof p.id === 'string' && p.name))
    .map((p) => ({
      ...hydrateMixerPatchData(p, Math.max(16, p.channels?.length ?? 16)),
      id: p.id,
      name: String(p.name).trim().slice(0, 48) || 'Saved Patch',
      ...(p.lastDeviceId ? { lastDeviceId: String(p.lastDeviceId) } : {}),
      ...(p.lastDeviceLabel ? { lastDeviceLabel: String(p.lastDeviceLabel) } : {}),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : '',
    }));

  const validIds = new Set(profiles.map((p) => p.id));
  const deviceAffinity: Record<string, string> = {};
  if (parsed.deviceAffinity && typeof parsed.deviceAffinity === 'object') {
    for (const [k, v] of Object.entries(parsed.deviceAffinity)) {
      if (typeof v === 'string' && validIds.has(v)) {
        deviceAffinity[k] = v;
      }
    }
  }
  return { version: 1, profiles, deviceAffinity };
}

export function saveMixerPatchLibrary(
  library: MixerPatchLibraryState,
  storage?: Pick<StorageLike, 'setItem'> | null
): void {
  writeStorageJson(MIXER_PATCH_STORAGE_KEY, library, storage);
}

export function findAffinityProfileForDevice(
  library: MixerPatchLibraryState,
  deviceId: string,
  deviceLabel: string
): MixerPatchProfile | null {
  if (deviceId) {
    const byId = library.deviceAffinity[`id:${deviceId}`];
    if (byId) {
      const found = library.profiles.find((p) => p.id === byId);
      if (found) return found;
    }
  }
  const normLabel = normalizeDeviceAffinityLabel(deviceLabel);
  if (normLabel) {
    const byLabel = library.deviceAffinity[`label:${normLabel}`];
    if (byLabel) {
      const found = library.profiles.find((p) => p.id === byLabel);
      if (found) return found;
    }
  }
  return null;
}

export function bindProfileToDevice(
  library: MixerPatchLibraryState,
  profileId: string,
  deviceId: string,
  deviceLabel: string
): MixerPatchLibraryState {
  if (!library.profiles.some((p) => p.id === profileId)) {
    return library;
  }
  const nextAffinity: Record<string, string> = { ...library.deviceAffinity };
  if (deviceId) {
    nextAffinity[`id:${deviceId}`] = profileId;
  }
  const normLabel = normalizeDeviceAffinityLabel(deviceLabel);
  if (normLabel) {
    nextAffinity[`label:${normLabel}`] = profileId;
  }
  const profiles = library.profiles.map((p) =>
    p.id === profileId
      ? {
          ...p,
          ...(deviceId ? { lastDeviceId: deviceId } : {}),
          ...(deviceLabel ? { lastDeviceLabel: deviceLabel } : {}),
        }
      : p
  );
  return { version: 1, profiles, deviceAffinity: nextAffinity };
}

export function upsertMixerPatchProfile(
  library: MixerPatchLibraryState,
  params: {
    readonly id?: string;
    readonly name: string;
    readonly patch: MixerPatchData;
    readonly deviceId?: string;
    readonly deviceLabel?: string;
  }
): { readonly library: MixerPatchLibraryState; readonly profile: MixerPatchProfile } {
  const id =
    params.id ??
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `patch-${crypto.randomUUID().slice(0, 8)}`
      : `patch-${Date.now().toString(36)}`);
  const cleanName = params.name.trim().slice(0, 48) || 'Mixer Patch';
  const cleanPatch = hydrateMixerPatchData(
    params.patch,
    Math.max(16, params.patch.channels.length)
  );
  const profile: MixerPatchProfile = {
    id,
    name: cleanName,
    ...cleanPatch,
    ...(params.deviceId ? { lastDeviceId: params.deviceId } : {}),
    ...(params.deviceLabel ? { lastDeviceLabel: params.deviceLabel } : {}),
    updatedAt: new Date().toISOString(),
  };

  const exists = library.profiles.some((p) => p.id === id);
  const nextProfiles = exists
    ? library.profiles.map((p) => (p.id === id ? profile : p))
    : [...library.profiles, profile];

  let nextLib: MixerPatchLibraryState = {
    version: 1,
    profiles: nextProfiles,
    deviceAffinity: library.deviceAffinity,
  };
  if (params.deviceId || params.deviceLabel) {
    nextLib = bindProfileToDevice(
      nextLib,
      id,
      params.deviceId ?? '',
      params.deviceLabel ?? ''
    );
  }
  return { library: nextLib, profile };
}

export function deleteMixerPatchProfile(
  library: MixerPatchLibraryState,
  profileId: string
): MixerPatchLibraryState {
  const profiles = library.profiles.filter((p) => p.id !== profileId);
  const deviceAffinity: Record<string, string> = {};
  for (const [k, v] of Object.entries(library.deviceAffinity)) {
    if (v !== profileId) {
      deviceAffinity[k] = v;
    }
  }
  return { version: 1, profiles, deviceAffinity };
}

export function collectEnabledMixerPhysicalChannels(
  config: MixerWatchSessionConfig,
  globalRefChannel: number
): number[] {
  if (!config.enabled) return [];
  const chs: number[] = [];
  for (const ch of config.patch.channels) {
    if (ch.enabled && ch.channelIndex >= 0 && !chs.includes(ch.channelIndex)) {
      chs.push(ch.channelIndex);
      if (chs.length >= MAX_MIXER_WATCH_CHANNELS) break;
    }
  }
  const busCh =
    config.patch.mixBusChannel === -2
      ? config.deviceMode === 'follow-main'
        ? globalRefChannel
        : -1
      : config.patch.mixBusChannel;
  if (busCh >= 0 && !chs.includes(busCh)) {
    chs.push(busCh);
  }
  return chs;
}
