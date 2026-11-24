// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  ScreenWakeLockController,
  type VisibilityDocumentLike,
  type WakeLockSentinelLike,
} from './wake-lock.js';

function createMockSentinel(): WakeLockSentinelLike & { triggerOsRelease(): void } {
  let released = false;
  const listeners = new Set<() => void>();
  return {
    get released() {
      return released;
    },
    async release() {
      released = true;
      for (const fn of listeners) fn();
    },
    addEventListener(_type, fn) {
      listeners.add(fn);
    },
    removeEventListener(_type, fn) {
      listeners.delete(fn);
    },
    triggerOsRelease() {
      released = true;
      for (const fn of listeners) fn();
    },
  };
}

function createMockDoc(initial: DocumentVisibilityState = 'visible'): VisibilityDocumentLike & {
  setVisibility(state: DocumentVisibilityState): void;
} {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get visibilityState() {
      return current;
    },
    addEventListener(_type, fn) {
      listeners.add(fn);
    },
    removeEventListener(_type, fn) {
      listeners.delete(fn);
    },
    setVisibility(next) {
      current = next;
      for (const fn of listeners) fn();
    },
  };
}

describe('ScreenWakeLockController', () => {
  it('acquires a screen wake lock when desired, re-acquires after visibility restore, and releases cleanly', async () => {
    const sentinels: Array<ReturnType<typeof createMockSentinel>> = [];
    const wakeLock = {
      request: vi.fn(async () => {
        const s = createMockSentinel();
        sentinels.push(s);
        return s;
      }),
    };
    const doc = createMockDoc('visible');
    const states: boolean[] = [];

    const ctrl = new ScreenWakeLockController({
      wakeLock,
      doc,
      onChange: (active) => states.push(active),
    });

    expect(ctrl.isSupported).toBe(true);
    expect(ctrl.isActive).toBe(false);

    await ctrl.setDesired(true);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    expect(ctrl.isActive).toBe(true);
    expect(states).toEqual([true]);

    // Simulate OS releasing wake lock when tab goes hidden, then re-acquiring on visible
    doc.setVisibility('hidden');
    sentinels[0].triggerOsRelease();
    expect(ctrl.isActive).toBe(false);

    doc.setVisibility('visible');
    await Promise.resolve();
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
    expect(ctrl.isActive).toBe(true);

    // Turning off desired releases sentinel and detaches visibility listener
    await ctrl.setDesired(false);
    expect(ctrl.isActive).toBe(false);
    expect(sentinels[1].released).toBe(true);

    doc.setVisibility('hidden');
    doc.setVisibility('visible');
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('degrades gracefully when navigator.wakeLock is unsupported or rejects', async () => {
    const unsupported = new ScreenWakeLockController({ wakeLock: null, doc: null });
    expect(unsupported.isSupported).toBe(false);
    await unsupported.setDesired(true);
    expect(unsupported.isActive).toBe(false);

    const rejecting = new ScreenWakeLockController({
      wakeLock: {
        request: vi.fn(async () => {
          throw new Error('Low Power Mode');
        }),
      },
      doc: createMockDoc('visible'),
    });
    await expect(rejecting.setDesired(true)).resolves.toBeUndefined();
    expect(rejecting.isActive).toBe(false);
  });
});
