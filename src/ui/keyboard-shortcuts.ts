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

/**
 * Shadow-DOM-aware global keyboard shortcut dispatcher.
 */

export interface AppShortcutActions {
  readonly onCaptureTrace: () => void;
  readonly onFindAndApplyDelay: () => void;
  readonly onAddLiveSource?: () => void;
}

export interface ShortcutKeyboardEventLike {
  readonly code?: string;
  readonly key?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: unknown;
  readonly composedPath?: () => unknown[];
  readonly preventDefault?: () => void;
}

export function shouldIgnoreShortcutEvent(e: ShortcutKeyboardEventLike): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return true;
  }
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const rawTarget = (path[0] ?? e.target) as
    | { tagName?: string; isContentEditable?: boolean }
    | undefined;
  const tag = rawTarget?.tagName?.toUpperCase();
  if (
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    rawTarget?.isContentEditable
  ) {
    return true;
  }
  return false;
}

export function dispatchAppKeydown(
  e: ShortcutKeyboardEventLike,
  actions: AppShortcutActions
): boolean {
  if (shouldIgnoreShortcutEvent(e)) {
    return false;
  }
  if (e.code === 'Space' || e.key === 'c' || e.key === 'C') {
    e.preventDefault?.();
    actions.onCaptureTrace();
    return true;
  }
  if (e.key === 'd' || e.key === 'D') {
    e.preventDefault?.();
    actions.onFindAndApplyDelay();
    return true;
  }
  if ((e.key === 'm' || e.key === 'M') && actions.onAddLiveSource) {
    e.preventDefault?.();
    actions.onAddLiveSource();
    return true;
  }
  return false;
}
