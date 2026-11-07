/**
 * Local Browser Session & Stored Trace Persistence (`IndexedDB` + JSON Export/Import).
 */

import {
  SerializedSourceData,
  SourceData,
  deserializeSourceData,
  serializeSourceData,
} from './source-data.js';

const DB_NAME = 'web-sound-meter-db';
const DB_VERSION = 1;
const STORE_TRACES = 'stored-traces';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACES)) {
        db.createObjectStore(STORE_TRACES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveStoredTraceToDb(source: SourceData): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_TRACES, 'readwrite');
    const store = tx.objectStore(STORE_TRACES);
    store.put(serializeSourceData(source));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore in environments without IndexedDB
  }
}

export async function deleteStoredTraceFromDb(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_TRACES, 'readwrite');
    const store = tx.objectStore(STORE_TRACES);
    store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function loadAllStoredTracesFromDb(): Promise<SourceData[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_TRACES, 'readonly');
    const store = tx.objectStore(STORE_TRACES);
    const req = store.getAll();
    const records = await new Promise<SerializedSourceData[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as SerializedSourceData[]);
      req.onerror = () => reject(req.error);
    });
    return records.map(deserializeSourceData);
  } catch {
    return [];
  }
}
