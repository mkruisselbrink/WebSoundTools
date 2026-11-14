// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { IdbRepository } from './idb-repository.js';

describe('IdbRepository', () => {
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: originalIndexedDb,
      configurable: true,
      writable: true,
    });
  });

  it('supports in-memory fallback and noop fallback when indexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const memRepo = new IdbRepository({
      dbName: 'test-mem',
      dbVersion: 1,
      storeNames: ['items'],
      fallbackMode: 'memory',
    });
    await memRepo.put('items', { id: 'a', value: 1 });
    await memRepo.putMany('items', [
      { id: 'b', value: 2 },
      { id: 'c', value: 3 },
    ]);
    expect(await memRepo.getAll('items')).toHaveLength(3);
    await memRepo.delete('items', 'b');
    expect(await memRepo.getAll('items')).toHaveLength(2);
    await memRepo.clear('items');
    expect(await memRepo.getAll('items')).toHaveLength(0);

    const noopRepo = new IdbRepository({
      dbName: 'test-noop',
      dbVersion: 1,
      storeNames: ['items'],
      fallbackMode: 'noop',
    });
    await noopRepo.put('items', { id: 'a', value: 1 });
    expect(await noopRepo.getAll('items')).toEqual([]);
  });
});
