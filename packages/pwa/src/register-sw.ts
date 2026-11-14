// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export interface ServiceWorkerContainerLike {
  register(
    scriptURL: string,
    options?: { scope?: string; type?: 'classic' | 'module' }
  ): Promise<unknown>;
}

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
    await swContainer.register(scriptUrl, { scope });
    return true;
  } catch {
    return false;
  }
}
