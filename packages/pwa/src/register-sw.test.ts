// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observeServiceWorkerUpdate,
  registerOfflineServiceWorker,
  resetStagedServiceWorkerUpdateForTests,
} from './register-sw.js';

describe('registerOfflineServiceWorker', () => {
  beforeEach(() => {
    resetStagedServiceWorkerUpdateForTests();
  });

  it('registers the Service Worker safely and handles unsupported or failing environments', async () => {
    const registerSpy = vi.fn().mockResolvedValue({});
    expect(await registerOfflineServiceWorker({ register: registerSpy }, '/sw.js')).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    expect(await registerOfflineServiceWorker(undefined)).toBe(false);
    const failingSpy = vi.fn().mockRejectedValue(new Error('SW blocked'));
    expect(await registerOfflineServiceWorker({ register: failingSpy })).toBe(false);
  });

  it('notifies observers when a staged Service Worker is waiting and posts SKIP_WAITING on apply', async () => {
    const postMessage = vi.fn();
    const addContainerListener = vi.fn();
    const registerSpy = vi.fn().mockResolvedValue({
      waiting: { state: 'installed', postMessage },
    });

    let applyFn: (() => void) | undefined;
    const unsub = observeServiceWorkerUpdate((apply) => {
      applyFn = apply;
    });

    await registerOfflineServiceWorker({
      controller: {},
      register: registerSpy,
      addEventListener: addContainerListener,
    });

    expect(applyFn).toBeTypeOf('function');
    applyFn?.();
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(addContainerListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
      { once: true }
    );
    unsub();
  });
});
