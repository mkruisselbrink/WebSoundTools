// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resolveDefaultLocalStorage(
  storage?: Partial<StorageLike> | null
): Partial<StorageLike> | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readStorageJson<T>(
  storageKey: string,
  storage?: Pick<StorageLike, 'getItem'> | null
): T | null {
  const target = resolveDefaultLocalStorage(storage);
  if (!target || typeof target.getItem !== 'function') return null;
  try {
    const raw = target.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStorageJson(
  storageKey: string,
  value: unknown,
  storage?: Pick<StorageLike, 'setItem'> | null
): boolean {
  const target = resolveDefaultLocalStorage(storage);
  if (!target || typeof target.setItem !== 'function') return false;
  try {
    target.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorageKey(
  storageKey: string,
  storage?: Pick<StorageLike, 'removeItem'> | null
): void {
  const target = resolveDefaultLocalStorage(storage);
  if (!target || typeof target.removeItem !== 'function') return;
  try {
    target.removeItem(storageKey);
  } catch {
    // Ignore storage removal errors
  }
}
