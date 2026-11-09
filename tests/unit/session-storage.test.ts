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
import { createDefaultEqBands } from '../../src/sources/eq-source.js';
import {
  StoredCalibrationFile,
  deleteCalibrationFileFromDb,
  deleteEqSourceFromDb,
  deleteStoredTraceFromDb,
  deleteUnionSourceFromDb,
  loadAllCalibrationFilesFromDb,
  loadAllEqSourcesFromDb,
  loadAllStoredTracesFromDb,
  loadAllUnionSourcesFromDb,
  saveCalibrationFileToDb,
  saveEqSourceToDb,
  saveStoredTraceToDb,
  saveUnionSourceToDb,
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

describe('session-storage (IndexedDB v2)', () => {
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
    await expect(loadAllEqSourcesFromDb()).resolves.toEqual([]);
    await expect(loadAllUnionSourcesFromDb()).resolves.toEqual([]);
    await expect(loadAllCalibrationFilesFromDb()).resolves.toEqual([]);
  });

  it('saves, loads, and deletes stored traces, EQ sources, Union sources, and calibration curves', async () => {
    const stores = new Map<string, Map<string, unknown>>();
    const getStoreMap = (name: string) => {
      let map = stores.get(name);
      if (!map) {
        map = new Map();
        stores.set(name, map);
      }
      return map;
    };

    const createMockObjectStore = (storeName: string) => {
      const records = getStoreMap(storeName);
      return {
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
    };

    const mockDb = {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => createMockObjectStore(name),
      transaction: (storeName: string) => {
        const tx: {
          objectStore: () => ReturnType<typeof createMockObjectStore>;
          oncomplete?: () => void;
          onerror?: () => void;
        } = {
          objectStore: () => createMockObjectStore(storeName),
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

    // 1. Stored trace
    const trace = createSampleStoredTrace('stored-42', 'Sub Alignment');
    await saveStoredTraceToDb(trace);
    const loadedTraces = await loadAllStoredTracesFromDb();
    expect(loadedTraces).toHaveLength(1);
    expect(loadedTraces[0].name).toBe('Sub Alignment');
    await deleteStoredTraceFromDb('stored-42');
    expect(await loadAllStoredTracesFromDb()).toHaveLength(0);

    // 2. Virtual EQ source
    await saveEqSourceToDb({
      id: 'eq-1',
      name: 'Virtual EQ #1',
      color: '#10b981',
      visible: true,
      bands: createDefaultEqBands(),
      targetSourceId: 'live-measurement',
    });
    const loadedEq = await loadAllEqSourcesFromDb();
    expect(loadedEq).toHaveLength(1);
    expect(loadedEq[0].id).toBe('eq-1');
    await deleteEqSourceFromDb('eq-1');
    expect(await loadAllEqSourcesFromDb()).toHaveLength(0);

    // 3. Union source
    await saveUnionSourceToDb({
      id: 'union-1',
      name: 'Math Union #1',
      color: '#f59e0b',
      visible: true,
      operation: 'vector-avg',
      sourceIds: ['live-measurement', 'stored-42'],
    });
    const loadedUnion = await loadAllUnionSourcesFromDb();
    expect(loadedUnion).toHaveLength(1);
    expect(loadedUnion[0].id).toBe('union-1');
    await deleteUnionSourceFromDb('union-1');
    expect(await loadAllUnionSourcesFromDb()).toHaveLength(0);

    // 4. Calibration curve
    const cal: StoredCalibrationFile = {
      id: 'cal-umik1',
      name: 'UMIK-1.cal',
      text: '100 -1.2\n1000 0.0\n10000 1.8',
      pointCount: 3,
      createdAt: new Date().toISOString(),
    };
    await saveCalibrationFileToDb(cal);
    const loadedCals = await loadAllCalibrationFilesFromDb();
    expect(loadedCals).toHaveLength(1);
    expect(loadedCals[0].name).toBe('UMIK-1.cal');
    await deleteCalibrationFileFromDb('cal-umik1');
    expect(await loadAllCalibrationFilesFromDb()).toHaveLength(0);
  });
});
