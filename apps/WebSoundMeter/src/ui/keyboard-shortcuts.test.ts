// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  dispatchAppKeydown,
  shouldIgnoreShortcutEvent,
} from './keyboard-shortcuts.js';

describe('keyboard-shortcuts', () => {
  it('ignores keystrokes originating inside Shadow DOM inputs via composedPath', () => {
    const shadowHost = { tagName: 'WEB-SOUND-METER-APP' };
    const innerInput = { tagName: 'INPUT' };

    const eventInInput = {
      key: 'c',
      code: 'KeyC',
      target: shadowHost,
      composedPath: () => [innerInput, shadowHost],
    };

    expect(shouldIgnoreShortcutEvent(eventInInput)).toBe(true);

    const onCaptureTrace = vi.fn();
    const onFindAndApplyDelay = vi.fn();
    expect(
      dispatchAppKeydown(eventInInput, { onCaptureTrace, onFindAndApplyDelay })
    ).toBe(false);
    expect(onCaptureTrace).not.toHaveBeenCalled();
  });

  it('ignores shortcuts when Ctrl/Meta/Alt modifiers are held', () => {
    const onCaptureTrace = vi.fn();
    const onFindAndApplyDelay = vi.fn();

    expect(
      dispatchAppKeydown(
        { key: 'c', metaKey: true, target: { tagName: 'DIV' } },
        { onCaptureTrace, onFindAndApplyDelay }
      )
    ).toBe(false);
    expect(onCaptureTrace).not.toHaveBeenCalled();
  });

  it('dispatches pause, capture, delay, and add-live-source actions for Space, C, D, and M outside form fields', () => {
    const onCaptureTrace = vi.fn();
    const onFindAndApplyDelay = vi.fn();
    const onTogglePause = vi.fn();
    const onAddLiveSource = vi.fn();
    const preventDefault = vi.fn();

    expect(
      dispatchAppKeydown(
        { code: 'Space', key: ' ', target: { tagName: 'DIV' }, preventDefault },
        { onCaptureTrace, onFindAndApplyDelay, onTogglePause, onAddLiveSource }
      )
    ).toBe(true);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    expect(
      dispatchAppKeydown(
        { key: 'c', target: { tagName: 'DIV' }, preventDefault },
        { onCaptureTrace, onFindAndApplyDelay, onTogglePause, onAddLiveSource }
      )
    ).toBe(true);
    expect(onCaptureTrace).toHaveBeenCalledTimes(1);

    expect(
      dispatchAppKeydown(
        { key: 'd', target: { tagName: 'DIV' }, preventDefault },
        { onCaptureTrace, onFindAndApplyDelay, onTogglePause, onAddLiveSource }
      )
    ).toBe(true);
    expect(onFindAndApplyDelay).toHaveBeenCalledTimes(1);

    expect(
      dispatchAppKeydown(
        { key: 'm', target: { tagName: 'DIV' }, preventDefault },
        { onCaptureTrace, onFindAndApplyDelay, onTogglePause, onAddLiveSource }
      )
    ).toBe(true);
    expect(onAddLiveSource).toHaveBeenCalledTimes(1);

    const onUndo = vi.fn();
    const onRedo = vi.fn();
    expect(
      dispatchAppKeydown(
        { key: 'z', metaKey: true, target: { tagName: 'DIV' }, preventDefault },
        { onCaptureTrace, onFindAndApplyDelay, onUndo, onRedo }
      )
    ).toBe(true);
    expect(onUndo).toHaveBeenCalledTimes(1);

    expect(
      dispatchAppKeydown(
        {
          key: 'z',
          metaKey: true,
          shiftKey: true,
          target: { tagName: 'DIV' },
          preventDefault,
        },
        { onCaptureTrace, onFindAndApplyDelay, onUndo, onRedo }
      )
    ).toBe(true);
    expect(onRedo).toHaveBeenCalledTimes(1);

    const onAddEqSource = vi.fn();
    const onAddUnionSource = vi.fn();
    const onResetAveraging = vi.fn();
    const onSelectLayoutCount = vi.fn();
    const onOpenHelp = vi.fn();
    const onEscape = vi.fn();

    for (const key of ['e', 'u', 'r', '1', '2', '3', '?', 'Escape']) {
      expect(
        dispatchAppKeydown(
          { key, shiftKey: key === '?', target: { tagName: 'DIV' }, preventDefault },
          {
            onCaptureTrace,
            onFindAndApplyDelay,
            onAddEqSource,
            onAddUnionSource,
            onResetAveraging,
            onSelectLayoutCount,
            onOpenHelp,
            onEscape,
          }
        )
      ).toBe(true);
    }
    expect(onAddEqSource).toHaveBeenCalledTimes(1);
    expect(onAddUnionSource).toHaveBeenCalledTimes(1);
    expect(onResetAveraging).toHaveBeenCalledTimes(1);
    expect(onSelectLayoutCount).toHaveBeenNthCalledWith(1, 1);
    expect(onSelectLayoutCount).toHaveBeenNthCalledWith(2, 2);
    expect(onSelectLayoutCount).toHaveBeenNthCalledWith(3, 3);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

