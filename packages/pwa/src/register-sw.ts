// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export interface ServiceWorkerLike {
  readonly state?: string;
  postMessage?: (message: unknown) => void;
  addEventListener?: (type: string, listener: () => void) => void;
}

export interface ServiceWorkerRegistrationLike {
  readonly waiting?: ServiceWorkerLike | null;
  readonly installing?: ServiceWorkerLike | null;
  update?: () => Promise<unknown>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export interface ServiceWorkerContainerLike {
  readonly controller?: unknown;
  register(
    scriptURL: string,
    options?: { scope?: string; type?: 'classic' | 'module' }
  ): Promise<ServiceWorkerRegistrationLike | unknown>;
  addEventListener?: (
    type: string,
    listener: () => void,
    options?: { once?: boolean }
  ) => void;
}

export interface RegisterServiceWorkerOptions {
  readonly scriptUrl?: string;
  readonly scope?: string;
  readonly onUpdateWaiting?: (applyUpdate: () => void) => void;
}

export type ServiceWorkerUpdateObserver = (applyUpdate: () => void) => void;

const updateObservers = new Set<ServiceWorkerUpdateObserver>();
let stagedApplyUpdate: (() => void) | null = null;

function publishWaitingWorker(
  worker: ServiceWorkerLike,
  swContainer: ServiceWorkerContainerLike,
  localCallback?: (applyUpdate: () => void) => void
): void {
  const applyUpdate = () => {
    let reloaded = false;
    swContainer.addEventListener?.(
      'controllerchange',
      () => {
        if (reloaded) return;
        reloaded = true;
        if (typeof window !== 'undefined' && window.location) {
          window.location.reload();
        }
      },
      { once: true }
    );
    worker.postMessage?.({ type: 'SKIP_WAITING' });
  };

  stagedApplyUpdate = applyUpdate;
  localCallback?.(applyUpdate);
  for (const observer of updateObservers) {
    observer(applyUpdate);
  }
}

/**
 * Subscribes to staged Service Worker updates registered via `registerOfflineServiceWorker`.
 * Immediately invokes `listener` if an update is already waiting.
 */
export function observeServiceWorkerUpdate(
  listener: ServiceWorkerUpdateObserver
): () => void {
  updateObservers.add(listener);
  if (stagedApplyUpdate) {
    listener(stagedApplyUpdate);
  }
  return () => {
    updateObservers.delete(listener);
  };
}

/** Resets module-level staged update state (for unit tests). */
export function resetStagedServiceWorkerUpdateForTests(): void {
  stagedApplyUpdate = null;
  updateObservers.clear();
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
  scriptUrlOrOptions: string | RegisterServiceWorkerOptions = '/sw.js',
  scopeArg: string = '/'
): Promise<boolean> {
  if (!swContainer || typeof swContainer.register !== 'function') {
    return false;
  }

  const opts: RegisterServiceWorkerOptions =
    typeof scriptUrlOrOptions === 'string'
      ? { scriptUrl: scriptUrlOrOptions, scope: scopeArg }
      : scriptUrlOrOptions;
  const scriptUrl = opts.scriptUrl ?? '/sw.js';
  const scope = opts.scope ?? '/';

  try {
    const reg = (await swContainer.register(scriptUrl, { scope })) as
      | ServiceWorkerRegistrationLike
      | undefined;

    if (reg?.waiting && swContainer.controller) {
      publishWaitingWorker(reg.waiting, swContainer, opts.onUpdateWaiting);
    }

    reg?.addEventListener?.('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener?.('statechange', () => {
        if (installing.state === 'installed' && swContainer.controller) {
          publishWaitingWorker(installing, swContainer, opts.onUpdateWaiting);
        }
      });
    });

    void reg?.update?.().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
