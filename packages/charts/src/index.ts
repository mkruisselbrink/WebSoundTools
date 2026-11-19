// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

export {
  type CalloutFlag,
  type ChartAxisBounds,
  type ChartAxisSpec,
  type ChartPadding,
  type ChartPlotBox,
  type ChartScene,
  type ChartXScale,
  type CursorReadoutModel,
  type CursorReadoutRow,
  type EqBandDragDetail,
  type EqHandleBand,
  type FractionalOctaveBarSeries,
  type HistogramBinBar,
  type HistogramSeries,
  type InteractiveEqOverlay,
  type StemPoint,
  type ThresholdGuide,
  type TraceSeries,
} from './chart-scene-types.js';
export {
  DEFAULT_CHART_PADDING,
  ISO_FREQUENCY_GRID_LINES,
  ISO_MAJOR_FREQUENCIES,
  buildTraceNdcVertices,
  chooseCleanAxisStep,
  computeAdaptiveGroupDelayBounds,
  computeAdaptiveMagnitudeBounds,
  computeCoherenceAlpha,
  computeZoomedYRange,
  formatFrequencyLabel,
  formatRelativeTimeLabel,
  getChartPlotBox,
  normXToValue,
  normYToValue,
  valueToNormX,
  valueToNormY,
  type BuildTraceNdcOptions,
  type CoherenceBlankingMode,
  type MagnitudeSpanMode,
  type TraceVertexBuffer,
} from './coord-math.js';
export { GlTraceRenderer } from './gl-trace-renderer.js';
export {
  drawCanvasTrace,
  drawChartGridAndAxes,
  drawHistogramSeries,
  drawRtaBarSeries,
  drawStemPoints,
  drawThresholdGuide,
  type CanvasTraceStyle,
} from './canvas-grid-painter.js';
export {
  computeAdjustedEqQ,
  computeDraggedEqBand,
  drawCalloutFlags,
  drawEqHandles,
  drawFloatingCursorHud,
  findHitEqBandIndex,
  getEqBandParams,
} from './canvas-overlays.js';
export {
  FohChartPanel,
  FohChartPanelBase,
  fohChartPanelStyles,
  paintChartScene,
} from './foh-chart-panel.js';
