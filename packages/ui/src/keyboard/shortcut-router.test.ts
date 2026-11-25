// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  dispatchKeyboardShortcut,
  isEditableShortcutTarget,
} from './shortcut-router.js';

describe('shortcut-router', () => {
  it('suppresses bindings inside Shadow DOM inputs and selects via composedPath', () => {
    const onCapture = vi.fn();
    const ev = {
      key: 'c',
      target: { tagName: 'CUSTOM-APP' },
      composedPath: () => [{ tagName: 'INPUT' }, { tagName: 'CUSTOM-APP' }],
    };
    expect(isEditableShortcutTarget(ev)).toBe(true);
    expect(
      dispatchKeyboardShortcut(ev, { bindings: { c: onCapture } })
    ).toBe(false);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('dispatches Escape, Mod+Z Undo, Mod+Shift+Z / Ctrl+Y Redo, Space, and single-key bindings', () => {
    const onEscape = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onSpace = vi.fn();
    const onMic = vi.fn();
    const preventDefault = vi.fn();

    const cfg = {
      onEscape,
      onUndo,
      onRedo,
      bindings: {
        space: onSpace,
        m: onMic,
      },
    };

    expect(dispatchKeyboardShortcut({ key: 'Escape', preventDefault }, cfg)).toBe(true);
    expect(onEscape).toHaveBeenCalledTimes(1);

    expect(
      dispatchKeyboardShortcut({ key: 'z', metaKey: true, preventDefault }, cfg)
    ).toBe(true);
    expect(onUndo).toHaveBeenCalledTimes(1);

    expect(
      dispatchKeyboardShortcut(
        { key: 'z', metaKey: true, shiftKey: true, preventDefault },
        cfg
      )
    ).toBe(true);
    expect(
      dispatchKeyboardShortcut({ key: 'y', ctrlKey: true, preventDefault }, cfg)
    ).toBe(true);
    expect(onRedo).toHaveBeenCalledTimes(2);

    expect(
      dispatchKeyboardShortcut(
        { code: 'Space', key: ' ', target: { tagName: 'DIV' }, preventDefault },
        cfg
      )
    ).toBe(true);
    expect(onSpace).toHaveBeenCalledTimes(1);

    expect(
      dispatchKeyboardShortcut({ key: 'M', preventDefault }, cfg)
    ).toBe(true);
    expect(onMic).toHaveBeenCalledTimes(1);
  });

  it('dispatches Shift+Space separately from Space even when a button has focus', () => {
    const onSpace = vi.fn();
    const onShiftSpace = vi.fn();
    const preventDefault = vi.fn();
    const cfg = {
      bindings: {
        space: onSpace,
        'shift+space': onShiftSpace,
      },
    };

    // Plain Space on a focused <button> lets native button click fire
    expect(
      dispatchKeyboardShortcut(
        { code: 'Space', key: ' ', target: { tagName: 'BUTTON' }, preventDefault },
        cfg
      )
    ).toBe(false);
    expect(onSpace).not.toHaveBeenCalled();

    // Shift+Space dispatches shift+space binding even when a <button> is focused
    expect(
      dispatchKeyboardShortcut(
        {
          code: 'Space',
          key: ' ',
          shiftKey: true,
          target: { tagName: 'BUTTON' },
          preventDefault,
        },
        cfg
      )
    ).toBe(true);
    expect(onShiftSpace).toHaveBeenCalledTimes(1);
    expect(onSpace).not.toHaveBeenCalled();
  });
});
