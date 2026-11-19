// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Declarative chart scene graph and overlay contracts for `@foh/charts`.
 */

import type { BiquadSpec, ParametricEqBand } from '@foh/dsp';

export interface ChartPlotBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ChartPadding {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ChartAxisBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly yStep?: number;
}

export type ChartXScale = 'log' | 'linear' | 'relative-time';

export interface ChartAxisSpec {
  readonly xScale: ChartXScale;
  readonly xUnit: 'Hz' | 'ms' | 's' | 'dB';
  readonly yUnit: string;
  readonly bounds: ChartAxisBounds;
}

export interface TraceSeries {
  readonly id: string;
  readonly color: string;
  /** Domain X coordinates (used when `ndcVertices` is omitted). */
  readonly x?: Float32Array;
  /** Domain Y coordinates (used when `ndcVertices` is omitted). */
  readonly y?: Float32Array;
  /** Per-sample alpha in `[0, 1]` or uniform alpha scalar. */
  readonly alpha?: Float32Array | number;
  /** Inserts zero-alpha break vertices across phase wrap discontinuities. */
  readonly unwrapPhaseBreaks?: boolean;
  readonly phaseBreakThresholdDeg?: number;
  /** Pre-built plot-local NDC `[ndcX, ndcY, alpha]` vertices. */
  readonly ndcVertices?: Float32Array;
  readonly ndcVertexCount?: number;
  readonly lineDash?: readonly number[];
  readonly lineWidth?: number;
  readonly opacity?: number;
  /** Forces 2D Canvas rendering (default for crisp HiDPI multi-pixel strokes above the grid). */
  readonly force2d?: boolean;
  /** Opts into WebGL2 screen-space quad-strip rendering on the underlay canvas. */
  readonly preferWebGl?: boolean;
}

export interface FractionalOctaveBarSeries {
  readonly id: string;
  readonly color: string;
  readonly centerFrequencies: Float32Array;
  readonly magnitudesDb: Float32Array;
  readonly peaksDb?: Float32Array;
  readonly showPeakHold?: boolean;
}

export interface StemPoint {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly dashed?: boolean;
  readonly opacity?: number;
  readonly lineWidth?: number;
}

export interface HistogramBinBar {
  readonly binCenter: number;
  readonly binMin: number;
  readonly binMax: number;
  readonly value: number;
  readonly highlighted?: boolean;
}

export interface HistogramSeries {
  readonly bins: readonly HistogramBinBar[];
  readonly meanMarkerX?: number;
}

export interface ThresholdGuide {
  readonly warningY: number;
  readonly limitY: number;
  readonly warningLabel: string;
  readonly limitLabel: string;
}

export interface CalloutFlag {
  readonly id: string;
  readonly x: number;
  readonly state: 'feedback' | 'ringing' | 'latched';
  readonly line1: string;
  readonly line2: string;
  readonly accentColor: string;
  readonly badgeColor: string;
  readonly opacity: number;
}

export type EqHandleBand = BiquadSpec | ParametricEqBand;

export interface InteractiveEqOverlay {
  readonly bands: readonly EqHandleBand[];
  /** Domain Y value corresponding to 0 dB EQ gain (0 in TF Magnitude; passband mean SPL in SPL charts). */
  readonly referenceZeroDbY: number;
}

export interface CursorReadoutRow {
  readonly color?: string;
  readonly text: string;
  /** Optional domain Y coordinate to mark with a dot on the curve at `domainX`. */
  readonly highlightDomainY?: number;
}

export interface CursorReadoutModel {
  readonly domainX: number;
  readonly headerText: string;
  readonly subHeaderText?: string;
  readonly rows: readonly CursorReadoutRow[];
}

export interface ChartScene {
  readonly axis: ChartAxisSpec;
  readonly traces?: readonly TraceSeries[];
  readonly rtaBars?: readonly FractionalOctaveBarSeries[];
  readonly stems?: readonly StemPoint[];
  readonly histogram?: HistogramSeries;
  readonly thresholdGuide?: ThresholdGuide;
  readonly calloutFlags?: readonly CalloutFlag[];
  readonly eqOverlay?: InteractiveEqOverlay;
}

export interface EqBandDragDetail {
  readonly bandIndex: number;
  readonly frequency: number;
  readonly gainDb: number;
}
