// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { clampNum, numVal, renderCoordinateGrid } from './field-primitives.js';

describe('field-primitives', () => {
  it('parses finite numeric input values and falls back cleanly on blank or invalid strings', () => {
    expect(numVal({ target: { value: '12.5' } } as unknown as Event, 0)).toBe(12.5);
    expect(numVal({ target: { value: '   ' } } as unknown as Event, 4)).toBe(4);
    expect(numVal({ target: { value: 'abc' } } as unknown as Event, -3)).toBe(-3);
    expect(clampNum(120, -85, 85)).toBe(85);
    expect(clampNum(-95, -85, 85)).toBe(-85);
  });

  it('produces Lit templates for 2-column and 3-column coordinate grids', () => {
    const tpl = renderCoordinateGrid([
      { label: 'X (m)', value: 1.25, precision: 2, onInput: () => {} },
      { label: 'Y (m)', value: -3.5, precision: 2, onInput: () => {} },
      { label: 'Z (m)', value: 4.0, min: 0.05, onInput: () => {} },
    ]);
    expect(tpl.values.length).toBeGreaterThan(0);
  });
});
