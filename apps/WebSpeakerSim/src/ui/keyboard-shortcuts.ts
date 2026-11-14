/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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

/**
 * Shadow-DOM-aware global keyboard shortcut dispatcher (`src/ui/keyboard-shortcuts.ts`).
 */

import type { ViewportLayoutMode } from '../model/url-state.js';

export interface AppShortcutHandlers {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly addPointSource: () => void;
  readonly addSubArray: () => void;
  readonly addVirtualMic: () => void;
  readonly toggleGroundReflection: () => void;
  readonly setLayoutMode: (mode: ViewportLayoutMode) => void;
  readonly openSpeakerLibrary: () => void;
  readonly onEscape: () => void;
}

export interface KeyboardEventLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented?: boolean;
  composedPath?: () => EventTarget[];
  preventDefault: () => void;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableEventTarget(ev: KeyboardEventLike): boolean {
  const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
  for (const node of path) {
    if (node && typeof node === 'object' && 'tagName' in node) {
      const el = node as { tagName?: string; isContentEditable?: boolean };
      const tag = (el.tagName ?? '').toUpperCase();
      if (EDITABLE_TAGS.has(tag) || el.isContentEditable) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Dispatches an application keyboard shortcut if applicable.
 * Returns `true` when the keystroke was handled.
 */
export function dispatchAppShortcut(
  ev: KeyboardEventLike,
  handlers: AppShortcutHandlers
): boolean {
  if (ev.defaultPrevented) return false;

  const mod = ev.metaKey || ev.ctrlKey;
  const lower = ev.key.toLowerCase();

  if (ev.key === 'Escape') {
    ev.preventDefault();
    handlers.onEscape();
    return true;
  }

  const inInput = isEditableEventTarget(ev);

  // Undo / Redo (skip when typing inside text/number inputs so native text undo works)
  if (mod && !ev.altKey && !inInput) {
    if (lower === 'z' && ev.shiftKey) {
      ev.preventDefault();
      handlers.redo();
      return true;
    }
    if (lower === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      handlers.undo();
      return true;
    }
    if (lower === 'y' && !ev.shiftKey) {
      ev.preventDefault();
      handlers.redo();
      return true;
    }
  }

  if (mod || ev.altKey || inInput) {
    return false;
  }

  switch (lower) {
    case 'p':
      ev.preventDefault();
      handlers.addPointSource();
      return true;
    case 's':
      ev.preventDefault();
      handlers.addSubArray();
      return true;
    case 'm':
      ev.preventDefault();
      handlers.addVirtualMic();
      return true;
    case 'g':
      ev.preventDefault();
      handlers.toggleGroundReflection();
      return true;
    case 'l':
      ev.preventDefault();
      handlers.openSpeakerLibrary();
      return true;
    case '1':
      ev.preventDefault();
      handlers.setLayoutMode('split');
      return true;
    case '2':
      ev.preventDefault();
      handlers.setLayoutMode('plan');
      return true;
    case '3':
      ev.preventDefault();
      handlers.setLayoutMode('section');
      return true;
    default:
      return false;
  }
}

