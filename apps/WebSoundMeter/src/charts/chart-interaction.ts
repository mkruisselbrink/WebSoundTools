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

/**
 * Pure chart coordinate math, Y-axis zoom calculations, and interactive EQ handle hit-testing.
 */

import { BiquadSpec } from '../dsp/biquad.js';
import { normXToValue, valueToNormX, valueToNormY } from './plot-types.js';

export interface ChartAxisBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export function computeZoomedYRange(
  yMin: number,
  yMax: number,
  factor: number
): { yMin: number; yMax: number } {
  const center = 0.5 * (yMin + yMax);
  const halfSpan = Math.max(1, 0.5 * (yMax - yMin) * factor);
  return {
    yMin: Math.round((center - halfSpan) * 10) / 10,
    yMax: Math.round((center + halfSpan) * 10) / 10,
  };
}

export function findHitEqBandIndex(
  mouseX: number,
  mouseY: number,
  plotW: number,
  plotH: number,
  bands: readonly BiquadSpec[],
  bounds: ChartAxisBounds,
  hitRadiusPx = 12
): number | null {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.enabled === false) continue;
    const bx = valueToNormX(b.frequency, bounds.xMin, bounds.xMax, true) * plotW;
    const by = (1.0 - valueToNormY(b.gainDb ?? 0, bounds.yMin, bounds.yMax)) * plotH;
    if (Math.hypot(mouseX - bx, mouseY - by) <= hitRadiusPx) {
      return i;
    }
  }
  return null;
}

export function computeDraggedEqBand(
  relX: number,
  relY: number,
  plotW: number,
  plotH: number,
  bounds: ChartAxisBounds
): { frequency: number; gainDb: number } {
  const normX = Math.max(0.01, Math.min(0.99, relX / plotW));
  const normY = Math.max(0.0, Math.min(1.0, 1.0 - relY / plotH));
  const frequency = Math.round(normXToValue(normX, bounds.xMin, bounds.xMax, true));
  const gainDb =
    Math.round(
      Math.max(-18, Math.min(18, bounds.yMin + normY * (bounds.yMax - bounds.yMin))) * 2
    ) / 2;
  return { frequency, gainDb };
}

