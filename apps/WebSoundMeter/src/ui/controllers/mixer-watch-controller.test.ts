// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { MixerWatchController } from './mixer-watch-controller.js';

describe('MixerWatchController', () => {
  it('saves, selects, updates, and recalls named presets by hardware device affinity', () => {
    const appliedSpy = vi.fn();
    const ctrl = new MixerWatchController(appliedSpy);
    ctrl.hydrate();

    ctrl.openModal();
    expect(ctrl.modalOpen).toBe(true);

    ctrl.updatePatch({
      channels: [
        { channelIndex: 0, name: 'Headliner Lead', enabled: true },
        { channelIndex: 1, name: 'Backing Vox', enabled: true },
      ],
    });
    ctrl.saveNewPreset('Headliner Patch', {
      deviceId: 'x32-usb',
      deviceLabel: 'X-USB (32ch)',
    });

    expect(ctrl.library.profiles.some((p) => p.name === 'Headliner Patch')).toBe(true);
    expect(ctrl.draftPresetName).toBe('');
    expect(appliedSpy).toHaveBeenCalled();

    // Switching to another device and back recalls 'Headliner Patch' via device affinity
    ctrl.selectPreset(null, { deviceId: '', deviceLabel: '' });
    expect(ctrl.config.activeProfileId).toBeNull();

    ctrl.maybeRecallProfileForDevice('rotated-uuid', 'X-USB (32ch)');
    expect(ctrl.config.patch.channels[0]?.name).toBe('Headliner Lead');

    ctrl.closeModal();
    expect(ctrl.modalOpen).toBe(false);
  });
});
