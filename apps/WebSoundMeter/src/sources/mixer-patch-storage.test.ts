// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  MAX_MIXER_WATCH_CHANNELS,
  bindProfileToDevice,
  collectEnabledMixerPhysicalChannels,
  createDefaultMixerPatchData,
  createDefaultMixerWatchSessionConfig,
  deleteMixerPatchProfile,
  findAffinityProfileForDevice,
  loadMixerPatchLibrary,
  normalizeDeviceAffinityLabel,
  sanitizeMixerChannels,
  saveMixerPatchLibrary,
  upsertMixerPatchProfile,
} from './mixer-patch-storage.js';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe('MixerPatchLibrary & Device Affinity Storage', () => {
  it('creates, updates, persists, and recalls profiles by both deviceId and rotated-UUID deviceLabel', () => {
    const storage = createMemoryStorage();
    let lib = loadMixerPatchLibrary(storage);
    expect(lib.profiles).toHaveLength(0);

    const bandAPatch = {
      ...createDefaultMixerPatchData(16),
      tapMode: 'post-fader' as const,
      mixBusChannel: 15,
      channels: sanitizeMixerChannels([
        { channelIndex: 0, name: 'Lead Vox', enabled: true },
        { channelIndex: 1, name: 'BGV L', enabled: true },
        { channelIndex: 5, name: 'Synth DI', enabled: false },
      ]),
    };

    const res1 = upsertMixerPatchProfile(lib, {
      name: 'X32 — Band A',
      patch: bandAPatch,
      deviceId: 'uuid-day-1',
      deviceLabel: 'X-USB (139a:0012)',
    });
    lib = res1.library;

    const res2 = upsertMixerPatchProfile(lib, {
      name: 'X32 — Band B Opener',
      patch: createDefaultMixerPatchData(8),
    });
    lib = res2.library;

    saveMixerPatchLibrary(lib, storage);
    const reloaded = loadMixerPatchLibrary(storage);
    expect(reloaded.profiles).toHaveLength(2);
    expect(reloaded.profiles[0].name).toBe('X32 — Band A');
    expect(reloaded.profiles[0].tapMode).toBe('post-fader');
    expect(reloaded.profiles[0].channels[0].name).toBe('Lead Vox');

    // Exact deviceId match
    expect(findAffinityProfileForDevice(reloaded, 'uuid-day-1', '')?.id).toBe(
      res1.profile.id
    );

    // Rotated browser UUID on Day 2 still matches normalized deviceLabel ("x-usb")!
    expect(normalizeDeviceAffinityLabel('X-USB (139a:0012)')).toBe('x-usb');
    expect(
      findAffinityProfileForDevice(reloaded, 'rotated-uuid-day-2', 'X-USB')?.id
    ).toBe(res1.profile.id);

    // Explicitly switching X-USB to Band B updates device affinity
    const rebound = bindProfileToDevice(
      reloaded,
      res2.profile.id,
      'rotated-uuid-day-2',
      'X-USB'
    );
    expect(findAffinityProfileForDevice(rebound, 'other-uuid', 'X-USB')?.id).toBe(
      res2.profile.id
    );

    // Deleting Band B cleans up dangling affinity keys
    const afterDelete = deleteMixerPatchProfile(rebound, res2.profile.id);
    expect(afterDelete.profiles).toHaveLength(1);
    expect(findAffinityProfileForDevice(afterDelete, 'rotated-uuid-day-2', 'X-USB')).toBeNull();
  });

  it('caps enabled watched channels at 32 and includes Mix Bus channel when collecting active taps', () => {
    const fortyEnabled = Array.from({ length: 40 }, (_, i) => ({
      channelIndex: i,
      name: `Mic ${i + 1}`,
      enabled: true,
    }));
    const sanitized = sanitizeMixerChannels(fortyEnabled, 40);
    expect(sanitized.filter((c) => c.enabled)).toHaveLength(MAX_MIXER_WATCH_CHANNELS);

    const cfg = {
      ...createDefaultMixerWatchSessionConfig(),
      enabled: true,
      patch: {
        tapMode: 'pre-fader' as const,
        mixBusChannel: 31,
        channels: sanitizeMixerChannels(
          [
            { channelIndex: 12, name: 'Vox 1', enabled: true },
            { channelIndex: 13, name: 'Vox 2', enabled: true },
          ],
          32
        ),
      },
    };
    expect(collectEnabledMixerPhysicalChannels(cfg, 1)).toEqual([12, 13, 31]);
  });
});
