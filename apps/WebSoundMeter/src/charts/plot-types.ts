// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * WebSoundMeter plot type metadata, SourceData-to-NDC trace builders,
 * and acoustic cursor readout calculator.
 */

import {
  buildTraceNdcVertices,
  computeCoherenceAlpha,
  formatFrequencyLabel,
  formatRelativeTimeLabel,
  normXToValue,
  valueToNormX,
  valueToNormY,
  type CoherenceBlankingMode,
  type TraceVertexBuffer,
} from '@foh/charts';
import { computeBinGroupDelayMs } from '@foh/dsp';
import { type SourceData, getEffectiveBinResponse } from '../sources/source-data.js';

export {
  computeCoherenceAlpha,
  formatFrequencyLabel,
  formatRelativeTimeLabel,
  normXToValue,
  valueToNormX,
  valueToNormY,
  type CoherenceBlankingMode,
  type TraceVertexBuffer,
};

export type PlotType =
  | 'magnitude'
  | 'phase'
  | 'rta'
  | 'coherence'
  | 'impulse'
  | 'etc'
  | 'step'
  | 'group-delay'
  | 'spl-history';

export interface PlotMetadata {
  readonly type: PlotType;
  readonly label: string;
  readonly xUnit: 'Hz' | 'ms' | 's';
  readonly yUnit: string;
  readonly isLogX: boolean;
  readonly defaultXMin: number;
  readonly defaultXMax: number;
  readonly defaultYMin: number;
  readonly defaultYMax: number;
  readonly yStep: number;
}

export const PLOT_METADATA: Record<PlotType, PlotMetadata> = {
  magnitude: {
    type: 'magnitude',
    label: 'Magnitude (TF)',
    xUnit: 'Hz',
    yUnit: 'dB',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -24,
    defaultYMax: 24,
    yStep: 6,
  },
  phase: {
    type: 'phase',
    label: 'Phase',
    xUnit: 'Hz',
    yUnit: 'deg',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -180,
    defaultYMax: 180,
    yStep: 45,
  },
  rta: {
    type: 'rta',
    label: 'Spectrum (RTA)',
    xUnit: 'Hz',
    yUnit: 'dBFS',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -90,
    defaultYMax: 0,
    yStep: 15,
  },
  coherence: {
    type: 'coherence',
    label: 'Coherence (γ²)',
    xUnit: 'Hz',
    yUnit: '%',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: 0,
    defaultYMax: 100,
    yStep: 20,
  },
  impulse: {
    type: 'impulse',
    label: 'Impulse (Linear)',
    xUnit: 'ms',
    yUnit: 'amp',
    isLogX: false,
    defaultXMin: -10,
    defaultXMax: 30,
    defaultYMin: -1.0,
    defaultYMax: 1.0,
    yStep: 0.25,
  },
  etc: {
    type: 'etc',
    label: 'Impulse (ETC dB)',
    xUnit: 'ms',
    yUnit: 'dB',
    isLogX: false,
    defaultXMin: -5,
    defaultXMax: 45,
    defaultYMin: -72,
    defaultYMax: 0,
    yStep: 12,
  },
  step: {
    type: 'step',
    label: 'Step Response',
    xUnit: 'ms',
    yUnit: 'amp',
    isLogX: false,
    defaultXMin: -10,
    defaultXMax: 30,
    defaultYMin: -1.2,
    defaultYMax: 1.2,
    yStep: 0.4,
  },
  'group-delay': {
    type: 'group-delay',
    label: 'Group Delay',
    xUnit: 'Hz',
    yUnit: 'ms',
    isLogX: true,
    defaultXMin: 20,
    defaultXMax: 20000,
    defaultYMin: -20,
    defaultYMax: 20,
    yStep: 5,
  },
  'spl-history': {
    type: 'spl-history',
    label: 'SPL / Leq History',
    xUnit: 's',
    yUnit: 'dB',
    isLogX: false,
    defaultXMin: -900,
    defaultXMax: 0,
    defaultYMin: 50,
    defaultYMax: 115,
    yStep: 10,
  },
};

export function buildSplSeriesVertices(
  timeSec: Float32Array,
  valuesDb: Float32Array,
  length: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  alpha: number = 1.0
): TraceVertexBuffer {
  return buildTraceNdcVertices({
    x: timeSec,
    y: valuesDb,
    length,
    bounds: { xMin, xMax, yMin, yMax },
    isLogX: false,
    alpha,
  });
}

export function buildTraceVertices(
  source: SourceData,
  plotType: PlotType,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  coherenceModeOrEnabled: boolean | CoherenceBlankingMode = 'alpha',
  coherenceThreshold: number = 0.35
): TraceVertexBuffer {
  const meta = PLOT_METADATA[plotType];

  if (plotType === 'spl-history') {
    const hist = source.splHistory;
    if (!hist || hist.length === 0) {
      return { vertices: new Float32Array(0), vertexCount: 0 };
    }
    return buildSplSeriesVertices(
      hist.timeSec,
      hist.leq15mDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      1.0
    );
  }

  if (plotType === 'impulse' || plotType === 'etc' || plotType === 'step') {
    const td = source.timeData;
    const n = td.length;
    const xArr = new Float32Array(n);
    const yArr = new Float32Array(n);
    const gainLinear =
      source.gainOffsetDb !== 0 ? Math.pow(10.0, source.gainOffsetDb / 20.0) : 1.0;
    const polSign = source.invertPolarity ? -1.0 : 1.0;
    const delayShift = source.delayOffsetMs;

    for (let i = 0; i < n; i++) {
      xArr[i] = td.timeMs[i] + delayShift;
      if (plotType === 'impulse') {
        yArr[i] = td.impulse[i] * gainLinear * polSign;
      } else if (plotType === 'etc') {
        const absAmp = Math.abs(td.impulse[i] * gainLinear);
        yArr[i] = absAmp > 1e-10 ? 20.0 * Math.log10(absAmp) : -120.0;
      } else {
        yArr[i] = td.stepResponse[i] * gainLinear * polSign;
      }
    }

    return buildTraceNdcVertices({
      x: xArr,
      y: yArr,
      length: n,
      bounds: { xMin, xMax, yMin, yMax },
      isLogX: false,
      alpha: 1.0,
    });
  }

  const fd = source.freqData;
  const bCount = Math.max(0, fd.length - 1);
  if (bCount === 0) {
    return { vertices: new Float32Array(0), vertexCount: 0 };
  }

  const xArr = new Float32Array(bCount);
  const yArr = new Float32Array(bCount);
  const alphaArr = new Float32Array(bCount);
  const resolvedCohMode: CoherenceBlankingMode =
    typeof coherenceModeOrEnabled === 'boolean'
      ? coherenceModeOrEnabled
        ? 'alpha'
        : 'off'
      : coherenceModeOrEnabled;
  const effectiveCohMode: CoherenceBlankingMode =
    plotType === 'magnitude' || plotType === 'phase' || plotType === 'group-delay'
      ? resolvedCohMode
      : 'off';

  for (let i = 1; i < fd.length; i++) {
    const k = i - 1;
    const bin = getEffectiveBinResponse(source, i);
    const f = bin.frequency;
    xArr[k] = f;
    alphaArr[k] = computeCoherenceAlpha(bin.coherence, coherenceThreshold, effectiveCohMode);

    if (plotType === 'magnitude') {
      yArr[k] = bin.magnitude > 1e-10 ? 20.0 * Math.log10(bin.magnitude) : -120.0;
    } else if (plotType === 'rta') {
      yArr[k] = bin.module > 1e-10 ? 20.0 * Math.log10(bin.module) : -140.0;
    } else if (plotType === 'coherence') {
      yArr[k] = bin.coherence * 100.0;
    } else if (plotType === 'phase') {
      yArr[k] = (Math.atan2(bin.phaseIm, bin.phaseRe) * 180.0) / Math.PI;
    } else if (plotType === 'group-delay') {
      const prevBin = getEffectiveBinResponse(source, i - 1);
      const df = f - prevBin.frequency;
      yArr[k] =
        df > 0
          ? computeBinGroupDelayMs(
              df,
              bin.phaseRe,
              bin.phaseIm,
              prevBin.phaseRe,
              prevBin.phaseIm
            )
          : 0;
    }
  }

  return buildTraceNdcVertices({
    x: xArr,
    y: yArr,
    length: bCount,
    bounds: { xMin, xMax, yMin, yMax },
    isLogX: meta.isLogX,
    alpha: alphaArr,
    unwrapPhaseBreaks: plotType === 'phase',
    phaseBreakThresholdDeg: 170.0,
  });
}

export interface CursorAcousticReadout {
  readonly isFrequencyDomain: boolean;
  readonly xValue: number;
  readonly frequencyHz?: number;
  readonly periodMs?: number;
  readonly wavelengthMeters?: number;
  readonly wavelengthFeet?: number;
  readonly sourceValues: Array<{
    readonly sourceId: string;
    readonly name: string;
    readonly color: string;
    readonly formattedValue: string;
    readonly yValue?: number;
    readonly coherencePct?: number;
  }>;
}

export function computeCursorReadout(
  plotType: PlotType,
  xValue: number,
  sources: readonly SourceData[]
): CursorAcousticReadout {
  const meta = PLOT_METADATA[plotType];
  const visibleSources = sources.filter((s) => s.visible && s.active);

  if (!meta.isLogX) {
    if (plotType === 'spl-history') {
      const sourceValues = visibleSources
        .filter((src) => src.splHistory && src.splHistory.length > 0)
        .map((src) => {
          const hist = src.splHistory!;
          const n = hist.length;
          let lo = 0;
          let hi = Math.max(0, n - 1);
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (hist.timeSec[mid] < xValue) lo = mid + 1;
            else hi = mid;
          }
          let bestIdx = lo;
          if (
            lo > 0 &&
            Math.abs(hist.timeSec[lo - 1] - xValue) <= Math.abs(hist.timeSec[lo] - xValue)
          ) {
            bestIdx = lo - 1;
          }
          const laeq15 = hist.leq15mDbA[bestIdx];
          const laeq1 = hist.leq1mDbA[bestIdx];
          const laf = hist.shortTermDbA[bestIdx];
          const pk = hist.peakDb[bestIdx];
          return {
            sourceId: src.id,
            name: src.name,
            color: src.color,
            yValue: laeq15,
            formattedValue: `LAeq15: ${laeq15.toFixed(1)} | LAeq1: ${laeq1.toFixed(1)} | LAF: ${laf.toFixed(1)} | Pk: ${pk.toFixed(1)} dB`,
          };
        });

      return { isFrequencyDomain: false, xValue, sourceValues };
    }

    const sourceValues = visibleSources.map((src) => {
      const td = src.timeData;
      const n = td.length;
      const targetTimeMs = xValue - src.delayOffsetMs;
      let lo = 0;
      let hi = Math.max(0, n - 1);
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (td.timeMs[mid] < targetTimeMs) lo = mid + 1;
        else hi = mid;
      }
      let bestIdx = lo;
      if (
        lo > 0 &&
        Math.abs(td.timeMs[lo - 1] - targetTimeMs) <= Math.abs(td.timeMs[lo] - targetTimeMs)
      ) {
        bestIdx = lo - 1;
      }
      const amp = td.impulse[bestIdx];
      let yValue = amp;
      let formattedValue = '';
      if (plotType === 'etc') {
        yValue = Math.abs(amp) > 1e-10 ? 20 * Math.log10(Math.abs(amp)) : -120;
        formattedValue = `${yValue.toFixed(1)} dB`;
      } else if (plotType === 'step') {
        yValue = td.stepResponse[bestIdx];
        formattedValue = `${yValue.toFixed(3)}`;
      } else {
        formattedValue = `${amp.toFixed(3)}`;
      }
      return {
        sourceId: src.id,
        name: src.name,
        color: src.color,
        yValue,
        formattedValue,
      };
    });

    return { isFrequencyDomain: false, xValue, sourceValues };
  }

  const freqHz = Math.max(1, xValue);
  const periodMs = 1000.0 / freqHz;
  const wavelengthMeters = 343.0 / freqHz;
  const wavelengthFeet = 1125.33 / freqHz;

  const sourceValues = visibleSources.map((src) => {
    const fd = src.freqData;
    const bCount = fd.length;
    const df = bCount > 1 ? fd.frequency[1] - fd.frequency[0] : 1;
    const idx = Math.max(1, Math.min(bCount - 1, Math.round(freqHz / Math.max(1e-6, df))));
    const bin = getEffectiveBinResponse(src, idx);
    const cohPct = Math.round(bin.coherence * 100);

    let yValue = 0;
    let formattedValue = '';
    if (plotType === 'magnitude') {
      yValue = bin.magnitude > 1e-10 ? 20 * Math.log10(bin.magnitude) : -120;
      formattedValue = `${yValue >= 0 ? '+' : ''}${yValue.toFixed(1)} dB`;
    } else if (plotType === 'rta') {
      yValue = bin.module > 1e-10 ? 20 * Math.log10(bin.module) : -140;
      formattedValue = `${yValue.toFixed(1)} dBFS`;
    } else if (plotType === 'phase') {
      yValue = (Math.atan2(bin.phaseIm, bin.phaseRe) * 180) / Math.PI;
      formattedValue = `${yValue >= 0 ? '+' : ''}${yValue.toFixed(0)}°`;
    } else if (plotType === 'coherence') {
      yValue = cohPct;
      formattedValue = `${cohPct}%`;
    } else if (plotType === 'group-delay') {
      const prevBin = getEffectiveBinResponse(src, Math.max(1, idx - 1));
      const stepF = Math.max(1e-3, bin.frequency - prevBin.frequency);
      yValue = computeBinGroupDelayMs(
        stepF,
        bin.phaseRe,
        bin.phaseIm,
        prevBin.phaseRe,
        prevBin.phaseIm
      );
      formattedValue = `${yValue.toFixed(2)} ms`;
    }

    return {
      sourceId: src.id,
      name: src.name,
      color: src.color,
      yValue,
      formattedValue,
      coherencePct: cohPct,
    };
  });

  return {
    isFrequencyDomain: true,
    xValue: freqHz,
    frequencyHz: freqHz,
    periodMs,
    wavelengthMeters,
    wavelengthFeet,
    sourceValues,
  };
}
