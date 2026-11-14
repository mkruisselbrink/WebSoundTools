// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Lit ReactiveController managing a stacked HiDPI WebGL2 + 2D Canvas stage:
 * - DPR-capped backing buffer synchronization via `ResizeObserver`
 * - `requestAnimationFrame` repaint coalescing
 * - `webglcontextlost` and `webglcontextrestored` lifecycle handling
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';

export interface DualCanvasDimensions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly deviceWidth: number;
  readonly deviceHeight: number;
}

export interface DualCanvasControllerOptions {
  readonly maxDevicePixelRatio?: number;
  readonly onPaint: (dimensions: DualCanvasDimensions) => void;
  readonly onResize?: (dimensions: DualCanvasDimensions) => void;
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
}

export class DualCanvasController implements ReactiveController {
  private readonly maxDpr: number;
  private stageEl: HTMLElement | null = null;
  private underlayEl: HTMLCanvasElement | null = null;
  private overlayEl: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private microtaskPending = false;
  private contextLost = false;

  private dims: DualCanvasDimensions = {
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    deviceWidth: 0,
    deviceHeight: 0,
  };

  private readonly handleContextLost = (ev: Event): void => {
    ev.preventDefault();
    this.contextLost = true;
    this.options.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.options.onContextRestored?.();
    this.requestRepaint();
  };

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly options: DualCanvasControllerOptions
  ) {
    this.maxDpr = options.maxDevicePixelRatio ?? 2;
    this.host.addController(this);
  }

  public get dimensions(): DualCanvasDimensions {
    return this.dims;
  }

  public get underlayCanvas(): HTMLCanvasElement | null {
    return this.underlayEl;
  }

  public get overlayCanvas(): HTMLCanvasElement | null {
    return this.overlayEl;
  }

  public get isContextLost(): boolean {
    return this.contextLost;
  }

  public hostConnected(): void {
    if (this.stageEl && !this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.observeStage(this.stageEl);
    }
  }

  public hostDisconnected(): void {
    this.cancelScheduledRepaint();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  public attach(
    stage: HTMLElement,
    underlayCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement
  ): void {
    this.detach();
    this.stageEl = stage;
    this.underlayEl = underlayCanvas;
    this.overlayEl = overlayCanvas;

    underlayCanvas.addEventListener?.('webglcontextlost', this.handleContextLost);
    underlayCanvas.addEventListener?.('webglcontextrestored', this.handleContextRestored);

    if (typeof ResizeObserver !== 'undefined') {
      this.observeStage(stage);
    }

    const rect = stage.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      this.syncSize(rect.width, rect.height);
    }
  }

  public detach(): void {
    this.cancelScheduledRepaint();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.underlayEl) {
      this.underlayEl.removeEventListener?.('webglcontextlost', this.handleContextLost);
      this.underlayEl.removeEventListener?.(
        'webglcontextrestored',
        this.handleContextRestored
      );
    }
    this.stageEl = null;
    this.underlayEl = null;
    this.overlayEl = null;
  }

  public syncSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const cssWidth = Math.max(1, Math.floor(width));
    const cssHeight = Math.max(1, Math.floor(height));
    const rawDpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    const dpr = Math.min(this.maxDpr, Math.max(1, rawDpr));
    const deviceWidth = Math.max(1, Math.round(cssWidth * dpr));
    const deviceHeight = Math.max(1, Math.round(cssHeight * dpr));

    const changed =
      this.dims.cssWidth !== cssWidth ||
      this.dims.cssHeight !== cssHeight ||
      this.dims.deviceWidth !== deviceWidth ||
      this.dims.deviceHeight !== deviceHeight;

    this.dims = {
      cssWidth,
      cssHeight,
      dpr,
      deviceWidth,
      deviceHeight,
    };

    if (
      this.underlayEl &&
      (this.underlayEl.width !== deviceWidth || this.underlayEl.height !== deviceHeight)
    ) {
      this.underlayEl.width = deviceWidth;
      this.underlayEl.height = deviceHeight;
    }
    if (
      this.overlayEl &&
      (this.overlayEl.width !== deviceWidth || this.overlayEl.height !== deviceHeight)
    ) {
      this.overlayEl.width = deviceWidth;
      this.overlayEl.height = deviceHeight;
    }

    if (changed) {
      this.options.onResize?.(this.dims);
    }
    this.requestRepaint();
  }

  public requestRepaint(): void {
    if (this.rafId !== null || this.microtaskPending) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.paintImmediate();
      });
    } else {
      this.microtaskPending = true;
      queueMicrotask(() => {
        this.microtaskPending = false;
        this.paintImmediate();
      });
    }
  }

  public paintImmediate(): void {
    if (this.dims.cssWidth <= 0 || this.dims.cssHeight <= 0) return;
    this.options.onPaint(this.dims);
  }

  private observeStage(stage: HTMLElement): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      this.syncSize(rect.width, rect.height);
    });
    this.resizeObserver.observe(stage);
  }

  private cancelScheduledRepaint(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.microtaskPending = false;
  }
}
