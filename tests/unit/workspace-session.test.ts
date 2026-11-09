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

import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SESSION_STORAGE_KEY,
  createDefaultWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
} from '../../src/sources/workspace-session.js';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe('workspace-session', () => {
  it('returns default session when storage is empty or unavailable', () => {
    const defaults = createDefaultWorkspaceSession();
    expect(loadWorkspaceSession(null)).toEqual(defaults);
    expect(loadWorkspaceSession(createMemoryStorage())).toEqual(defaults);
  });

  it('saves and loads workspace session including DSP settings, calibration ID, and hardware routing', () => {
    const mem = createMemoryStorage();
    const custom = {
      ...createDefaultWorkspaceSession(),
      layoutPreset: 'tf-dual' as const,
      chartPlotTypes: ['magnitude', 'phase'] as ('magnitude' | 'phase')[],
      audioInputMode: 'hardware' as const,
      liveSourceVisible: false,
      activeCalibrationId: 'cal-umik1',
      measConfig: {
        fftSize: 16384,
        octaveSmoothing: '1/12' as const,
        delayMs: 8.5,
      },
      hardwareRouting: {
        selectedDeviceId: 'usb-scarlett',
        selectedDeviceLabel: 'Scarlett 2i2 USB',
        measurementChannel: 0,
        referenceChannel: 1,
        generatorOutputChannel: 2,
      },
    };

    saveWorkspaceSession(custom, mem);
    const loaded = loadWorkspaceSession(mem);
    expect(loaded.layoutPreset).toBe('tf-dual');
    expect(loaded.audioInputMode).toBe('hardware');
    expect(loaded.liveSourceVisible).toBe(false);
    expect(loaded.activeCalibrationId).toBe('cal-umik1');
    expect(loaded.measConfig.fftSize).toBe(16384);
    expect(loaded.hardwareRouting.selectedDeviceLabel).toBe('Scarlett 2i2 USB');
    expect(loaded.hardwareRouting.generatorOutputChannel).toBe(2);
  });

  it('gracefully falls back to defaults on corrupted JSON or unsupported schema version', () => {
    const mem = createMemoryStorage();
    mem.setItem(WORKSPACE_SESSION_STORAGE_KEY, '{not-valid-json');
    expect(loadWorkspaceSession(mem)).toEqual(createDefaultWorkspaceSession());

    mem.setItem(WORKSPACE_SESSION_STORAGE_KEY, JSON.stringify({ version: 999 }));
    expect(loadWorkspaceSession(mem)).toEqual(createDefaultWorkspaceSession());
  });
});
