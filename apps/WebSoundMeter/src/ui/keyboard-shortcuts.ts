// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Application keyboard shortcut bindings for WebSoundMeter.
 */

import {
  dispatchKeyboardShortcut,
  isEditableShortcutTarget,
  type ShortcutEventLike,
} from '@foh/ui';

export interface AppShortcutActions {
  readonly onCaptureTrace: () => void;
  readonly onFindAndApplyDelay: () => void;
  readonly onTogglePause?: () => void;
  readonly onAddLiveSource?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
}

export type ShortcutKeyboardEventLike = ShortcutEventLike;

export function shouldIgnoreShortcutEvent(e: ShortcutKeyboardEventLike): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return true;
  }
  return isEditableShortcutTarget(e);
}

export function dispatchAppKeydown(
  e: ShortcutKeyboardEventLike,
  actions: AppShortcutActions
): boolean {
  return dispatchKeyboardShortcut(e, {
    onUndo: actions.onUndo,
    onRedo: actions.onRedo,
    bindings: {
      space: actions.onTogglePause,
      c: actions.onCaptureTrace,
      d: actions.onFindAndApplyDelay,
      m: actions.onAddLiveSource,
    },
  });
}
