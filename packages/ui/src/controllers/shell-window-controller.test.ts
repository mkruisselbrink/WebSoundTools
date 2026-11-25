// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveControllerHost } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import {
  ShellWindowController,
  blurFocusedNumberInputOnWheel,
} from './shell-window-controller.js';

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

  it('tracks staged SW updates and flushes persistence before applying update', () => {
    let swCb: ((apply: () => void) => void) | undefined;
    const applySpy = vi.fn();
    const flushSpy = vi.fn();
    const requestUpdate = vi.fn(() => {});
    const host: ReactiveControllerHost = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate,
      updateComplete: Promise.resolve(true),
    };

    const ctrl = new ShellWindowController(host, {
      onFlushPersistence: flushSpy,
      observeSwUpdate: (cb) => {
        swCb = cb;
        return () => {};
      },
    });

    ctrl.hostConnected();
    expect(ctrl.swUpdateReady).toBe(false);

    swCb?.(applySpy);
    expect(ctrl.swUpdateReady).toBe(true);
    expect(requestUpdate).toHaveBeenCalledTimes(1);

    ctrl.applyServiceWorkerUpdate();
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
    ctrl.hostDisconnected();
  });

  it('blurs focused number inputs across composedPath on wheel without touching unfocused or text inputs', () => {
    const focusedNumberBlur = vi.fn();
    const focusedNumber = {
      tagName: 'INPUT',
      type: 'number',
      getRootNode: () => ({ activeElement: focusedNumber }),
      blur: focusedNumberBlur,
    };

    expect(
      blurFocusedNumberInputOnWheel({
        composedPath: () => [focusedNumber, { tagName: 'DIV' }],
      })
    ).toBe(true);
    expect(focusedNumberBlur).toHaveBeenCalledTimes(1);

    const unfocusedNumberBlur = vi.fn();
    const unfocusedNumber = {
      tagName: 'INPUT',
      type: 'number',
      getRootNode: () => ({ activeElement: null }),
      matches: () => false,
      blur: unfocusedNumberBlur,
    };
    expect(
      blurFocusedNumberInputOnWheel({
        composedPath: () => [unfocusedNumber],
      })
    ).toBe(false);
    expect(unfocusedNumberBlur).not.toHaveBeenCalled();

    const textBlur = vi.fn();
    const focusedText = {
      tagName: 'INPUT',
      type: 'text',
      getRootNode: () => ({ activeElement: focusedText }),
      blur: textBlur,
    };
    expect(
      blurFocusedNumberInputOnWheel({
        composedPath: () => [focusedText],
      })
    ).toBe(false);
    expect(textBlur).not.toHaveBeenCalled();
  });
});
