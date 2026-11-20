// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reactive Desktop PWA Window Controls Overlay (`window-controls-overlay`) observer.
 *
 * Zero-DOM-dependency structural interfaces keep `@foh/pwa/client` safe in Node and Web Workers
 * while tracking live titlebar geometry changes (`geometrychange` + `display-mode` media query).
 */

export interface TitlebarAreaRectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowControlsOverlayLike {
  readonly visible: boolean;
  getTitlebarAreaRect(): TitlebarAreaRectLike;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
}

export interface WcoEnvironmentLike {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
  readonly matchMedia?: (query: string) => MediaQueryListLike;
}

export interface WindowControlsOverlaySnapshot {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const INACTIVE_WCO_SNAPSHOT: WindowControlsOverlaySnapshot = {
  visible: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

function defaultWcoEnvironment(): WcoEnvironmentLike {
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { windowControlsOverlay?: WindowControlsOverlayLike })
      : undefined;
  const win =
    typeof window !== 'undefined'
      ? (window as unknown as { matchMedia?: (query: string) => MediaQueryListLike })
      : undefined;
  return {
    windowControlsOverlay: nav?.windowControlsOverlay,
    matchMedia: win?.matchMedia ? win.matchMedia.bind(win) : undefined,
  };
}

export function getWindowControlsOverlaySnapshot(
  env: WcoEnvironmentLike = defaultWcoEnvironment()
): WindowControlsOverlaySnapshot {
  const wco = env.windowControlsOverlay;
  if (wco) {
    if (!wco.visible) {
      return INACTIVE_WCO_SNAPSHOT;
    }
    const rect = wco.getTitlebarAreaRect();
    return {
      visible: true,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  const mql = env.matchMedia?.('(display-mode: window-controls-overlay)');
  if (mql?.matches) {
    return {
      visible: true,
      x: 0,
      y: 0,
      width: 0,
      height: 40,
    };
  }

  return INACTIVE_WCO_SNAPSHOT;
}

export function observeWindowControlsOverlay(
  onChange: (snapshot: WindowControlsOverlaySnapshot) => void,
  env: WcoEnvironmentLike = defaultWcoEnvironment()
): () => void {
  let prev = getWindowControlsOverlaySnapshot(env);
  onChange(prev);

  const handleUpdate = () => {
    const next = getWindowControlsOverlaySnapshot(env);
    if (
      next.visible === prev.visible &&
      next.x === prev.x &&
      next.y === prev.y &&
      next.width === prev.width &&
      next.height === prev.height
    ) {
      return;
    }
    prev = next;
    onChange(next);
  };

  const wco = env.windowControlsOverlay;
  const mql = env.matchMedia?.('(display-mode: window-controls-overlay)');

  wco?.addEventListener('geometrychange', handleUpdate);
  mql?.addEventListener?.('change', handleUpdate);

  return () => {
    wco?.removeEventListener('geometrychange', handleUpdate);
    mql?.removeEventListener?.('change', handleUpdate);
  };
}
