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
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../../src/sources/source-data.js';
import {
  SourcePersistenceAdapter,
  SourceStore,
} from '../../src/sources/source-store.js';

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
} {
  const saved = new Map<string, SourceData>();
  return {
    saved,
    adapter: {
      loadAll: async () => Array.from(saved.values()),
      save: (src) => {
        saved.set(src.id, src);
      },
      remove: (id) => {
        saved.delete(id);
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

  it('memoizes Virtual EQ and Union source evaluations unless inputs change', () => {
    const { adapter } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    store.setLiveFrame(createMockLiveFrame());

    const eq = store.addVirtualEqSource();
    const union = store.addUnionSource();

    const firstEval = store.getAllSources();
    const secondEval = store.getAllSources();
    expect(firstEval).toBe(secondEval);

    const eqData1 = firstEval.find((s) => s.id === eq.id);
    const unionData1 = firstEval.find((s) => s.id === union.id);
    expect(eqData1).toBeDefined();
    expect(unionData1).toBeDefined();

    // Dragging an EQ band invalidates EQ evaluation
    store.setSelectedSourceId(eq.id);
    store.dragActiveEqBand(1, 250, -4.5);
    const thirdEval = store.getAllSources();
    const eqData2 = thirdEval.find((s) => s.id === eq.id);
    expect(eqData2).not.toBe(eqData1);
    expect(store.getEqSources()[0].bands[1].frequency).toBe(250);
    expect(store.getEqSources()[0].bands[1].gainDb).toBe(-4.5);
  });
});
