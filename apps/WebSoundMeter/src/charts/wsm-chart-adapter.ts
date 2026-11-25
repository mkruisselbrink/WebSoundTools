// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure scene adapter mapping WebSoundMeter `SourceData[]` and plot settings into
 * `@foh/charts` `ChartScene` and `CursorReadoutModel` descriptors.
 */

import { type OctaveBandData, aggregateFractionalOctaveBands } from '@foh/acoustics';
import {
  formatRelativeTimeLabel,
  type CalloutFlag,
  type ChartAxisBounds,
  type ChartScene,
  type CoherenceBlankingMode,
  type CursorReadoutModel,
  type FractionalOctaveBarSeries,
  type ThresholdGuide,
  type TraceSeries,
} from '@foh/charts';
import type { BiquadSpec } from '@foh/dsp';
import {
  MAX_VISIBLE_CALLOUT_FLAGS,
  type DetectedFeedbackTrack,
} from '../dsp/feedback-detector.js';
import {
  DEFAULT_SPL_ALERT_THRESHOLDS,
  type SplAlertThresholds,
  type SplHistoryTraceMode,
} from '../dsp/spl-history.js';
import type { SourceData } from '../sources/source-data.js';
import {
  PLOT_METADATA,
  buildSplSeriesVertices,
  buildTraceVertices,
  computeCursorReadout,
  type PlotType,
} from './plot-types.js';

export type RtaDisplayMode = 'line' | 'bars-3' | 'bars-6' | 'bars-12';

export interface WsmChartSceneInput {
  readonly plotType: PlotType;
  readonly bounds: ChartAxisBounds;
  readonly sources: readonly SourceData[];
  readonly eqBands: readonly BiquadSpec[] | null;
  readonly rtaMode: RtaDisplayMode;
  readonly showPeakHold: boolean;
  readonly coherenceMode?: CoherenceBlankingMode;
  readonly coherenceAlpha?: boolean;
  readonly coherenceThreshold: number;
  readonly showFeedbackWatch: boolean;
  readonly extraFeedbackTracks?: readonly DetectedFeedbackTrack[];
  readonly splTraceMode: SplHistoryTraceMode;
  readonly showSplThresholds: boolean;
  readonly splAlertThresholds: SplAlertThresholds;
}

const rtaOctaveBandsCache = new WeakMap<SourceData, Map<number, OctaveBandData>>();

function getCachedOctaveBands(src: SourceData, bandsPerOctave: 3 | 6 | 12): OctaveBandData {
  let byBpo = rtaOctaveBandsCache.get(src);
  if (!byBpo) {
    byBpo = new Map<number, OctaveBandData>();
    rtaOctaveBandsCache.set(src, byBpo);
  }
  let bands = byBpo.get(bandsPerOctave);
  if (!bands) {
    bands = aggregateFractionalOctaveBands(
      src.freqData.frequency,
      src.freqData.module,
      src.freqData.peakSquared,
      bandsPerOctave
    );
    byBpo.set(bandsPerOctave, bands);
  }
  return bands;
}

function buildFeedbackCalloutFlags(
  sources: readonly SourceData[],
  extraTracks?: readonly DetectedFeedbackTrack[]
): CalloutFlag[] {
  const allTracks: DetectedFeedbackTrack[] = [];
  for (const src of sources) {
    if (src.feedbackTracks && src.feedbackTracks.length > 0) {
      allTracks.push(...src.feedbackTracks);
    }
  }
  if (extraTracks && extraTracks.length > 0) {
    allTracks.push(...extraTracks);
  }
  if (allTracks.length === 0) return [];

  const stateRank = (s: DetectedFeedbackTrack['state']): number =>
    s === 'feedback' ? 3 : s === 'ringing' ? 2 : 1;

  allTracks.sort((a, b) => {
    const r = stateRank(b.state) - stateRank(a.state);
    return r !== 0 ? r : b.prominenceDb - a.prominenceDb;
  });

  return allTracks.slice(0, MAX_VISIBLE_CALLOUT_FLAGS).map((track) => {
    const freqText =
      track.frequencyHz >= 1000
        ? `${(track.frequencyHz / 1000).toFixed(2)} kHz`
        : `${Math.round(track.frequencyHz)} Hz`;
    const icon = track.state === 'feedback' ? '◆' : track.state === 'ringing' ? '▲' : '●';
    const accentColor =
      track.state === 'feedback'
        ? '#ef4444'
        : track.state === 'ringing'
          ? '#f59e0b'
          : '#94a3b8';
    const opacity =
      track.state === 'latched'
        ? Math.max(0.25, 0.85 * track.latchRemainingRatio)
        : 0.95;

    const culprit = track.culprit;
    const loopTag =
      track.loopLocation === 'in-mix'
        ? 'In Mix'
        : track.loopLocation === 'stage-only'
          ? 'Stage'
          : '';
    const line1 = culprit
      ? `${icon} ${freqText} (ISO ${track.isoBandLabel}) • ${culprit.channelName} (${culprit.confidencePct}%)`
      : `${icon} ${freqText} (ISO ${track.isoBandLabel})`;
    const tailLabel = culprit
      ? loopTag || track.slotName
      : loopTag
        ? `${track.slotName} · ${loopTag}`
        : track.slotName;

    return {
      id: track.id,
      x: track.frequencyHz,
      state: track.state,
      line1,
      line2: `+${track.prominenceDb.toFixed(1)}dB • Q≈${Math.round(track.estimatedQ)} • ${track.musicalNote.split(' ')[0]} • ${tailLabel}`,
      accentColor,
      badgeColor: track.slotColor,
      opacity,
    };
  });
}

function buildSplHistoryTraces(
  sources: readonly SourceData[],
  traceMode: SplHistoryTraceMode,
  bounds: ChartAxisBounds
): TraceSeries[] {
  const { xMin, xMax, yMin, yMax } = bounds;
  const traces: TraceSeries[] = [];

  for (const src of sources) {
    const hist = src.splHistory;
    if (!hist || hist.length === 0) continue;

    if (traceMode === 'multi-slot') {
      const v = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq15mDbA,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        1.0
      );
      traces.push({
        id: `${src.id}:leq15m`,
        color: src.color,
        ndcVertices: v.vertices,
        ndcVertexCount: v.vertexCount,
        lineWidth: 2.2,
      });
      continue;
    }

    if (traceMode === 'dba-dbc-leq1m') {
      const vC = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq1mDbC,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        0.75
      );
      traces.push({
        id: `${src.id}:leq1mc`,
        color: src.color,
        ndcVertices: vC.vertices,
        ndcVertexCount: vC.vertexCount,
        lineDash: [5, 3],
        force2d: true,
      });

      const vA = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq1mDbA,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        1.0
      );
      traces.push({
        id: `${src.id}:leq1ma`,
        color: src.color,
        ndcVertices: vA.vertices,
        ndcVertexCount: vA.vertexCount,
        lineWidth: 2.2,
      });
      continue;
    }

    const vFast = buildSplSeriesVertices(
      hist.timeSec,
      hist.shortTermDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      0.32
    );
    traces.push({
      id: `${src.id}:laf`,
      color: src.color,
      ndcVertices: vFast.vertices,
      ndcVertexCount: vFast.vertexCount,
      force2d: true,
    });

    if (traceMode === 'dba-fast-leq1m') {
      const vLeq1 = buildSplSeriesVertices(
        hist.timeSec,
        hist.leq1mDbA,
        hist.length,
        xMin,
        xMax,
        yMin,
        yMax,
        1.0
      );
      traces.push({
        id: `${src.id}:leq1m`,
        color: src.color,
        ndcVertices: vLeq1.vertices,
        ndcVertexCount: vLeq1.vertexCount,
        lineWidth: 2.2,
      });
      continue;
    }

    const vPeak = buildSplSeriesVertices(
      hist.timeSec,
      hist.peakDb,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      0.45
    );
    traces.push({
      id: `${src.id}:peak`,
      color: src.color,
      ndcVertices: vPeak.vertices,
      ndcVertexCount: vPeak.vertexCount,
      lineDash: [2, 3],
      force2d: true,
    });

    const vLeq1 = buildSplSeriesVertices(
      hist.timeSec,
      hist.leq1mDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      0.75
    );
    traces.push({
      id: `${src.id}:leq1m`,
      color: src.color,
      ndcVertices: vLeq1.vertices,
      ndcVertexCount: vLeq1.vertexCount,
      lineDash: [5, 3],
      force2d: true,
    });

    const vLeq15 = buildSplSeriesVertices(
      hist.timeSec,
      hist.leq15mDbA,
      hist.length,
      xMin,
      xMax,
      yMin,
      yMax,
      1.0
    );
    traces.push({
      id: `${src.id}:leq15m`,
      color: src.color,
      ndcVertices: vLeq15.vertices,
      ndcVertexCount: vLeq15.vertexCount,
      lineWidth: 2.2,
    });
  }

  return traces;
}

export function buildWsmChartScene(input: WsmChartSceneInput): ChartScene {
  const meta = PLOT_METADATA[input.plotType];
  const bounds: ChartAxisBounds = {
    xMin: input.bounds.xMin,
    xMax: input.bounds.xMax,
    yMin: input.bounds.yMin,
    yMax: input.bounds.yMax,
    yStep: input.bounds.yStep ?? meta.yStep,
  };
  const visibleSources = input.sources.filter((s) => s.visible && s.active);

  const xScale =
    input.plotType === 'spl-history'
      ? 'relative-time'
      : meta.isLogX
        ? 'log'
        : 'linear';

  let traces: TraceSeries[] | undefined;
  let rtaBars: FractionalOctaveBarSeries[] | undefined;
  let thresholdGuide: ThresholdGuide | undefined;

  if (input.plotType === 'spl-history') {
    const thresholds = input.splAlertThresholds ?? DEFAULT_SPL_ALERT_THRESHOLDS;
    if (input.showSplThresholds && thresholds.enabled) {
      thresholdGuide = {
        warningY: thresholds.warningDb,
        limitY: thresholds.limitDb,
        warningLabel: `▲ WARN ${thresholds.warningDb.toFixed(0)} dB`,
        limitLabel: `◆ LIMIT ${thresholds.limitDb.toFixed(0)} dB (${thresholds.metric})`,
      };
    }
    traces = buildSplHistoryTraces(visibleSources, input.splTraceMode, bounds);
  } else if (input.plotType === 'rta' && input.rtaMode !== 'line') {
    const bpo = input.rtaMode === 'bars-3' ? 3 : input.rtaMode === 'bars-6' ? 6 : 12;
    rtaBars = visibleSources.map((src) => {
      const bands = getCachedOctaveBands(src, bpo);
      const n = bands.centerFrequencies.length;
      const magnitudesDb = new Float32Array(n);
      const peaksDb = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        magnitudesDb[i] =
          bands.magnitudes[i] > 1e-10
            ? 20 * Math.log10(bands.magnitudes[i]) + src.gainOffsetDb
            : -140;
        peaksDb[i] =
          bands.peaks[i] > 1e-10
            ? 20 * Math.log10(bands.peaks[i]) + src.gainOffsetDb
            : -140;
      }
      return {
        id: src.id,
        color: src.color,
        centerFrequencies: bands.centerFrequencies,
        magnitudesDb,
        peaksDb,
        showPeakHold: input.showPeakHold,
      };
    });
  } else {
    const coherenceMode: CoherenceBlankingMode =
      input.coherenceMode ?? (input.coherenceAlpha === false ? 'off' : 'alpha');
    traces = [];
    for (const src of visibleSources) {
      const vBuf = buildTraceVertices(
        src,
        input.plotType,
        bounds.xMin,
        bounds.xMax,
        bounds.yMin,
        bounds.yMax,
        coherenceMode,
        input.coherenceThreshold
      );
      traces.push({
        id: src.id,
        color: src.color,
        ndcVertices: vBuf.vertices,
        ndcVertexCount: vBuf.vertexCount,
      });

      if (input.plotType === 'rta' && input.showPeakHold) {
        const fd = src.freqData;
        const bCount = Math.max(0, fd.length - 1);
        const fArr = fd.frequency.subarray(1);
        const pkArr = new Float32Array(bCount);
        for (let i = 1; i < fd.length; i++) {
          pkArr[i - 1] =
            fd.peakSquared[i] > 1e-20
              ? 10 * Math.log10(fd.peakSquared[i]) + src.gainOffsetDb
              : -140;
        }
        traces.push({
          id: `${src.id}:peak-hold`,
          color: src.color,
          x: fArr,
          y: pkArr,
          opacity: 0.45,
          lineWidth: 1.25,
          force2d: true,
        });
      }
    }
  }

  const calloutFlags =
    (input.plotType === 'rta' || input.plotType === 'magnitude') && input.showFeedbackWatch
      ? buildFeedbackCalloutFlags(visibleSources, input.extraFeedbackTracks)
      : undefined;

  const eqOverlay =
    input.plotType === 'magnitude' && input.eqBands && input.eqBands.length > 0
      ? { bands: input.eqBands, referenceZeroDbY: 0 }
      : undefined;

  return {
    axis: {
      xScale,
      xUnit: meta.xUnit,
      yUnit: meta.yUnit,
      bounds,
    },
    traces,
    rtaBars,
    thresholdGuide,
    calloutFlags,
    eqOverlay,
  };
}

export function buildWsmCursorReadoutModel(
  plotType: PlotType,
  domainX: number,
  sources: readonly SourceData[]
): CursorReadoutModel {
  const ro = computeCursorReadout(plotType, domainX, sources);

  if (ro.isFrequencyDomain) {
    const f = ro.frequencyHz!;
    const freqText = f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(0)} Hz`;
    return {
      domainX: f,
      headerText: `${freqText} · ${ro.periodMs!.toFixed(2)} ms`,
      subHeaderText: `λ ${ro.wavelengthMeters!.toFixed(2)} m (${ro.wavelengthFeet!.toFixed(1)} ft)`,
      rows: ro.sourceValues.map((sv) => ({
        color: sv.color,
        highlightDomainY: sv.yValue,
        text:
          sv.coherencePct !== undefined && plotType !== 'coherence'
            ? `${sv.name}: ${sv.formattedValue} (γ² ${sv.coherencePct}%)`
            : `${sv.name}: ${sv.formattedValue}`,
      })),
    };
  }

  return {
    domainX: ro.xValue,
    headerText:
      plotType === 'spl-history'
        ? `t = ${formatRelativeTimeLabel(ro.xValue)}`
        : `t = ${ro.xValue.toFixed(2)} ms`,
    rows: ro.sourceValues.map((sv) => ({
      color: sv.color,
      highlightDomainY: sv.yValue,
      text: `${sv.name}: ${sv.formattedValue}`,
    })),
  };
}
