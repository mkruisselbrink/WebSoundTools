/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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
 * Chart plot metadata, coordinate transforms, and Audience SPL histogram computation (`src/charts/plot-types.ts`).
 */

import { CELL_MASK_AUDIENCE, type PlanGridResult } from '../physics/summation-solver.js';

export type SimPlotType = 'magnitude' | 'phase' | 'group-delay' | 'arrivals' | 'histogram';

export interface SimPlotMeta {
  readonly label: string;
  readonly xLog: boolean;
  readonly defaultXMin: number;
  readonly defaultXMax: number;
  readonly defaultYMin: number;
  readonly defaultYMax: number;
  readonly yStep: number;
  readonly yUnit: string;
}

export const SIM_PLOT_METADATA: Record<SimPlotType, SimPlotMeta> = {
  magnitude: {
    label: 'Magnitude (dB SPL)',
    xLog: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: 55,
    defaultYMax: 115,
    yStep: 10,
    yUnit: 'dB',
  },
  phase: {
    label: 'Phase (°)',
    xLog: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -180,
    defaultYMax: 180,
    yStep: 60,
    yUnit: '°',
  },
  'group-delay': {
    label: 'Group Delay (ms)',
    xLog: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -15,
    defaultYMax: 25,
    yStep: 5,
    yUnit: 'ms',
  },
  arrivals: {
    label: 'Impulse Arrivals',
    xLog: false,
    defaultXMin: 0,
    defaultXMax: 120,
    defaultYMin: 50,
    defaultYMax: 115,
    yStep: 10,
    yUnit: 'dB',
  },
  histogram: {
    label: 'Audience SPL Histogram',
    xLog: false,
    defaultXMin: 70,
    defaultXMax: 114,
    defaultYMin: 0,
    defaultYMax: 45,
    yStep: 10,
    yUnit: '%',
  },
};

export const ISO_LOG_GRID_FREQS: readonly number[] = [
  20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 800, 1000,
  2000, 3000, 4000, 5000, 6000, 8000, 10000, 20000,
];

export const ISO_MAJOR_LABEL_FREQS: ReadonlySet<number> = new Set([
  20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
]);

export function valueToNormX(val: number, xMin: number, xMax: number, isLog: boolean): number {
  if (isLog) {
    const safeVal = Math.max(1e-3, val);
    const safeMin = Math.max(1e-3, xMin);
    const safeMax = Math.max(safeMin * 1.01, xMax);
    return Math.log(safeVal / safeMin) / Math.log(safeMax / safeMin);
  }
  return (val - xMin) / Math.max(1e-6, xMax - xMin);
}

export function normXToValue(normX: number, xMin: number, xMax: number, isLog: boolean): number {
  const t = Math.max(0, Math.min(1, normX));
  if (isLog) {
    return xMin * Math.pow(xMax / xMin, t);
  }
  return xMin + t * (xMax - xMin);
}

export function valueToNormY(val: number, yMin: number, yMax: number): number {
  return (val - yMin) / Math.max(1e-6, yMax - yMin);
}

export function formatFrequencyLabel(freqHz: number): string {
  if (freqHz >= 1000) {
    const k = freqHz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${Math.round(freqHz)}`;
}

export interface SplHistogramBin {
  readonly binCenterDb: number;
  readonly binMinDb: number;
  readonly binMaxDb: number;
  readonly percentage: number;
}

export function computeAudienceSplHistogram(
  planGrid: PlanGridResult | null,
  minDb: number = 70,
  maxDb: number = 114,
  binWidthDb: number = 2
): SplHistogramBin[] {
  const binCount = Math.max(1, Math.round((maxDb - minDb) / binWidthDb));
  const counts = new Uint32Array(binCount);
  let total = 0;

  if (planGrid) {
    const { splDb, surfaceMask } = planGrid;
    for (let i = 0; i < splDb.length; i++) {
      if (surfaceMask[i] !== CELL_MASK_AUDIENCE || splDb[i] <= -110) continue;
      total++;
      const idx = Math.min(
        binCount - 1,
        Math.max(0, Math.floor((splDb[i] - minDb) / binWidthDb))
      );
      counts[idx]++;
    }
  }

  const out: SplHistogramBin[] = [];
  for (let b = 0; b < binCount; b++) {
    const bMin = minDb + b * binWidthDb;
    const bMax = bMin + binWidthDb;
    out.push({
      binCenterDb: bMin + binWidthDb * 0.5,
      binMinDb: bMin,
      binMaxDb: bMax,
      percentage: total > 0 ? (counts[b] / total) * 100 : 0,
    });
  }
  return out;
}
