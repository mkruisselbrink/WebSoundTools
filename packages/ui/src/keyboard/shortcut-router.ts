// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shadow-DOM-aware global keyboard shortcut router supporting Escape, Undo/Redo,
 * and single-key application bindings while ignoring active form inputs.
 */

export interface ShortcutEventLike {
  readonly key?: string;
  readonly code?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target?: unknown;
  readonly composedPath?: () => unknown[];
  readonly preventDefault?: () => void;
}

export interface ShortcutRouterConfig {
  readonly onEscape?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly bindings?: Readonly<Record<string, (() => void) | undefined>>;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableShortcutTarget(ev: ShortcutEventLike): boolean {
  const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
  const candidates = path.length > 0 ? path : ev.target ? [ev.target] : [];

  for (const node of candidates) {
    if (node && typeof node === 'object') {
      const el = node as { tagName?: string; isContentEditable?: boolean };
      const tag = (el.tagName ?? '').toUpperCase();
      if (EDITABLE_TAGS.has(tag) || el.isContentEditable) {
        return true;
      }
      if (tag === 'BUTTON' && !ev.shiftKey && (ev.code === 'Space' || ev.key === ' ')) {
        return true;
      }
    }
  }
  return false;
}

export function dispatchKeyboardShortcut(
  ev: ShortcutEventLike,
  config: ShortcutRouterConfig
): boolean {
  if (ev.defaultPrevented) {
    return false;
  }

  const key = ev.key ?? '';
  const lower = key.toLowerCase();
  const mod = Boolean(ev.metaKey || ev.ctrlKey);
  const alt = Boolean(ev.altKey);
  const shift = Boolean(ev.shiftKey);

  if (key === 'Escape' && config.onEscape) {
    ev.preventDefault?.();
    config.onEscape();
    return true;
  }

  const inInput = isEditableShortcutTarget(ev);

  if (mod && !alt && !inInput) {
    if (lower === 'z' && shift && config.onRedo) {
      ev.preventDefault?.();
      config.onRedo();
      return true;
    }
    if (lower === 'z' && !shift && config.onUndo) {
      ev.preventDefault?.();
      config.onUndo();
      return true;
    }
    if (lower === 'y' && !shift && config.onRedo) {
      ev.preventDefault?.();
      config.onRedo();
      return true;
    }
  }

  if (mod || alt || inInput || !config.bindings) {
    return false;
  }

  if (ev.code === 'Space' || key === ' ') {
    const spaceHandler =
      shift && config.bindings['shift+space']
        ? config.bindings['shift+space']
        : config.bindings.space;
    if (spaceHandler) {
      ev.preventDefault?.();
      spaceHandler();
      return true;
    }
  }

  const handler = config.bindings[lower];
  if (handler) {
    ev.preventDefault?.();
    handler();
    return true;
  }

  return false;
}
