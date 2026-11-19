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
  readonly onAddEqSource?: () => void;
  readonly onAddUnionSource?: () => void;
  readonly onResetAveraging?: () => void;
  readonly onSelectLayoutCount?: (count: 1 | 2 | 3) => void;
  readonly onOpenHelp?: () => void;
  readonly onEscape?: () => void;
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
    onEscape: actions.onEscape,
    bindings: {
      space: actions.onTogglePause,
      c: actions.onCaptureTrace,
      d: actions.onFindAndApplyDelay,
      m: actions.onAddLiveSource,
      e: actions.onAddEqSource,
      u: actions.onAddUnionSource,
      r: actions.onResetAveraging,
      '1': actions.onSelectLayoutCount ? () => actions.onSelectLayoutCount?.(1) : undefined,
      '2': actions.onSelectLayoutCount ? () => actions.onSelectLayoutCount?.(2) : undefined,
      '3': actions.onSelectLayoutCount ? () => actions.onSelectLayoutCount?.(3) : undefined,
      '?': actions.onOpenHelp,
    },
  });
}
