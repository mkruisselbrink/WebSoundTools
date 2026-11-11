# 03. Codebase Structure & Rendering Architecture

## 1. Technology Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Build & Dev Server** | **Vite** + TypeScript (`strict: true`) | Native ES module Web Worker bundling, fast HMR, cross-origin isolation headers (`COOP`/`COEP`), and offline Service Worker emission. |
| **UI Components** | **Lit 3** (`lit`) | Reactive Web Components (`<wss-app-shell>`, `<wss-viewport-panel>`, `<wss-chart-panel>`) plus pure functional sub-views for topbar groups, scene tree, and property inspectors. |
| **Physics Engine** | **Dedicated Web Worker (Pure TS)** | Runs off the main UI thread (`src/physics/sim.worker.ts`) over contiguous `Float32Array` Structure-of-Arrays (SoA) buffers with zero DOM dependencies. |
| **Spatial CAD & SPL Rendering** | **WebGL2 + HiDPI 2D Canvas** | `GlHeatmapRenderer` renders false-color SPL LUT textures and anti-aliased `3 dB` / `6 dB` isoline contours; `CanvasCadPainter` draws audience surfaces, speaker icons, dispersion cones, rulers, and interactive handles. |
| **Frequency / Arrival Charts** | **WebGL2 + HiDPI 2D Canvas** | `GlTraceRenderer` renders high-density log-frequency Magnitude, Phase, and Group Delay curves; `CanvasChartPainter` renders axes, cursors, and impulse arrival stems. |
| **Persistence & Offline PWA** | **URL + `localStorage` + `IndexedDB` + Service Worker** | 3-tier persistence (`url-state.ts`, `workspace-session.ts`, `session-storage.ts`) plus installable PWA (`manifest.webmanifest`) and precaching Service Worker. |
| **Automated Testing** | **Vitest** + **Playwright** | Fast Node unit/integration suites covering all physics, DSP, array calculators, and file parsers, plus full-browser Playwright E2E tests. |

---

## 2. Repository Directory Structure

Every module in `src/` has a single, clear responsibility so physics, data models, importers, and renderers remain independently testable:

```text
WebSpeakerSim/
├── index.html
├── main.ts                              # Application bootstrap & Service Worker registration
├── vite.config.ts                       # COOP/COEP headers, offline SW plugin & Vitest config
├── playwright.config.ts                 # Headless Chromium E2E test configuration
├── package.json
├── tsconfig_base.json
├── tsconfig.json
├── LICENSE                              # GNU General Public License v3.0 or later
├── public/
│   ├── manifest.webmanifest             # PWA installability manifest
│   └── icons/                           # Vector (SVG) and raster (192/512 PNG) app icons
├── docs/
│   ├── 01-overview-and-system-capabilities.md
│   ├── 02-acoustic-physics-and-summation-model.md
│   ├── 03-codebase-structure-and-rendering.md
│   ├── 04-loudspeaker-models-and-importers.md
│   └── 05-persistence-and-state-management.md
├── src/
│   ├── pwa/
│   │   ├── sw-core.ts                   # Pure offline precache/runtime cache & COOP/COEP helper
│   │   └── register-sw.ts               # Browser Service Worker registration helper
│   ├── physics/                         # 100% Pure TypeScript (Zero DOM dependencies)
│   │   ├── sim.worker.ts                # Background Web Worker running grid & virtual mic solvers
│   │   ├── transform3d.ts               # 3D vectors, Euler rotation matrices & planar reflection
│   │   ├── atmosphere.ts                # Speed of sound c(T, RH, P) & ISO 9613-1 air absorption
│   │   ├── biquad.ts                    # RBJ Cookbook biquads, LR/BW crossovers & cascade response
│   │   ├── directivity-balloon.ts       # Spherical balloon storage, interpolation & analytical models
│   │   ├── summation-solver.ts          # Receptor mesh complex summation, weightings & coverage stats
│   │   ├── virtual-mic-solver.ts        # Log-spaced 20 Hz - 20 kHz TF, group delay & impulse arrivals
│   │   └── sub-array-designer.ts        # Cardioid, End-Fire, Inline Gradient, Delay Arc & Auto-Align
│   ├── library/                         # Loudspeaker Schema, Parametric Synthesis & File Importers
│   │   ├── speaker-schema.ts            # SpeakerDefinition, BalloonData, PresetFilterGroup types
│   │   ├── spec-builder.ts              # Synthesize SpeakerDefinition from datasheet specs
│   │   ├── builtin-speakers.ts          # Built-in tops, subwoofers & Demo Venue presets
│   │   └── importers/
│   │       ├── gll-importer.ts          # Binary .gll container parser (DataView + DecompressionStream)
│   │       ├── clf-importer.ts          # Tab-delimited polar text importer
│   │       └── frd-importer.ts          # .frd / CSV frequency & polar response importer
│   ├── model/                           # Project Scene State, Undo/Redo & Persistence
│   │   ├── project-types.ts             # Venue surfaces, PointSources, SubArrays, DSP groups, Mics
│   │   ├── project-store.ts             # Reactive store + command stack (Undo/Redo)
│   │   ├── url-state.ts                 # Tier 1 URL query parser & serializer
│   │   ├── workspace-session.ts         # Tier 2 localStorage autosave
│   │   └── session-storage.ts           # Tier 3 IndexedDB projects & imported speaker library
│   ├── viewport/                        # Synchronized 2D Plan & Side Section Viewports
│   │   ├── viewport-panel.ts            # <wss-viewport-panel> Lit element (Plan or Section)
│   │   ├── gl-heatmap-renderer.ts       # WebGL2 SPL LUT & isoline contour shader pipeline
│   │   ├── canvas-cad-painter.ts        # HiDPI 2D venue geometry, speaker glyphs, cones & rulers
│   │   └── viewport-interaction.ts      # Pan/zoom, drag-move, aim-handle, slice-line & ruler state
│   ├── charts/                          # Virtual Mic Response & Coverage Distribution Charts
│   │   ├── chart-panel.ts               # <wss-chart-panel> coordinating WebGL2 + Canvas2D layers
│   │   ├── gl-trace-renderer.ts         # WebGL2 trace renderer with phase-wrap suppression
│   │   ├── canvas-chart-painter.ts      # Logarithmic/linear grids, cursors & arrival impulse stems
│   │   └── plot-types.ts                # Plot coordinate mappers & readout formatting
│   └── ui/                              # Application Shell, Topbar, Sidebar & Inspector Views
│       ├── app-shell.ts                 # <wss-app-shell> root coordinator
│       ├── app-shell-styles.ts          # Design tokens and dark-room FOH layout styles
│       ├── keyboard-shortcuts.ts        # Global shortcut dispatcher (Undo/Redo, Mute, Views, Esc)
│       ├── topbar/                      # Band/Weighting selector, Atmosphere, Presets, Undo/Redo
│       ├── sidebar/                     # Scene hierarchy (Surfaces, Sources, Sub Arrays, Mics, Library)
│       └── inspectors/                  # Context-sensitive property editors & Spec Builder dialog
└── tests/
    ├── unit/                            # Pure physics, geometry, DSP, array math & importer tests
    ├── integration/                     # End-to-end simulation worker & persistence pipeline tests
    └── e2e/                             # Playwright browser workflow & offline PWA tests
```

---

## 3. Simulation Worker Protocol (`sim.worker.ts`)

Main-thread edits never block frame rendering:
1. **`SET_SPEAKER_BALLOONS`:** Transfers serialized `BalloonData` `Float32Array` tables to the worker once whenever a speaker definition is loaded or modified, avoiding redundant balloon copies on position drags.
2. **`EVALUATE_SCENE`:** Sends a lightweight `SimulationRequest` containing flattened radiator poses (`x, y, z, azimuth, tilt, roll`), DSP parameters, atmospheric conditions, reflection planes, receptor grid bounds/resolution (`coarse` vs. `fine`), and virtual microphone coordinates, stamped with a monotonically increasing `requestId`.
3. **Request Coalescing & Progressive Refinement:** During continuous pointer drags, `sim.worker.ts` immediately computes and posts `GRID_RESULT` (`coarse` `0.8 m` step) + `MIC_RESULT` (`requestId`), and schedules a `fine` (`0.25 m` step) pass that cancels automatically if a newer `requestId` arrives first.

---

## 4. Two-Layer Viewport & Chart Rendering

Both `<wss-viewport-panel>` and `<wss-chart-panel>` stack two synchronized `<canvas>` elements sized to `devicePixelRatio`:
1. **Bottom Layer (`WebGL2RenderingContext`, with automatic `Canvas2D` image-buffer fallback):**
   - Uploads the worker's `Float32Array` SPL scalar grid as an `R32F` floating-point texture (`OES_texture_float_linear` or manual bilinear interpolation in the fragment shader).
   - Evaluates a perceptually distinct acoustic false-color colormap (e.g., `70 dB` deep navy $\rightarrow$ cyan $\rightarrow$ green $\rightarrow$ yellow $\rightarrow$ orange $\rightarrow$ `110+ dB` crimson/magenta), masks pixels outside active venue/section bounds, and draws crisp anti-aliased `3 dB` / `6 dB` isobar contour lines via screen-space derivatives (`fwidth`).
2. **Top Layer (`CanvasRenderingContext2D`):**
   - Renders crisp vector geometry, metric grid ticks, audience zone outlines, speaker enclosures with nominal $-6\text{ dB}$ dispersion wedges, virtual microphone pins, section cut lines, and hover SPL/coordinate readouts.
