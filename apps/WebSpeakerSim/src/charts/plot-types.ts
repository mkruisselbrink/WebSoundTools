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
import type { VirtualMicResponse } from '../physics/virtual-mic-solver.js';

export type SimPlotType = 'magnitude' | 'phase' | 'group-delay' | 'arrivals' | 'histogram';

export type MagnitudeSpanMode = 'auto-30' | 'auto-60' | 'auto-80';

export interface ComputedPlotBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly yStep: number;
}

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

function chooseCleanStep(span: number, targetLines: number = 5): number {
  const raw = Math.max(1, span) / Math.max(2, targetLines);
  const steps = [1, 2, 5, 10, 15, 20, 25, 30, 50, 100];
  for (const s of steps) {
    if (s >= raw) return s;
  }
  return 100;
}

/**
 * Computes adaptive, non-clipping X/Y axis bounds for any `<wss-chart-panel>` mode
 * from the active Virtual Mic responses and Audience SPL grid.
 */
export function computeAdaptivePlotBounds(
  plotType: SimPlotType,
  responses: readonly VirtualMicResponse[],
  planGrid: PlanGridResult | null,
  magSpanMode: MagnitudeSpanMode = 'auto-60'
): ComputedPlotBounds {
  const meta = SIM_PLOT_METADATA[plotType];

  if (plotType === 'phase') {
    return {
      xMin: meta.defaultXMin,
      xMax: meta.defaultXMax,
      yMin: -180,
      yMax: 180,
      yStep: 60,
    };
  }

  if (plotType === 'magnitude') {
    let peakDb = Number.NEGATIVE_INFINITY;
    for (const r of responses) {
      for (let i = 0; i < r.magnitudeDbSpl.length; i++) {
        const v = r.magnitudeDbSpl[i];
        if (Number.isFinite(v) && v > -110 && v > peakDb) {
          peakDb = v;
        }
      }
    }
    if (!Number.isFinite(peakDb)) {
      peakDb = 105;
    }
    const span = magSpanMode === 'auto-30' ? 30 : magSpanMode === 'auto-80' ? 80 : 60;
    const yMax = Math.ceil((peakDb + 5) / 5) * 5;
    const yMin = yMax - span;
    const yStep = span <= 35 ? 5 : span <= 65 ? 10 : 20;
    return {
      xMin: meta.defaultXMin,
      xMax: meta.defaultXMax,
      yMin,
      yMax,
      yStep,
    };
  }

  if (plotType === 'group-delay') {
    let minGd = -8;
    let maxGd = 20;
    for (const r of responses) {
      let localPeak = -120;
      for (let i = 0; i < r.magnitudeDbSpl.length; i++) {
        if (r.magnitudeDbSpl[i] > localPeak) localPeak = r.magnitudeDbSpl[i];
      }
      const gateDb = localPeak - 50;
      for (let i = 0; i < r.groupDelayMs.length; i++) {
        if (r.magnitudeDbSpl[i] < gateDb) continue;
        const gd = r.groupDelayMs[i];
        if (!Number.isFinite(gd)) continue;
        const clamped = Math.max(-120, Math.min(160, gd));
        if (clamped < minGd) minGd = clamped;
        if (clamped > maxGd) maxGd = clamped;
      }
    }
    const pad = Math.max(2.5, (maxGd - minGd) * 0.12);
    const step = chooseCleanStep(maxGd - minGd + pad * 2, 5);
    const yMin = Math.floor((minGd - pad) / step) * step;
    const yMax = Math.max(yMin + step * 2, Math.ceil((maxGd + pad) / step) * step);
    return {
      xMin: meta.defaultXMin,
      xMax: meta.defaultXMax,
      yMin,
      yMax,
      yStep: step,
    };
  }

  if (plotType === 'arrivals') {
    let maxTimeMs = 0;
    let maxSpl = Number.NEGATIVE_INFINITY;
    let minSpl = Number.POSITIVE_INFINITY;
    for (const r of responses) {
      for (const a of r.arrivals) {
        if (Number.isFinite(a.arrivalTimeMs) && a.arrivalTimeMs > maxTimeMs) {
          maxTimeMs = a.arrivalTimeMs;
        }
        if (Number.isFinite(a.levelDbSpl) && a.levelDbSpl > -110) {
          if (a.levelDbSpl > maxSpl) maxSpl = a.levelDbSpl;
          if (a.levelDbSpl < minSpl) minSpl = a.levelDbSpl;
        }
      }
    }
    const xMax = Math.max(30, Math.ceil((maxTimeMs * 1.15 + 3) / 10) * 10);
    const hiSpl = Number.isFinite(maxSpl) ? maxSpl : 105;
    const yMax = Math.ceil((hiSpl + 6) / 10) * 10;
    const rawMin = Number.isFinite(minSpl) ? Math.floor((minSpl - 6) / 10) * 10 : yMax - 60;
    const yMin = Math.min(yMax - 50, Math.max(yMax - 90, rawMin));
    const yStep = yMax - yMin > 70 ? 20 : 10;
    return {
      xMin: 0,
      xMax,
      yMin,
      yMax,
      yStep,
    };
  }

  // 'histogram'
  if (planGrid && planGrid.stats.audienceSampleCount > 0) {
    const { minAudienceSplDb, maxAudienceSplDb, meanAudienceSplDb } = planGrid.stats;
    const lo = Math.min(minAudienceSplDb - 4, meanAudienceSplDb - 12);
    const hi = Math.max(maxAudienceSplDb + 4, meanAudienceSplDb + 12);
    const xMin = Math.floor(lo / 2) * 2;
    const xMax = Math.max(xMin + 16, Math.ceil(hi / 2) * 2);

    const bins = computeAudienceSplHistogram(planGrid, xMin, xMax, 2);
    let maxPct = 0;
    for (const b of bins) {
      if (b.percentage > maxPct) maxPct = b.percentage;
    }
    const yMax = Math.min(100, Math.max(30, Math.ceil((maxPct + 8) / 10) * 10));
    const yStep = yMax > 60 ? 20 : 10;
    return {
      xMin,
      xMax,
      yMin: 0,
      yMax,
      yStep,
    };
  }

  return {
    xMin: meta.defaultXMin,
    xMax: meta.defaultXMax,
    yMin: meta.defaultYMin,
    yMax: meta.defaultYMax,
    yStep: meta.yStep,
  };
}

