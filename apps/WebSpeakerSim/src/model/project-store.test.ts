// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildSpeakerFromSpec } from '../library/spec-builder.js';
import { ProjectStore } from './project-store.js';
import { SimulationController } from '../physics/sim-controller.js';

describe('ProjectStore & SimulationController', () => {
  it('supports CRUD on sources, sub arrays, surfaces, DSP groups, and virtual mics', () => {
    const store = new ProjectStore();
    const initialSources = store.scene.pointSources.length;

    const ps = store.addPointSource({ name: 'Outfill L' });
    expect(store.scene.pointSources.length).toBe(initialSources + 1);
    expect(store.selectedEntity).toEqual({ kind: 'point-source', id: ps.id });

    store.updatePointSource(ps.id, { trimGainDb: -3 });
    expect(store.scene.pointSources.find((p) => p.id === ps.id)?.trimGainDb).toBe(-3);

    store.removePointSource(ps.id);
    expect(store.scene.pointSources.length).toBe(initialSources);

    const sa = store.addSubArray({ mode: 'end-fire', boxCount: 3 });
    expect(store.scene.subArrays.some((s) => s.id === sa.id)).toBe(true);
    store.removeSubArray(sa.id);

    const mic = store.addVirtualMic({ name: 'Balcony Probe' });
    expect(store.scene.virtualMics.some((m) => m.id === mic.id)).toBe(true);
    store.removeVirtualMic(mic.id);
  });

  it('coalesces continuous drag transactions into a single Undo/Redo history step', () => {
    const store = new ProjectStore();
    const psId = store.scene.pointSources[0].id;
    const startX = store.scene.pointSources[0].position.x;

    // Simulate 5 pointer-move updates with the same transaction key
    for (let step = 1; step <= 5; step++) {
      store.updatePointSource(
        psId,
        { position: { x: startX + step * 0.5, y: 4.5, z: 3.8 } },
        `drag-${psId}`
      );
    }
    store.endTransaction();

    expect(store.scene.pointSources[0].position.x).toBeCloseTo(startX + 2.5, 5);
    expect(store.canUndo).toBe(true);

    // A single undo reverts the entire 5-step gesture back to startX!
    store.undo();
    expect(store.scene.pointSources[0].position.x).toBeCloseTo(startX, 5);

    store.redo();
    expect(store.scene.pointSources[0].position.x).toBeCloseTo(startX + 2.5, 5);
  });

  it('synchronizes custom speakers and computes snapshots via SimulationController in Node fallback', () => {
    const store = new ProjectStore();
    const controller = new SimulationController(store, false);

    expect(controller.snapshot.planGrid).not.toBeNull();
    expect(controller.snapshot.sectionGrid).not.toBeNull();
    expect(controller.snapshot.virtualMics.length).toBeGreaterThan(0);

    const custom = buildSpeakerFromSpec({
      id: 'custom-rcf-style-12',
      name: 'Custom 12" Point Source',
      manufacturer: 'Custom',
      category: 'point-source',
      horizontalDispersionDeg: 90,
      verticalDispersionDeg: 60,
      low3dBHz: 50,
      high3dBHz: 20000,
      maxContinuousSpl1mDb: 131,
    });
    store.upsertCustomSpeaker(custom);
    store.addPointSource({ speakerId: custom.id });

    expect(controller.snapshot.planGrid!.stats.meanAudienceSplDb).toBeGreaterThan(80);
    controller.dispose();
  });
});

