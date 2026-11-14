// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ReactiveUndoStore } from './reactive-undo-store.js';

describe('ReactiveUndoStore', () => {
  it('tracks undo/redo history and coalesces updates sharing a transaction key', () => {
    let fakeNow = 1000;
    const store = new ReactiveUndoStore(
      { gainDb: 0 },
      { maxHistory: 3, coalesceWindowMs: 800, now: () => fakeNow }
    );

    const events: Array<{ gainDb: number; isInteractive: boolean }> = [];
    store.subscribe((s, isInteractive) => events.push({ ...s, isInteractive }));

    for (let i = 1; i <= 4; i++) {
      fakeNow += 50;
      store.update(() => ({ gainDb: i }), 'drag-gain');
    }
    store.endTransaction();

    expect(store.state.gainDb).toBe(4);
    expect(events).toHaveLength(4);
    expect(events[0].isInteractive).toBe(true);

    expect(store.undo()).toBe(true);
    expect(store.state.gainDb).toBe(0);
    expect(store.canUndo).toBe(false);

    expect(store.redo()).toBe(true);
    expect(store.state.gainDb).toBe(4);

    // Bounded history cap
    store.update(() => ({ gainDb: 5 }));
    store.update(() => ({ gainDb: 6 }));
    store.update(() => ({ gainDb: 7 }));
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
  });
});
