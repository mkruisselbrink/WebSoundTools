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

/**
 * Local Browser Session & Acoustic Library Persistence (`IndexedDB` v2).
 *
 * Object Stores in `web-sound-meter-db`:
 *  - `stored-traces`: Serialized `SourceData` snapshots (Float32 frequency & impulse buffers)
 *  - `eq-sources`: `EqualizerSourceConfig` virtual parametric EQ sources
 *  - `union-sources`: `UnionSourceConfig` math/union sources
 *  - `calibration-curves`: `StoredCalibrationFile` uploaded microphone calibration files
 */

import { SplHistoryCheckpoint } from '../dsp/spl-history.js';
import { EqualizerSourceConfig } from './eq-source.js';
import {
  SerializedSourceData,
  SourceData,
  deserializeSourceData,
  serializeSourceData,
} from './source-data.js';
import { UnionSourceConfig } from './union-source.js';

export interface StoredCalibrationFile {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly pointCount: number;
  readonly createdAt: string;
}

const DB_NAME = 'web-sound-meter-db';
const DB_VERSION = 3;
const STORE_TRACES = 'stored-traces';
const STORE_EQ_SOURCES = 'eq-sources';
const STORE_UNION_SOURCES = 'union-sources';
const STORE_CALIBRATIONS = 'calibration-curves';
const STORE_SPL_SHOW_LOGS = 'spl-show-logs';

const ALL_STORES = [
  STORE_TRACES,
  STORE_EQ_SOURCES,
  STORE_UNION_SOURCES,
  STORE_CALIBRATIONS,
  STORE_SPL_SHOW_LOGS,
] as const;

let cachedDbPromise: Promise<IDBDatabase> | null = null;
let cachedIndexedDbRef: IDBFactory | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    cachedDbPromise = null;
    cachedIndexedDbRef = null;
    return Promise.reject(
      new Error('IndexedDB is not available in this environment')
    );
  }
  if (cachedDbPromise && cachedIndexedDbRef === indexedDB) {
    return cachedDbPromise;
  }
  cachedIndexedDbRef = indexedDB;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const storeName of ALL_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        if (cachedDbPromise === promise) cachedDbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        if (cachedDbPromise === promise) cachedDbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      if (cachedDbPromise === promise) cachedDbPromise = null;
      reject(req.error);
    };
  });
  cachedDbPromise = promise;
  return promise;
}

async function putRecord<T>(storeName: string, record: T): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore in environments without IndexedDB
  }
}

async function deleteRecord(storeName: string, id: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore in environments without IndexedDB
  }
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    return await new Promise<T[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveStoredTraceToDb(source: SourceData): Promise<void> {
  await putRecord(STORE_TRACES, serializeSourceData(source));
}

export async function deleteStoredTraceFromDb(id: string): Promise<void> {
  await deleteRecord(STORE_TRACES, id);
}

export async function loadAllStoredTracesFromDb(): Promise<SourceData[]> {
  const records = await getAllRecords<SerializedSourceData>(STORE_TRACES);
  return records.map(deserializeSourceData);
}

export async function saveEqSourceToDb(eq: EqualizerSourceConfig): Promise<void> {
  await putRecord(STORE_EQ_SOURCES, eq);
}

export async function deleteEqSourceFromDb(id: string): Promise<void> {
  await deleteRecord(STORE_EQ_SOURCES, id);
}

export async function loadAllEqSourcesFromDb(): Promise<EqualizerSourceConfig[]> {
  return getAllRecords<EqualizerSourceConfig>(STORE_EQ_SOURCES);
}

export async function saveUnionSourceToDb(union: UnionSourceConfig): Promise<void> {
  await putRecord(STORE_UNION_SOURCES, union);
}

export async function deleteUnionSourceFromDb(id: string): Promise<void> {
  await deleteRecord(STORE_UNION_SOURCES, id);
}

export async function loadAllUnionSourcesFromDb(): Promise<UnionSourceConfig[]> {
  return getAllRecords<UnionSourceConfig>(STORE_UNION_SOURCES);
}

export async function saveCalibrationFileToDb(
  calibration: StoredCalibrationFile
): Promise<void> {
  await putRecord(STORE_CALIBRATIONS, calibration);
}

export async function deleteCalibrationFileFromDb(id: string): Promise<void> {
  await deleteRecord(STORE_CALIBRATIONS, id);
}

export async function loadAllCalibrationFilesFromDb(): Promise<StoredCalibrationFile[]> {
  return getAllRecords<StoredCalibrationFile>(STORE_CALIBRATIONS);
}

/**
 * Persists one or more 1 Hz SPL show log checkpoints in a single batched IndexedDB transaction.
 */
export async function saveSplShowCheckpointsToDb(
  checkpoints: readonly SplHistoryCheckpoint[]
): Promise<void> {
  if (checkpoints.length === 0) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SPL_SHOW_LOGS, 'readwrite');
    const store = tx.objectStore(STORE_SPL_SHOW_LOGS);
    for (const cp of checkpoints) {
      store.put(cp);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore in environments without IndexedDB
  }
}

export async function loadAllSplShowCheckpointsFromDb(): Promise<SplHistoryCheckpoint[]> {
  return getAllRecords<SplHistoryCheckpoint>(STORE_SPL_SHOW_LOGS);
}

export async function clearSplShowCheckpointsFromDb(): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SPL_SHOW_LOGS, 'readwrite');
    const store = tx.objectStore(STORE_SPL_SHOW_LOGS);
    if (typeof store.clear === 'function') {
      store.clear();
    } else {
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as Array<{ id: string }>) ?? [];
        for (const item of items) {
          store.delete(item.id);
        }
      };
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore in environments without IndexedDB
  }
}

