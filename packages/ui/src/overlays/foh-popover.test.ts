// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { syncAnchoredPopoverToggle, toggleAnchoredPopover } from './foh-popover.js';

function createMockElement(id: string = '') {
  const attrs = new Map<string, string>();
  return {
    id,
    style: { top: '', left: '' },
    hasAttribute: (k: string) => attrs.has(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => {
      attrs.set(k, v);
    },
    removeAttribute: (k: string) => {
      attrs.delete(k);
    },
    toggleAttribute: (k: string, force?: boolean) => {
      const next = force !== undefined ? force : !attrs.has(k);
      if (next) attrs.set(k, '');
      else attrs.delete(k);
      return next;
    },
    getBoundingClientRect: () => ({
      top: 8,
      bottom: 34,
      left: 180,
      right: 300,
      width: 240,
      height: 160,
    }),
  } as unknown as HTMLElement;
}

describe('foh-popover helpers', () => {
  it('toggles headless fallback state and syncs aria-expanded on the trigger element', () => {
    const trigger = createMockElement('btn-io');
    const pop = createMockElement('io-popover');

    toggleAnchoredPopover(trigger, pop);
    expect(pop.hasAttribute('data-open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    toggleAnchoredPopover(trigger, pop, false);
    expect(pop.hasAttribute('data-open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('synchronizes aria-expanded from native ToggleEvent newState', () => {
    const trigger = createMockElement('btn-heatmap');
    const pop = createMockElement('heatmap-popover');
    const root = {
      querySelector: (sel: string) =>
        sel === '[data-popover-trigger="heatmap-popover"]' ? (trigger as unknown as Element) : null,
    };

    syncAnchoredPopoverToggle(
      { currentTarget: pop, newState: 'open' } as unknown as Event,
      root
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(pop.hasAttribute('data-open')).toBe(true);

    syncAnchoredPopoverToggle(
      { currentTarget: pop, newState: 'closed' } as unknown as Event,
      root
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(pop.hasAttribute('data-open')).toBe(false);
  });
});
