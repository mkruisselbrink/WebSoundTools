// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveController, ReactiveControllerHost } from 'lit';

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
}

/**
 * Reusable Lit `ReactiveController` managing top-level application shell `window` listeners
 * (`keydown`, `popstate`, responsive `matchMedia`, and PWA Window Controls Overlay state).
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
    }
    this.mql?.removeEventListener('change', this.handleMediaChange);
    this.mql = null;
    this.unsubWco?.();
    this.unsubWco = null;
  }
}
