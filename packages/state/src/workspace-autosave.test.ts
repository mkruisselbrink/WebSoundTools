// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  type StorageLike,
  readStorageJson,
  removeStorageKey,
  writeStorageJson,
} from './workspace-autosave.js';

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('workspace-autosave', () => {
  it('writes, reads, and removes JSON payloads safely', () => {
    const mem = new MemoryStorage();
    expect(writeStorageJson('test:v1', { ok: true, count: 3 }, mem)).toBe(true);
    expect(readStorageJson<{ ok: boolean; count: number }>('test:v1', mem)).toEqual({
      ok: true,
      count: 3,
    });
    removeStorageKey('test:v1', mem);
    expect(readStorageJson('test:v1', mem)).toBeNull();
  });
});
