# `@foh/charts`

Unified WebGL2 + 2D Canvas acoustic charting engine for WebSoundTools (`WebSoundMeter` and `WebSpeakerSim`).

## Modules

- **`chart-scene-types.ts`**: Declarative `ChartScene` graph (`ChartAxisSpec`, `TraceSeries`, `FractionalOctaveBarSeries`, `StemPoint`, `HistogramSeries`, `ThresholdGuide`, `CalloutFlag`, `InteractiveEqOverlay`, `CursorReadoutModel`).
- **`coord-math.ts`**: Logarithmic/linear/relative-time coordinate transforms, plot-local NDC vertex builder with phase-wrap discontinuity breaks, coherence-alpha curves, Y-axis zoom math, and adaptive Magnitude / Group Delay bound calculators.
- **`gl-trace-renderer.ts`**: Scissored WebGL2 `LINE_STRIP` trace renderer with per-vertex alpha blending and zero-alpha break discard.
- **`canvas-grid-painter.ts`**: 2D Canvas axes, ISO frequency & relative-time grids, coherence-bucketed 2D trace strokes, fractional-octave RTA bars, arrival stems, SPL histograms, and compliance threshold guides.
- **`canvas-overlays.ts`**: `referenceZeroDbY`-aware draggable parametric EQ handles, collision-avoiding feedback callout flags, and floating canvas cursor HUD with curve-tracking dots.
- **`foh-chart-panel.ts`**: `FohChartPanelBase`, `<foh-chart-panel>`, and `paintChartScene` powered by `@foh/canvas`'s `DualCanvasController`.
