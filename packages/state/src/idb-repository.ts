// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export interface IdbRepositoryConfig {
  readonly dbName: string;
  readonly dbVersion: number;
  readonly storeNames: readonly string[];
  readonly keyPath?: string;
  /**
   * Behavior when `indexedDB` is unavailable or fails to open:
   * - `'memory'` (default): stores records in an per-instance in-memory `Map`
   * - `'noop'`: ignores writes and returns `[]` on reads
   */
  readonly fallbackMode?: 'memory' | 'noop';
}

/**
 * Multi-store `IndexedDB` CRUD wrapper with automatic environment detection
 * and configurable in-memory / no-op fallback for headless Node tests or restricted contexts.
 */
export class IdbRepository {
  public readonly dbName: string;
  public readonly dbVersion: number;
  public readonly storeNames: readonly string[];
  private readonly keyPath: string;
  private readonly fallbackMode: 'memory' | 'noop';

  private cachedDbPromise: Promise<IDBDatabase | null> | null = null;
  private resolvedDb: IDBDatabase | null = null;
  private cachedIndexedDbRef: IDBFactory | undefined = undefined;
  private readonly memoryStores = new Map<string, Map<string, unknown>>();

  constructor(config: IdbRepositoryConfig) {
    this.dbName = config.dbName;
    this.dbVersion = config.dbVersion;
    this.storeNames = [...config.storeNames];
    this.keyPath = config.keyPath ?? 'id';
    this.fallbackMode = config.fallbackMode ?? 'memory';
  }

  private getMemoryMap(storeName: string): Map<string, unknown> {
    let map = this.memoryStores.get(storeName);
    if (!map) {
      map = new Map();
      this.memoryStores.set(storeName, map);
    }
    return map;
  }

  private openDatabase(): Promise<IDBDatabase | null> {
    const currentIdb =
      typeof indexedDB !== 'undefined' ? indexedDB : undefined;
    if (!currentIdb) {
      this.cachedDbPromise = null;
      this.resolvedDb = null;
      this.cachedIndexedDbRef = undefined;
      return Promise.resolve(null);
    }
    if (this.cachedDbPromise && this.cachedIndexedDbRef === currentIdb) {
      return this.cachedDbPromise;
    }

    this.resolvedDb = null;
    this.cachedIndexedDbRef = currentIdb;
    const promise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = currentIdb.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const storeName of this.storeNames) {
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName, { keyPath: this.keyPath });
            }
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          this.resolvedDb = db;
          db.onclose = () => {
            if (this.cachedDbPromise === promise) {
              this.cachedDbPromise = null;
              this.resolvedDb = null;
            }
          };
          db.onversionchange = () => {
            db.close();
            if (this.cachedDbPromise === promise) {
              this.cachedDbPromise = null;
              this.resolvedDb = null;
            }
          };
          resolve(db);
        };
        req.onerror = () => {
          if (this.cachedDbPromise === promise) {
            this.cachedDbPromise = null;
            this.resolvedDb = null;
          }
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    this.cachedDbPromise = promise;
    return promise;
  }

  private openReadwriteTx(db: IDBDatabase, storeName: string): IDBTransaction {
    try {
      return db.transaction(storeName, 'readwrite', { durability: 'strict' });
    } catch {
      return db.transaction(storeName, 'readwrite');
    }
  }

  private getReadyDbSync(): IDBDatabase | null {
    const currentIdb = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
    if (currentIdb && this.resolvedDb && this.cachedIndexedDbRef === currentIdb) {
      return this.resolvedDb;
    }
    return null;
  }

  public async put<T>(storeName: string, record: T): Promise<void> {
    const db = this.getReadyDbSync() ?? (await this.openDatabase());
    if (!db) {
      if (this.fallbackMode === 'memory') {
        const key = String((record as Record<string, unknown>)[this.keyPath] ?? '');
        this.getMemoryMap(storeName).set(key, record);
      }
      return;
    }

    try {
      const tx = this.openReadwriteTx(db, storeName);
      tx.objectStore(storeName).put(record);
      tx.commit?.();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore write failures in restricted environments
    }
  }

  public async putMany<T>(storeName: string, records: readonly T[]): Promise<void> {
    if (records.length === 0) return;
    const db = this.getReadyDbSync() ?? (await this.openDatabase());
    if (!db) {
      if (this.fallbackMode === 'memory') {
        const map = this.getMemoryMap(storeName);
        for (const rec of records) {
          const key = String((rec as Record<string, unknown>)[this.keyPath] ?? '');
          map.set(key, rec);
        }
      }
      return;
    }

    try {
      const tx = this.openReadwriteTx(db, storeName);
      const store = tx.objectStore(storeName);
      for (const rec of records) {
        store.put(rec);
      }
      tx.commit?.();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore write failures in restricted environments
    }
  }

  public async delete(storeName: string, id: string): Promise<void> {
    const db = this.getReadyDbSync() ?? (await this.openDatabase());
    if (!db) {
      if (this.fallbackMode === 'memory') {
        this.getMemoryMap(storeName).delete(id);
      }
      return;
    }

    try {
      const tx = this.openReadwriteTx(db, storeName);
      tx.objectStore(storeName).delete(id);
      tx.commit?.();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore delete failures in restricted environments
    }
  }

  public async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.openDatabase();
    if (!db) {
      if (this.fallbackMode === 'memory') {
        return Array.from(this.getMemoryMap(storeName).values()) as T[];
      }
      return [];
    }

    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      return await new Promise<T[]>((resolve, reject) => {
        req.onsuccess = () => resolve((req.result as T[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  public async clear(storeName: string): Promise<void> {
    const db = this.getReadyDbSync() ?? (await this.openDatabase());
    if (!db) {
      if (this.fallbackMode === 'memory') {
        this.getMemoryMap(storeName).clear();
      }
      return;
    }

    try {
      const tx = this.openReadwriteTx(db, storeName);
      const store = tx.objectStore(storeName);
      if (typeof store.clear === 'function') {
        store.clear();
        tx.commit?.();
      } else {
        const req = store.getAll();
        req.onsuccess = () => {
          const items = (req.result as Array<Record<string, unknown>>) ?? [];
          for (const item of items) {
            const key = item[this.keyPath];
            if (typeof key === 'string') {
              store.delete(key);
            }
          }
          tx.commit?.();
        };
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore clear failures in restricted environments
    }
  }
}
