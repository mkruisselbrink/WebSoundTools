// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import { DualCanvasController } from './dual-canvas-controller.js';

function createMockHost(): ReactiveControllerHost & { controllers: ReactiveController[] } {
  const controllers: ReactiveController[] = [];
  return {
    controllers,
    addController(c: ReactiveController) {
      controllers.push(c);
    },
    removeController() {},
    requestUpdate() {},
    updateComplete: Promise.resolve(true),
  };
}

function createMockCanvas() {
  const listeners = new Map<string, Set<(ev: Event) => void>>();
  return {
    width: 0,
    height: 0,
    addEventListener(type: string, fn: (ev: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    emit(type: string, ev: Partial<Event> = {}) {
      for (const fn of listeners.get(type) ?? []) {
        fn({ preventDefault: vi.fn(), ...ev } as Event);
      }
    },
  };
}

describe('DualCanvasController', () => {
  it('registers on host, caps DPR backing sizes, and coalesces microtask repaints', async () => {
    const host = createMockHost();
    const onPaint = vi.fn();
    const onResize = vi.fn();

    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { devicePixelRatio: 3.5 };

    try {
      const ctrl = new DualCanvasController(host, {
        maxDevicePixelRatio: 2,
        onPaint,
        onResize,
      });
      expect(host.controllers).toContain(ctrl);

      const glCanvas = createMockCanvas();
      const overlayCanvas = createMockCanvas();
      const stage = {
        getBoundingClientRect: () => ({ width: 500, height: 250 }),
      } as unknown as HTMLElement;

      ctrl.attach(
        stage,
        glCanvas as unknown as HTMLCanvasElement,
        overlayCanvas as unknown as HTMLCanvasElement
      );

      expect(glCanvas.width).toBe(1000);
      expect(glCanvas.height).toBe(500);
      expect(overlayCanvas.width).toBe(1000);
      expect(overlayCanvas.height).toBe(500);
      expect(onResize).toHaveBeenCalledTimes(1);

      // Multiple repaint requests coalesce into a single frame
      ctrl.requestRepaint();
      ctrl.requestRepaint();
      ctrl.requestRepaint();
      await Promise.resolve();
      expect(onPaint).toHaveBeenCalledTimes(1);
      expect(onPaint).toHaveBeenCalledWith({
        cssWidth: 500,
        cssHeight: 250,
        dpr: 2,
        deviceWidth: 1000,
        deviceHeight: 500,
      });
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  });

  it('tracks webglcontextlost and webglcontextrestored events cleanly', async () => {
    const host = createMockHost();
    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const onPaint = vi.fn();

    const ctrl = new DualCanvasController(host, {
      onPaint,
      onContextLost,
      onContextRestored,
    });

    const glCanvas = createMockCanvas();
    const overlayCanvas = createMockCanvas();
    const stage = {
      getBoundingClientRect: () => ({ width: 320, height: 180 }),
    } as unknown as HTMLElement;

    ctrl.attach(
      stage,
      glCanvas as unknown as HTMLCanvasElement,
      overlayCanvas as unknown as HTMLCanvasElement
    );
    await Promise.resolve();
    onPaint.mockClear();

    const preventDefault = vi.fn();
    glCanvas.emit('webglcontextlost', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(ctrl.isContextLost).toBe(true);
    expect(onContextLost).toHaveBeenCalledTimes(1);

    glCanvas.emit('webglcontextrestored');
    expect(ctrl.isContextLost).toBe(false);
    expect(onContextRestored).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(onPaint).toHaveBeenCalledTimes(1);

    ctrl.hostDisconnected();
    ctrl.detach();
  });
});
