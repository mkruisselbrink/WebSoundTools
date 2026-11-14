// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { dispatchAppShortcut, type AppShortcutHandlers } from './keyboard-shortcuts.js';

function createHandlers(): AppShortcutHandlers {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    addPointSource: vi.fn(),
    addSubArray: vi.fn(),
    addVirtualMic: vi.fn(),
    toggleGroundReflection: vi.fn(),
    setLayoutMode: vi.fn(),
    openSpeakerLibrary: vi.fn(),
    onEscape: vi.fn(),
  };
}

describe('Keyboard Shortcuts Dispatcher', () => {
  it('handles Undo, Redo, entity creation, ground toggle, and layout switching outside inputs', () => {
    const h = createHandlers();
    const fire = (key: string, opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
      dispatchAppShortcut(
        {
          key,
          metaKey: opts.metaKey ?? false,
          ctrlKey: opts.ctrlKey ?? false,
          shiftKey: opts.shiftKey ?? false,
          altKey: false,
          preventDefault: vi.fn(),
        },
        h
      );

    expect(fire('z', { metaKey: true })).toBe(true);
    expect(h.undo).toHaveBeenCalledTimes(1);

    expect(fire('z', { metaKey: true, shiftKey: true })).toBe(true);
    expect(fire('y', { ctrlKey: true })).toBe(true);
    expect(h.redo).toHaveBeenCalledTimes(2);

    expect(fire('p')).toBe(true);
    expect(h.addPointSource).toHaveBeenCalledTimes(1);

    expect(fire('s')).toBe(true);
    expect(h.addSubArray).toHaveBeenCalledTimes(1);

    expect(fire('m')).toBe(true);
    expect(h.addVirtualMic).toHaveBeenCalledTimes(1);

    expect(fire('g')).toBe(true);
    expect(h.toggleGroundReflection).toHaveBeenCalledTimes(1);

    expect(fire('2')).toBe(true);
    expect(h.setLayoutMode).toHaveBeenCalledWith('plan');
  });

  it('ignores single-key shortcuts when composedPath includes a Shadow DOM input element', () => {
    const h = createHandlers();
    const handled = dispatchAppShortcut(
      {
        key: 'p',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        composedPath: () => [{ tagName: 'INPUT' } as unknown as EventTarget],
        preventDefault: vi.fn(),
      },
      h
    );
    expect(handled).toBe(false);
    expect(h.addPointSource).not.toHaveBeenCalled();
  });
});

