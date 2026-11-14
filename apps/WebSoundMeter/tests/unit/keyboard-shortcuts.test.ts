/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from 'vitest';
import {
  dispatchAppKeydown,
  shouldIgnoreShortcutEvent,
} from '../../src/ui/keyboard-shortcuts.js';

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
  });
});

