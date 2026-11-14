/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  ChartAxisBounds,
  computeDraggedEqBand,
  computeZoomedYRange,
  findHitEqBandIndex,
} from '../../src/charts/chart-interaction.js';
import { valueToNormX, valueToNormY } from '../../src/charts/plot-types.js';
import { BiquadSpec } from '@foh/dsp';

const defaultBounds: ChartAxisBounds = {
  xMin: 20,
  xMax: 20000,
  yMin: -24,
  yMax: 24,
};

describe('chart-interaction', () => {
  it('computes symmetric zoomed Y ranges around the current midpoint', () => {
    const zoomedIn = computeZoomedYRange(-24, 24, 0.5);
    expect(zoomedIn).toEqual({ yMin: -12, yMax: 12 });

    const zoomedOut = computeZoomedYRange(-12, 12, 2.0);
    expect(zoomedOut).toEqual({ yMin: -24, yMax: 24 });
  });

  it('hit-tests enabled EQ band handles within pixel radius and skips disabled bands', () => {
    const plotW = 800;
    const plotH = 400;
    const bands: BiquadSpec[] = [
      { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
      { type: 'peaking', frequency: 1000, q: 2.0, gainDb: 6, enabled: true },
    ];

    const b0x = valueToNormX(35, defaultBounds.xMin, defaultBounds.xMax, true) * plotW;
    const b0y = (1 - valueToNormY(0, defaultBounds.yMin, defaultBounds.yMax)) * plotH;
    // Band 0 is disabled so clicking right on it returns null
    expect(findHitEqBandIndex(b0x, b0y, plotW, plotH, bands, defaultBounds)).toBeNull();

    const b1x = valueToNormX(1000, defaultBounds.xMin, defaultBounds.xMax, true) * plotW;
    const b1y = (1 - valueToNormY(6, defaultBounds.yMin, defaultBounds.yMax)) * plotH;
    expect(findHitEqBandIndex(b1x + 4, b1y - 4, plotW, plotH, bands, defaultBounds)).toBe(1);
    expect(findHitEqBandIndex(b1x + 50, b1y, plotW, plotH, bands, defaultBounds)).toBeNull();
  });

  it('converts dragged pixel coordinates to clamped EQ frequency and 0.5 dB quantized gain', () => {
    const plotW = 800;
    const plotH = 400;
    const midX = valueToNormX(1000, defaultBounds.xMin, defaultBounds.xMax, true) * plotW;
    const topQuarterY = 0.25 * plotH; // +12 dB on [-24, +24]

    const dragged = computeDraggedEqBand(midX, topQuarterY, plotW, plotH, defaultBounds);
    expect(dragged.frequency).toBeCloseTo(1000, -1);
    expect(dragged.gainDb).toBe(12);

    // Extreme Y drag is clamped to [-18, +18] dB
    const clampedTop = computeDraggedEqBand(midX, -100, plotW, plotH, defaultBounds);
    expect(clampedTop.gainDb).toBe(18);
    const clampedBottom = computeDraggedEqBand(midX, 9999, plotW, plotH, defaultBounds);
    expect(clampedBottom.gainDb).toBe(-18);
  });
});

