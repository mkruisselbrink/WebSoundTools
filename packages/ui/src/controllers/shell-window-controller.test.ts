// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveControllerHost } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import { ShellWindowController } from './shell-window-controller.js';

describe('ShellWindowController', () => {
  it('tracks WCO visibility updates and cleans up subscriptions on disconnect', () => {
    let wcoCb: ((visible: boolean) => void) | undefined;
    const unsubSpy = vi.fn(() => {});
    const requestUpdate = vi.fn(() => {});
    const host: ReactiveControllerHost = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate,
      updateComplete: Promise.resolve(true),
    };

    const ctrl = new ShellWindowController(host, {
      observeWco: (cb) => {
        wcoCb = cb;
        return unsubSpy;
      },
    });

    ctrl.hostConnected();
    expect(ctrl.wcoVisible).toBe(false);

    wcoCb?.(true);
    expect(ctrl.wcoVisible).toBe(true);
    expect(requestUpdate).toHaveBeenCalledTimes(1);

    ctrl.hostDisconnected();
    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });
});
