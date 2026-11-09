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

import { describe, expect, it, vi } from 'vitest';
import { EqualizerSourceConfig } from '../../src/sources/eq-source.js';
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../../src/sources/source-data.js';
import {
  SourcePersistenceAdapter,
  SourceStore,
} from '../../src/sources/source-store.js';
import { UnionSourceConfig } from '../../src/sources/union-source.js';

function createMockLiveFrame(sampleRate = 48000): SourceData {
  const freqData = createEmptyFrequencyDomainData(65, sampleRate);
  freqData.magnitude.fill(1.0);
  const timeData = createEmptyTimeDomainData(128, sampleRate);
  timeData.impulse[64] = 1.0;
  return {
    id: 'live-measurement',
    name: 'Live Measurement',
    kind: 'measurement',
    color: '#38bdf8',
    visible: true,
    active: true,
    sampleRate,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: false,
    createdAt: new Date().toISOString(),
    notes: '',
    freqData,
    timeData,
  };
}

function createMemoryPersistence(): {
  adapter: SourcePersistenceAdapter;
  saved: Map<string, SourceData>;
  savedEq: Map<string, EqualizerSourceConfig>;
  savedUnion: Map<string, UnionSourceConfig>;
} {
  const saved = new Map<string, SourceData>();
  const savedEq = new Map<string, EqualizerSourceConfig>();
  const savedUnion = new Map<string, UnionSourceConfig>();
  return {
    saved,
    savedEq,
    savedUnion,
    adapter: {
      loadAll: async () => Array.from(saved.values()),
      save: (src) => {
        saved.set(src.id, src);
      },
      remove: (id) => {
        saved.delete(id);
      },
      loadAllEq: async () => Array.from(savedEq.values()),
      saveEq: (eq) => {
        savedEq.set(eq.id, eq);
      },
      removeEq: (id) => {
        savedEq.delete(id);
      },
      loadAllUnion: async () => Array.from(savedUnion.values()),
      saveUnion: (u) => {
        savedUnion.set(u.id, u);
      },
      removeUnion: (id) => {
        savedUnion.delete(id);
      },
    },
  };
}

describe('SourceStore', () => {
  it('preserves live measurement visibility across incoming DSP frames', () => {
    const { adapter } = createMemoryPersistence();
    const store = new SourceStore(adapter);

    store.setLiveFrame(createMockLiveFrame());
    expect(store.getLiveSource()?.visible).toBe(true);

    // Hide live measurement
    store.toggleVisibility('live-measurement', false);
    expect(store.getLiveSource()?.visible).toBe(false);

    // Subsequent incoming frames must remain hidden
    store.setLiveFrame(createMockLiveFrame());
    expect(store.getLiveSource()?.visible).toBe(false);
  });

  it('captures, updates, and deletes stored traces while syncing persistence', () => {
    const { adapter, saved } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setLiveFrame(createMockLiveFrame());
    const captured = store.captureCurrentTrace();
    expect(captured).not.toBeNull();
    expect(store.getStoredSources().length).toBe(1);
    expect(saved.has(captured!.id)).toBe(true);

    store.updateStoredSource(captured!.id, { name: 'Main PA Left', gainOffsetDb: -2.5 });
    expect(store.getStoredSources()[0].name).toBe('Main PA Left');
    expect(saved.get(captured!.id)?.name).toBe('Main PA Left');
    expect(saved.get(captured!.id)?.gainOffsetDb).toBe(-2.5);

    store.deleteStoredSource(captured!.id);
    expect(store.getStoredSources().length).toBe(0);
    expect(saved.has(captured!.id)).toBe(false);
    expect(store.getSelectedSourceId()).toBe('live-measurement');
    expect(listener).toHaveBeenCalled();
  });

  it('memoizes Virtual EQ and Union source evaluations and persists them across reloads', async () => {
    const { adapter, savedEq, savedUnion } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    store.setLiveFrame(createMockLiveFrame());

    const eq = store.addVirtualEqSource();
    const union = store.addUnionSource();
    expect(savedEq.has(eq.id)).toBe(true);
    expect(savedUnion.has(union.id)).toBe(true);

    const firstEval = store.getAllSources();
    const secondEval = store.getAllSources();
    expect(firstEval).toBe(secondEval);

    const eqData1 = firstEval.find((s) => s.id === eq.id);
    const unionData1 = firstEval.find((s) => s.id === union.id);
    expect(eqData1).toBeDefined();
    expect(unionData1).toBeDefined();

    // Dragging an EQ band invalidates EQ evaluation and updates persisted EQ
    store.setSelectedSourceId(eq.id);
    store.dragActiveEqBand(1, 250, -4.5);
    const thirdEval = store.getAllSources();
    const eqData2 = thirdEval.find((s) => s.id === eq.id);
    expect(eqData2).not.toBe(eqData1);
    expect(store.getEqSources()[0].bands[1].frequency).toBe(250);
    expect(savedEq.get(eq.id)?.bands[1].gainDb).toBe(-4.5);

    // Hydrate a second store from the same persistence adapter
    const reloadedStore = new SourceStore(adapter);
    reloadedStore.setSelectedSourceId('non-existent-id');
    await reloadedStore.loadFromPersistence();
    expect(reloadedStore.getEqSources()).toHaveLength(1);
    expect(reloadedStore.getUnionSources()).toHaveLength(1);
    // Orphaned selectedSourceId is reset to live-measurement
    expect(reloadedStore.getSelectedSourceId()).toBe('live-measurement');
  });
});
