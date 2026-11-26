// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveControllerHost } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import {
  ShellWindowController,
  blurFocusedNumberInputOnWheel,
  type WcoTitlebarGeometry,
} from './shell-window-controller.js';

describe('ShellWindowController', () => {
  it('tracks WCO visibility and computes safe titlebar insets from geometry snapshots', () => {
    let wcoCb: ((state: boolean | WcoTitlebarGeometry) => void) | undefined;
    const prevWin = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      innerWidth: 1512,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const unsubSpy = vi.fn(() => {});
    const requestUpdate = vi.fn(() => {});
    const host: ReactiveControllerHost = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate,
      updateComplete: Promise.resolve(true),
    };

    try {
      const ctrl = new ShellWindowController(host, {
        observeWco: (cb) => {
          wcoCb = cb;
          return unsubSpy;
        },
      });

      ctrl.hostConnected();
      expect(ctrl.wcoVisible).toBe(false);

      wcoCb?.({ visible: true, x: 76, y: 0, width: 1318, height: 38 });
      expect(ctrl.wcoVisible).toBe(true);
      expect(ctrl.wcoInsets).toEqual({
        left: 76,
        right: 118,
        top: 0,
        height: 38,
      });
      expect(requestUpdate).toHaveBeenCalledTimes(1);

      wcoCb?.({ visible: false, x: 0, y: 0, width: 0, height: 0 });
      expect(ctrl.wcoVisible).toBe(false);
      expect(ctrl.wcoInsets).toEqual({ left: 0, right: 0, top: 0, height: 0 });

      ctrl.hostDisconnected();
      expect(unsubSpy).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as { window?: unknown }).window = prevWin;
    }
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
