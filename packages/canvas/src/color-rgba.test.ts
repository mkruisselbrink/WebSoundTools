// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  buildRgbaLutBytes,
  evaluateColorStopsRgb,
  parseCssColorToRgba,
} from './color-rgba.js';

describe('color-rgba', () => {
  it('parses hex and rgb/rgba strings into normalized [0..1] RGBA tuples', () => {
    expect(parseCssColorToRgba('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(parseCssColorToRgba('#0f0')).toEqual([0, 1, 0, 1]);
    const [r, g, b, a] = parseCssColorToRgba('#38bdf880');
    expect(r).toBeCloseTo(0x38 / 255, 4);
    expect(g).toBeCloseTo(0xbd / 255, 4);
    expect(b).toBeCloseTo(0xf8 / 255, 4);
    expect(a).toBeCloseTo(0x80 / 255, 3);

    expect(parseCssColorToRgba('rgba(255, 127.5, 0, 0.5)')).toEqual([1, 0.5, 0, 0.5]);
    expect(parseCssColorToRgba('invalid')).toEqual([0.22, 0.74, 0.97, 1.0]);
  });

  it('interpolates piecewise color stops and builds RGBA LUT byte buffers', () => {
    const stops = [
      { t: 0, r: 0, g: 0, b: 100 },
      { t: 1, r: 200, g: 100, b: 0 },
    ];
    expect(evaluateColorStopsRgb(stops, 0.5)).toEqual([100, 50, 50]);
    const lut = buildRgbaLutBytes(stops, 3);
    expect(Array.from(lut)).toEqual([
      0, 0, 100, 255,
      100, 50, 50, 255,
      200, 100, 0, 255,
    ]);
  });
});
