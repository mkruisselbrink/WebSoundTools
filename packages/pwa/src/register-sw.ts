// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export interface ServiceWorkerContainerLike {
  register(
    scriptURL: string,
    options?: { scope?: string; type?: 'classic' | 'module' }
  ): Promise<unknown>;
}

export {
  getWindowControlsOverlaySnapshot,
  observeWindowControlsOverlay,
  type MediaQueryListLike,
  type TitlebarAreaRectLike,
  type WcoEnvironmentLike,
  type WindowControlsOverlayLike,
  type WindowControlsOverlaySnapshot,
} from './wco.js';

export async function registerOfflineServiceWorker(
  swContainer: ServiceWorkerContainerLike | undefined = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : undefined,
  scriptUrl: string = '/sw.js',
  scope: string = '/'
): Promise<boolean> {
  if (!swContainer || typeof swContainer.register !== 'function') {
    return false;
  }
  try {
    const reg = (await swContainer.register(scriptUrl, { scope })) as
      | { update?: () => Promise<unknown> }
      | undefined;
    void reg?.update?.().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
