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

import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteStoredTraceFromDb,
  loadAllStoredTracesFromDb,
  saveStoredTraceToDb,
} from '../../src/sources/session-storage.js';
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../../src/sources/source-data.js';

function createSampleStoredTrace(id: string, name: string): SourceData {
  const freqData = createEmptyFrequencyDomainData(17, 48000);
  freqData.magnitude.fill(2.0);
  const timeData = createEmptyTimeDomainData(32, 48000);
  timeData.impulse[16] = 0.75;
  return {
    id,
    name,
    kind: 'stored',
    color: '#f43f5e',
    visible: true,
    active: true,
    sampleRate: 48000,
    gainOffsetDb: 1.5,
    delayOffsetMs: -0.5,
    invertPolarity: false,
    createdAt: new Date().toISOString(),
    notes: 'Test note',
    freqData,
    timeData,
  };
}

describe('session-storage', () => {
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: originalIndexedDb,
      configurable: true,
      writable: true,
    });
  });

  it('gracefully falls back when indexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const trace = createSampleStoredTrace('stored-1', 'Fallback Trace');
    await expect(saveStoredTraceToDb(trace)).resolves.toBeUndefined();
    await expect(loadAllStoredTracesFromDb()).resolves.toEqual([]);
    await expect(deleteStoredTraceFromDb('stored-1')).resolves.toBeUndefined();
  });

  it('saves, loads, and deletes stored traces using IndexedDB', async () => {
    const records = new Map<string, unknown>();

    const mockStore = {
      put: (val: { id: string }) => {
        records.set(val.id, val);
      },
      delete: (id: string) => {
        records.delete(id);
      },
      getAll: () => {
        const req: { result: unknown[]; onsuccess?: () => void; onerror?: () => void } = {
          result: Array.from(records.values()),
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    };

    const mockDb = {
      objectStoreNames: { contains: () => false },
      createObjectStore: () => mockStore,
      transaction: () => {
        const tx: {
          objectStore: () => typeof mockStore;
          oncomplete?: () => void;
          onerror?: () => void;
        } = {
          objectStore: () => mockStore,
        };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      },
    };

    const mockIndexedDb = {
      open: () => {
        const req: {
          result: typeof mockDb;
          onupgradeneeded?: () => void;
          onsuccess?: () => void;
          onerror?: () => void;
        } = {
          result: mockDb,
        };
        queueMicrotask(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    };

    Object.defineProperty(globalThis, 'indexedDB', {
      value: mockIndexedDb,
      configurable: true,
      writable: true,
    });

    const trace = createSampleStoredTrace('stored-42', 'Sub Alignment');
    await saveStoredTraceToDb(trace);

    const loaded = await loadAllStoredTracesFromDb();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('stored-42');
    expect(loaded[0].name).toBe('Sub Alignment');
    expect(loaded[0].gainOffsetDb).toBe(1.5);
    expect(loaded[0].freqData.magnitude[0]).toBeCloseTo(2.0, 5);

    await deleteStoredTraceFromDb('stored-42');
    const afterDelete = await loadAllStoredTracesFromDb();
    expect(afterDelete).toHaveLength(0);
  });
});

