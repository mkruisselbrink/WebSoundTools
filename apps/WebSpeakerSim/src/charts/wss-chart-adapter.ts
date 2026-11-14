// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure scene adapter mapping WebSpeakerSim Virtual Mic responses, Audience SPL grid,
 * and selected DSP Group EQ bands into `@foh/charts` `ChartScene` descriptors.
 */

import {
  computeAdaptiveGroupDelayBounds,
  computeAdaptiveMagnitudeBounds,
  formatFrequencyLabel,
  normXToValue,
  valueToNormX,
  valueToNormY,
  type ChartAxisBounds,
  type ChartScene,
  type CursorReadoutModel,
  type CursorReadoutRow,
  type HistogramBinBar,
  type MagnitudeSpanMode,
  type StemPoint,
  type TraceSeries,
} from '@foh/charts';
import type { DspGroup, VirtualMicInstance } from '../model/project-types.js';
import { CELL_MASK_AUDIENCE, type PlanGridResult } from '../physics/summation-solver.js';
import type { VirtualMicResponse } from '../physics/virtual-mic-solver.js';

export { formatFrequencyLabel, normXToValue, valueToNormX, valueToNormY, type MagnitudeSpanMode };

export type SimPlotType = 'magnitude' | 'phase' | 'group-delay' | 'arrivals' | 'histogram';

export type ComputedPlotBounds = Required<ChartAxisBounds>;

export interface SimPlotMeta {
  readonly label: string;
  readonly xLog: boolean;
  readonly xUnit: 'Hz' | 'ms' | 'dB';
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
    xUnit: 'Hz',
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
    xUnit: 'Hz',
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
    xUnit: 'Hz',
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
    xUnit: 'ms',
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
    xUnit: 'dB',
    defaultXMin: 70,
    defaultXMax: 114,
    defaultYMin: 0,
    defaultYMax: 45,
    yStep: 10,
    yUnit: '%',
  },
};

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
    return computeAdaptiveMagnitudeBounds(
      responses.map((r) => r.magnitudeDbSpl),
      magSpanMode,
      meta.defaultXMin,
      meta.defaultXMax,
      105
    );
  }

  if (plotType === 'group-delay') {
    return computeAdaptiveGroupDelayBounds(
      responses.map((r) => ({
        magnitudeDb: r.magnitudeDbSpl,
        groupDelayMs: r.groupDelayMs,
      })),
      meta.defaultXMin,
      meta.defaultXMax
    );
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
    return { xMin: 0, xMax, yMin, yMax, yStep };
  }

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
    return { xMin, xMax, yMin: 0, yMax, yStep };
  }

  return {
    xMin: meta.defaultXMin,
    xMax: meta.defaultXMax,
    yMin: meta.defaultYMin,
    yMax: meta.defaultYMax,
    yStep: meta.yStep,
  };
}

export function computeEqReferenceSplDb(
  responses: readonly VirtualMicResponse[],
  bounds: ChartAxisBounds
): number {
  let sum = 0;
  let count = 0;
  for (const r of responses) {
    if (Number.isFinite(r.broadbandSplADb) && r.broadbandSplADb > -80) {
      sum += r.broadbandSplADb;
      count++;
    }
  }
  const mid = 0.5 * (bounds.yMin + bounds.yMax);
  if (count === 0) return Math.round(mid * 2) / 2;
  const mean = sum / count;
  const clamped = Math.max(bounds.yMin + 8, Math.min(bounds.yMax - 8, mean));
  return Math.round(clamped * 2) / 2;
}

export interface WssChartSceneInput {
  readonly plotType: SimPlotType;
  readonly magSpanMode: MagnitudeSpanMode;
  readonly mics: readonly VirtualMicInstance[];
  readonly responses: readonly VirtualMicResponse[];
  readonly planGrid: PlanGridResult | null;
  readonly activeDspGroup: DspGroup | null;
}

export function buildWssChartScene(input: WssChartSceneInput): ChartScene {
  const { plotType, magSpanMode, mics, responses, planGrid, activeDspGroup } = input;
  const meta = SIM_PLOT_METADATA[plotType];
  const bounds = computeAdaptivePlotBounds(plotType, responses, planGrid, magSpanMode);
  const micColorMap = new Map(mics.map((m) => [m.id, m.color]));

  let traces: TraceSeries[] | undefined;
  let stems: StemPoint[] | undefined;
  let histogram: ChartScene['histogram'];

  if (plotType === 'magnitude' || plotType === 'phase' || plotType === 'group-delay') {
    traces = responses.map((resp) => ({
      id: resp.micId,
      color: micColorMap.get(resp.micId) ?? '#38bdf8',
      x: resp.frequenciesHz,
      y:
        plotType === 'magnitude'
          ? resp.magnitudeDbSpl
          : plotType === 'phase'
            ? resp.phaseDeg
            : resp.groupDelayMs,
      unwrapPhaseBreaks: plotType === 'phase',
      phaseBreakThresholdDeg: 165,
    }));
  } else if (plotType === 'arrivals') {
    stems = [];
    for (const resp of responses) {
      const baseColor = micColorMap.get(resp.micId) ?? '#38bdf8';
      for (const arr of resp.arrivals) {
        stems.push({
          x: arr.arrivalTimeMs,
          y: arr.levelDbSpl,
          color: arr.polaritySign < 0 ? '#ef4444' : baseColor,
          dashed: arr.isReflection,
          opacity: arr.isReflection ? 0.55 : 0.95,
          lineWidth: arr.isReflection ? 1.5 : 2.25,
        });
      }
    }
  } else {
    const rawBins = computeAudienceSplHistogram(planGrid, bounds.xMin, bounds.xMax, 2);
    const mean =
      planGrid && planGrid.stats.audienceSampleCount > 0
        ? planGrid.stats.meanAudienceSplDb
        : undefined;
    const bins: HistogramBinBar[] = rawBins.map((b) => ({
      binCenter: b.binCenterDb,
      binMin: b.binMinDb,
      binMax: b.binMaxDb,
      value: b.percentage,
      highlighted: mean !== undefined && Math.abs(b.binCenterDb - mean) <= 3.0,
    }));
    histogram = { bins, meanMarkerX: mean };
  }

  const eqOverlay =
    plotType === 'magnitude' && activeDspGroup && activeDspGroup.dsp.eqBands.length > 0
      ? {
          bands: activeDspGroup.dsp.eqBands,
          referenceZeroDbY: computeEqReferenceSplDb(responses, bounds),
        }
      : undefined;

  return {
    axis: {
      xScale: meta.xLog ? 'log' : 'linear',
      xUnit: meta.xUnit,
      yUnit: meta.yUnit,
      bounds,
    },
    traces,
    stems,
    histogram,
    eqOverlay,
  };
}

export function buildWssCursorReadoutModel(
  plotType: SimPlotType,
  domainX: number,
  mics: readonly VirtualMicInstance[],
  responses: readonly VirtualMicResponse[],
  planGrid: PlanGridResult | null,
  bounds: ChartAxisBounds
): CursorReadoutModel {
  const meta = SIM_PLOT_METADATA[plotType];
  const micColorMap = new Map(mics.map((m) => [m.id, m.color]));
  const rows: CursorReadoutRow[] = [];
  let headerText = '';

  if (meta.xLog) {
    headerText =
      domainX >= 1000 ? `${(domainX / 1000).toFixed(2)} kHz` : `${domainX.toFixed(1)} Hz`;
    for (const resp of responses) {
      if (resp.frequenciesHz.length === 0) continue;
      let bestIdx = 0;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < resp.frequenciesHz.length; i++) {
        const d = Math.abs(resp.frequenciesHz[i] - domainX);
        if (d < bestDiff) {
          bestDiff = d;
          bestIdx = i;
        }
      }
      const yVal =
        plotType === 'magnitude'
          ? resp.magnitudeDbSpl[bestIdx]
          : plotType === 'phase'
            ? resp.phaseDeg[bestIdx]
            : resp.groupDelayMs[bestIdx];
      const color = micColorMap.get(resp.micId) ?? '#38bdf8';
      rows.push({
        color,
        text: `${resp.micName}: ${yVal.toFixed(1)} ${meta.yUnit}`,
        highlightDomainY: yVal,
      });
    }
  } else if (plotType === 'arrivals') {
    headerText = `t = ${domainX.toFixed(1)} ms`;
  } else {
    const bins = computeAudienceSplHistogram(planGrid, bounds.xMin, bounds.xMax, 2);
    const hitBin = bins.find((b) => domainX >= b.binMinDb && domainX < b.binMaxDb);
    headerText = hitBin
      ? `${hitBin.binMinDb.toFixed(0)}–${hitBin.binMaxDb.toFixed(0)} dB · ${hitBin.percentage.toFixed(1)}%`
      : `${domainX.toFixed(1)} dB SPL`;
  }

  return {
    domainX,
    headerText,
    rows,
  };
}
