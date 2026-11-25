// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveControllerHost } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import { StoreSubscriptionController } from './store-subscription.js';

function createMockHost(): ReactiveControllerHost & {
  readonly requestUpdateSpy: ReturnType<typeof vi.fn<() => void>>;
} {
  const requestUpdateSpy = vi.fn<() => void>();
  return {
    addController() {},
    removeController() {},
    requestUpdate: requestUpdateSpy,
    requestUpdateSpy,
    updateComplete: Promise.resolve(true),
  };
}

describe('StoreSubscriptionController', () => {
  it('subscribes on hostConnected, filters via shouldProcess and shallowEqual select, and cleans up on hostDisconnected', () => {
    const listeners = new Set<(kind: 'live' | 'authored') => void>();
    let authoredCount = 1;
    let liveTick = 0;

    const source = {
      subscribe(fn: (kind: 'live' | 'authored') => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };

    const emit = (kind: 'live' | 'authored') => {
      for (const fn of listeners) fn(kind);
    };

    const host = createMockHost();
    const sub = new StoreSubscriptionController(host, source, {
      shouldProcess: (kind) => kind !== 'live',
      select: () => [authoredCount],
    });

    expect(listeners.size).toBe(0);
    sub.hostConnected();
    expect(listeners.size).toBe(1);

    // 25 Hz 'live' ticks are skipped by shouldProcess
    liveTick++;
    emit('live');
    expect(liveTick).toBe(1);
    expect(host.requestUpdateSpy).not.toHaveBeenCalled();

    // 'authored' notification with unchanged selected tuple skips requestUpdate
    emit('authored');
    expect(host.requestUpdateSpy).not.toHaveBeenCalled();

    // 'authored' notification with updated selected value triggers requestUpdate
    authoredCount = 2;
    emit('authored');
    expect(host.requestUpdateSpy).toHaveBeenCalledTimes(1);

    sub.hostDisconnected();
    expect(listeners.size).toBe(0);
  });
});
