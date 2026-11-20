// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  getWindowControlsOverlaySnapshot,
  observeWindowControlsOverlay,
  type WindowControlsOverlayLike,
  type WindowControlsOverlaySnapshot,
} from './wco.js';

describe('Window Controls Overlay observer (@foh/pwa/client)', () => {
  it('returns inactive snapshot in standard browser or Node environments', () => {
    expect(getWindowControlsOverlaySnapshot({})).toEqual({
      visible: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('emits initial WCO rect, deduplicates identical geometrychange events, and cleans up listeners', () => {
    let visible = true;
    let rect = { x: 70, y: 0, width: 1210, height: 38 };
    const listeners = new Set<() => void>();

    const mockWco: WindowControlsOverlayLike = {
      get visible() {
        return visible;
      },
      getTitlebarAreaRect: () => rect,
      addEventListener: (_type, cb) => listeners.add(cb),
      removeEventListener: (_type, cb) => listeners.delete(cb),
    };

    const seen: WindowControlsOverlaySnapshot[] = [];
    const dispose = observeWindowControlsOverlay((snap) => seen.push(snap), {
      windowControlsOverlay: mockWco,
    });

    expect(seen).toEqual([{ visible: true, x: 70, y: 0, width: 1210, height: 38 }]);
    expect(listeners.size).toBe(1);

    // Identical geometrychange should be suppressed
    for (const cb of listeners) cb();
    expect(seen).toHaveLength(1);

    // Resize updates width
    rect = { x: 70, y: 0, width: 920, height: 38 };
    for (const cb of listeners) cb();
    expect(seen).toHaveLength(2);
    expect(seen[1].width).toBe(920);

    // Collapsing WCO back to standalone titlebar resets rect to 0
    visible = false;
    for (const cb of listeners) cb();
    expect(seen).toHaveLength(3);
    expect(seen[2]).toEqual({ visible: false, x: 0, y: 0, width: 0, height: 0 });

    dispose();
    expect(listeners.size).toBe(0);
  });
});
