// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveController, ReactiveControllerHost } from 'lit';

interface NumberInputCandidate {
  readonly tagName?: string;
  readonly type?: string;
  readonly matches?: (selector: string) => boolean;
  readonly getRootNode?: () => { readonly activeElement?: unknown };
  readonly ownerDocument?: { readonly activeElement?: unknown };
  blur?: () => void;
}

/**
 * Blurs a focused `<input type="number">` when a `wheel` gesture targets it so
 * Chromium/Blink does not step the numeric value (which is inverted under macOS
 * Natural Scrolling and hijacks scrollable inspector panes), while keeping the
 * listener `{ capture: true, passive: true }` so container scrolling stays smooth.
 */
export function blurFocusedNumberInputOnWheel(ev: {
  readonly target?: unknown;
  readonly composedPath?: () => readonly unknown[];
}): boolean {
  const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [ev.target];
  for (const entry of path) {
    if (!entry || typeof entry !== 'object') continue;
    const el = entry as NumberInputCandidate;
    if (el.tagName?.toUpperCase() !== 'INPUT' || el.type !== 'number') continue;
    const rootActive = el.getRootNode?.()?.activeElement ?? el.ownerDocument?.activeElement;
    const isFocused =
      rootActive === el || (typeof el.matches === 'function' && el.matches(':focus'));
    if (isFocused && typeof el.blur === 'function') {
      el.blur();
      return true;
    }
    return false;
  }
  return false;
}

export interface ShellWindowControllerOptions {
  /** Global `keydown` handler attached on `window` while connected. */
  readonly onKeyDown?: (ev: KeyboardEvent) => void;
  /** Browser Back/Forward `popstate` handler attached on `window` while connected. */
  readonly onPopState?: (ev: PopStateEvent) => void;
  /** Optional responsive viewport media query (e.g. `'(max-width: 679px)'`). */
  readonly mediaQuery?: string;
  /** Invoked on connect and whenever `mediaQuery` match state changes. */
  readonly onMediaQueryChange?: (matches: boolean) => void;
  /**
   * Optional Window Controls Overlay observer factory (e.g. `observeWindowControlsOverlay`
   * from `@foh/pwa/client`), keeping `@foh/ui` decoupled from `@foh/pwa`.
   */
  readonly observeWco?: (onChange: (visible: boolean) => void) => () => void;
  /**
   * Blurs focused `<input type="number">` elements on `wheel` capture so scrolling
   * over an inspector field scrolls the sidebar instead of stepping live parameters.
   * Enabled (`true`) by default.
   */
  readonly disableNumberInputWheel?: boolean;
}

const WHEEL_CAPTURE_OPTIONS: AddEventListenerOptions = {
  capture: true,
  passive: true,
};

/**
 * Reusable Lit `ReactiveController` managing top-level application shell `window` listeners
 * (`keydown`, `popstate`, passive `<input type="number">` wheel guard, responsive `matchMedia`,
 * and PWA Window Controls Overlay state).
 */
export class ShellWindowController implements ReactiveController {
  public wcoVisible = false;
  public mediaMatches = false;

  private readonly host: ReactiveControllerHost;
  private readonly options: ShellWindowControllerOptions;
  private mql: MediaQueryList | null = null;
  private unsubWco: (() => void) | null = null;

  private readonly handleMediaChange = (ev: MediaQueryListEvent): void => {
    this.mediaMatches = ev.matches;
    this.options.onMediaQueryChange?.(ev.matches);
    this.host.requestUpdate();
  };

  private readonly handleWindowWheel = (ev: WheelEvent): void => {
    blurFocusedNumberInputOnWheel(ev);
  };

  constructor(host: ReactiveControllerHost, options: ShellWindowControllerOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  public hostConnected(): void {
    if (typeof window !== 'undefined') {
      if (this.options.onKeyDown) {
        window.addEventListener('keydown', this.options.onKeyDown);
      }
      if (this.options.onPopState) {
        window.addEventListener('popstate', this.options.onPopState);
      }
      if (this.options.disableNumberInputWheel !== false) {
        window.addEventListener('wheel', this.handleWindowWheel, WHEEL_CAPTURE_OPTIONS);
      }
      if (this.options.mediaQuery && typeof window.matchMedia === 'function') {
        this.mql = window.matchMedia(this.options.mediaQuery);
        this.mediaMatches = this.mql.matches;
        this.options.onMediaQueryChange?.(this.mediaMatches);
        this.mql.addEventListener('change', this.handleMediaChange);
      }
    }

    if (this.options.observeWco) {
      this.unsubWco = this.options.observeWco((visible) => {
        if (this.wcoVisible !== visible) {
          this.wcoVisible = visible;
          this.host.requestUpdate();
        }
      });
    }
  }

  public hostDisconnected(): void {
    if (typeof window !== 'undefined') {
      if (this.options.onKeyDown) {
        window.removeEventListener('keydown', this.options.onKeyDown);
      }
      if (this.options.onPopState) {
        window.removeEventListener('popstate', this.options.onPopState);
      }
      if (this.options.disableNumberInputWheel !== false) {
        window.removeEventListener('wheel', this.handleWindowWheel, true);
      }
    }
    this.mql?.removeEventListener('change', this.handleMediaChange);
    this.mql = null;
    this.unsubWco?.();
    this.unsubWco = null;
  }
}
