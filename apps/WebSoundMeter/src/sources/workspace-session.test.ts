// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createDefaultLiveSlot } from '../audio/audio-engine.js';
import { DEFAULT_MEASUREMENT_CONFIG } from '../dsp/analyzer-pipeline.js';
import {
  WORKSPACE_SESSION_STORAGE_KEY,
  createDefaultWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
} from './workspace-session.js';

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

  it('saves and loads workspace session including multiple live measurement slots, per-slot DSP settings, calibration IDs, and hardware routing', () => {
    const mem = createMemoryStorage();
    const slot1 = {
      ...createDefaultLiveSlot('live-measurement', 0),
      visible: false,
      activeCalibrationId: 'cal-umik1',
      measurementChannel: 13,
      referenceChannel: 15,
      config: {
        ...DEFAULT_MEASUREMENT_CONFIG,
        fftSize: 16384,
        octaveSmoothing: '1/12' as const,
        delayMs: 8.5,
      },
    };
    const slot2 = {
      ...createDefaultLiveSlot('live-sub', 1),
      name: 'Sub Nearfield (Ch 28)',
      simulatorPreset: 'sub-top-misaligned' as const,
      measurementChannel: 27,
      referenceChannel: -1,
    };

    const custom = {
      ...createDefaultWorkspaceSession(),
      layoutPreset: 'tf-dual' as const,
      chartPlotTypes: ['magnitude', 'phase'] as ('magnitude' | 'phase')[],
      audioInputMode: 'hardware' as const,
      liveSlots: [slot1, slot2],
      hardwareRouting: {
        selectedDeviceId: 'dante-32',
        selectedDeviceLabel: 'Dante Virtual Soundcard (32ch)',
        globalReferenceChannel: 7,
        generatorOutputChannel: 2,
      },
    };

    saveWorkspaceSession(custom, mem);
    const loaded = loadWorkspaceSession(mem);
    expect(loaded.layoutPreset).toBe('tf-dual');
    expect(loaded.audioInputMode).toBe('hardware');
    expect(loaded.liveSlots).toHaveLength(2);
    expect(loaded.liveSlots[0].visible).toBe(false);
    expect(loaded.liveSlots[0].activeCalibrationId).toBe('cal-umik1');
    expect(loaded.liveSlots[0].config.fftSize).toBe(16384);
    expect(loaded.liveSlots[0].measurementChannel).toBe(13);
    expect(loaded.liveSlots[1].name).toBe('Sub Nearfield (Ch 28)');
    expect(loaded.liveSlots[1].measurementChannel).toBe(27);
    expect(loaded.liveSlots[1].simulatorPreset).toBe('sub-top-misaligned');
    expect(loaded.hardwareRouting.selectedDeviceLabel).toBe(
      'Dante Virtual Soundcard (32ch)'
    );
    expect(loaded.hardwareRouting.globalReferenceChannel).toBe(7);
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
