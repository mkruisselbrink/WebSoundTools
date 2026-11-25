// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Application keyboard shortcut bindings for WebSpeakerSim.
 */

import {
  dispatchKeyboardShortcut,
  isEditableShortcutTarget,
  type ShortcutEventLike,
} from '@foh/ui';
import type { ViewportLayoutMode } from '../model/url-state.js';

export interface AppShortcutHandlers {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly save?: () => void;
  readonly addPointSource: () => void;
  readonly addSubArray: () => void;
  readonly addVirtualMic: () => void;
  readonly toggleGroundReflection: () => void;
  readonly setLayoutMode: (mode: ViewportLayoutMode) => void;
  readonly openSpeakerLibrary: () => void;
  readonly openHelp?: () => void;
  readonly onEscape: () => void;
}

export type KeyboardEventLike = ShortcutEventLike;

export function isEditableEventTarget(ev: KeyboardEventLike): boolean {
  return isEditableShortcutTarget(ev);
}

export function dispatchAppShortcut(
  ev: KeyboardEventLike,
  handlers: AppShortcutHandlers
): boolean {
  return dispatchKeyboardShortcut(ev, {
    onEscape: handlers.onEscape,
    onUndo: handlers.undo,
    onRedo: handlers.redo,
    onSave: handlers.save,
    bindings: {
      p: handlers.addPointSource,
      s: handlers.addSubArray,
      m: handlers.addVirtualMic,
      g: handlers.toggleGroundReflection,
      l: handlers.openSpeakerLibrary,
      '1': () => handlers.setLayoutMode('split'),
      '2': () => handlers.setLayoutMode('plan'),
      '3': () => handlers.setLayoutMode('section'),
      '?': handlers.openHelp,
    },
  });
}
