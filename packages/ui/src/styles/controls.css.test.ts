// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { FOH_SELECT_CHEVRON_DATA_URI, fohControlsCss } from './controls.css.js';
import { fohPanelsCss } from './panels.css.js';

describe('fohControlsCss & fohPanelsCss select styling', () => {
  it('applies appearance: none with inset SVG chevron and preserved background-image on select controls', () => {
    expect(FOH_SELECT_CHEVRON_DATA_URI).toContain('data:image/svg+xml');
    const controlsCss = fohControlsCss.toString();
    expect(controlsCss).toContain('appearance: none');
    expect(controlsCss).toContain(FOH_SELECT_CHEVRON_DATA_URI);
    expect(controlsCss).toContain('padding-inline-end: 26px');

    const panelsCss = fohPanelsCss.toString();
    expect(panelsCss).toContain('background-color: var(--_foh-bg-input, #090d16)');
    expect(panelsCss).not.toMatch(/\.foh-mini-field select\s*\{[^}]*\bbackground:/);
    expect(panelsCss).not.toMatch(/\.foh-eq-card-top select\s*\{[^}]*\bbackground:/);
  });
});
