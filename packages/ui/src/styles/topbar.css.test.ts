// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fohTopbarCss } from './topbar.css.js';

describe('fohTopbarCss WCO, container queries & zero-jitter rules', () => {
  it('defines WCO env(titlebar-area-*) insets, @container topbar tiers, and @supports-gated popover anchoring', () => {
    const cssText = fohTopbarCss.toString();
    expect(cssText).toContain('env(titlebar-area-x, 0px)');
    expect(cssText).toContain('env(titlebar-area-width, 100%)');
    expect(cssText).toContain('env(titlebar-area-height, 0px)');
    expect(cssText).toContain('--foh-wco-left');
    expect(cssText).toContain('--foh-wco-right');
    expect(cssText).toContain('app-region: drag');
    expect(cssText).toContain('app-region: no-drag');
    expect(cssText).toContain('container: topbar / inline-size');
    expect(cssText).toContain('@container topbar (max-width: 1579px)');
    expect(cssText).toContain('@container topbar (max-width: 1379px)');
    expect(cssText).toContain('@container topbar (max-width: 1019px)');
    expect(cssText).toContain('@supports (position-area: block-end)');
    expect(cssText).toContain('env(safe-area-inset-bottom, 0px)');
    expect(cssText).toContain('font-size: 16px');
    expect(cssText).toContain('font-variant-numeric: tabular-nums');
    expect(cssText).toContain("aria-pressed='true'");
  });
});
