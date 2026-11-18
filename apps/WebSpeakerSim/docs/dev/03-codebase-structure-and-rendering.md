# 03. Codebase Structure & Rendering Architecture

## 1. Technology Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Build & Dev Server** | **Vite** + `@foh/pwa/vite` + TypeScript (`strict: true`) | Native ES module Web Worker bundling, fast HMR, cross-origin isolation headers (`COOP`/`COEP`), and hashed `sw.js` precaching. |
| **UI Components** | **Lit 3** + `@foh/ui` | `<wss-app-shell>`, shared FOH console CSS tokens, `<foh-modal>`, `<foh-toast>`, grouped `renderEntityTree` scene tree, and shared `renderDspChainEditor`. |
| **Physics Engine** | **Dedicated Web Worker + `@foh/dsp` & `@foh/acoustics`** | Runs off the main UI thread (`src/physics/sim.worker.ts`) over contiguous `Float32Array` buffers with zero DOM dependencies. |
| **Spatial CAD & SPL Rendering** | **`@foh/canvas` (`DualCanvasController`) + WebGL2 + 2D Canvas** | `<wss-viewport-panel>` pairs `GlHeatmapRenderer` (SPL LUTs & isoline contours) with `canvas-cad-painter.ts` (`cad-grid-ruler.ts`, `cad-zone-painter.ts`, `cad-entity-painter.ts` with `occupiedPills` label collision avoidance). |
| **Frequency / Arrival Charts** | **`@foh/charts` (`<foh-chart-panel>`)** | WebGL2 + HiDPI 2D Canvas plotter driven by `wss-chart-adapter.ts` for Magnitude, Phase, Group Delay, Impulse Arrivals, SPL Histograms, and `referenceZeroDbY`-anchored draggable DSP Group EQ handles. |
| **Persistence & Undo** | **`@foh/state`** | `ProjectStore` extending `ReactiveUndoStore` (`txKey` drag coalescing) + 3-tier persistence (`url-state.ts`, `workspace-session.ts`, `session-storage.ts`). See [`../../../../docs/architecture/02-persistence-and-pwa.md`](../../../../docs/architecture/02-persistence-and-pwa.md). |
| **Automated Testing** | **Vitest** + **Playwright** | Co-located unit tests (`src/**/*.test.ts`), `tests/integration/simulation-worker-presets.test.ts`, and Playwright E2E specs (`tests/e2e/speaker-sim.spec.ts` on port `5174`). |

---

## 2. Application Directory Structure (`apps/WebSpeakerSim/`)

```text
apps/WebSpeakerSim/
├── index.html
├── main.ts                                    # Application bootstrap & Service Worker registration
├── vite.config.ts                             # fohPwaPlugin (wss-precache-v1) + Vitest project config
├── playwright.config.ts                       # Headless Chromium E2E test configuration (port 5174)
├── package.json
├── tsconfig.json
├── AGENTS.md                                  # Operational rules & invariants for coding agents
├── README.md                                  # Overview, features, shortcuts & quickstart
├── public/
│   ├── manifest.webmanifest                   # PWA installability manifest
│   └── icons/                                 # Vector (SVG) app icons
├── docs/
│   ├── user-guide.md                          # Illustrated end-user tutorials
│   ├── images/                                # Tutorial screenshots
│   └── dev/
│       ├── 01-overview-and-system-capabilities.md
│       ├── 02-acoustic-physics-and-summation-model.md
│       ├── 03-codebase-structure-and-rendering.md
│       └── 04-loudspeaker-models-and-importers.md
├── src/                                       # Domain modules + co-located *.test.ts unit suites
│   ├── pwa/
│   │   └── register-sw.ts                     # @foh/pwa/client wrapper
│   ├── physics/                               # 100% Pure TypeScript (Zero DOM dependencies)
│   │   ├── sim.worker.ts                      # Background Web Worker entrypoint
│   │   ├── sim-worker-core.ts                 # Progressive coarse/fine grid & Virtual Mic worker scheduler
│   │   ├── sim-controller.ts                  # Main-thread worker coordinator & balloon transfer cache
│   │   ├── transform3d.ts                     # 3D vectors, Euler rotation matrices & planar reflection
│   │   ├── directivity-balloon.ts             # Spherical balloon storage, interpolation & parametric synthesis
│   │   ├── radiator-expander.ts               # Expands L/R mirrored PointSources & SubArrays to 3D radiators
│   │   ├── coverage-stats.ts                  # Audience mean SPL, ±3 dB homogeneity %, histogram & stage rejection
│   │   ├── summation-solver.ts                # Receptor mesh complex pressure summation & IEC/spectrum weighting
│   │   ├── virtual-mic-solver.ts              # 20 Hz - 20 kHz TF, group delay, arrivals & .FRD export
│   │   ├── group-alignment.ts                 # Inter-group arrival delta & phase-optimal polarity solver
│   │   └── sub-array-designer.ts              # Cardioid (CSA), End-Fire, Inline Gradient & Electronic Delay Arc
│   ├── library/                               # Loudspeaker Schema, Spec Builder & File Importers
│   │   ├── speaker-schema.ts                  # SpeakerDefinition, BalloonData & PresetFilterGroup types
│   │   ├── spec-builder.ts                    # Synthesize 3D balloon from PDF datasheet parameters
│   │   ├── builtin-speakers.ts                # Built-in tops & subwoofers
│   │   ├── demo-presets.ts                    # Club, Festival, Auditorium & Arena demo venues
│   │   └── importers/
│   │       ├── index.ts                       # Loudspeaker file-drop dispatcher
│   │       ├── gll-importer.ts                # Binary .gll importer entry point + fallback adapter
│   │       ├── gll/                           # Structured EASE_GLL v3-v6 parser (ported from cwBudde/gll-tools, MIT)
│   │       │   ├── gll-binary-reader.ts       # Little-endian ByteReader, BitCompression & zlib inflator
│   │       │   ├── gll-spectrum-parser.ts     # CLogSpectrumLP / TransferFunctionLsPs & pole-deduped balloon lookup
│   │       │   ├── gll-container-parser.ts    # Header, GenSystem, BoxTypes, CaseGeometry, Sources & FilterGroups
│   │       │   └── gll-speaker-builder.ts     # Coherent multi-driver BoxType summation & -6 dB beamwidth solver
│   │       ├── clf-importer.ts                # Tab-delimited .clf / .tab polar importer
│   │       └── frd-importer.ts                # .frd curve (@foh/acoustics) -> 3D speaker & JSON serializer
│   ├── model/                                 # Project Scene State, Undo/Redo & Persistence
│   │   ├── project-types.ts                   # Venue surfaces, PointSources, SubArrays, DspGroups, VirtualMics
│   │   ├── colormap-config.ts                 # Turbo/Inferno/Viridis palettes, Auto/Manual range & isoline config
│   │   ├── project-store.ts                   # ProjectStore extending @foh/state ReactiveUndoStore
│   │   ├── url-state.ts                       # Tier 1 URL query parser & serializer
│   │   ├── workspace-session.ts               # Tier 2 localStorage ('wss.workspace.v1')
│   │   └── session-storage.ts                 # Tier 3 IndexedDB v1 ('web-speaker-sim-db') & .wss-project.json
│   ├── viewport/                              # Synchronized 2D Plan & Side Section Viewports
│   │   ├── viewport-panel.ts                  # <wss-viewport-panel> using @foh/canvas DualCanvasController
│   │   ├── viewport-coords.ts                 # World (m) <-> CSS pixel camera transforms
│   │   ├── viewport-interaction.ts            # Pan/zoom, entity drag, aim-handle, slice-line & ruler gestures
│   │   ├── gl-heatmap-renderer.ts             # WebGL2 SPL LUT & screen-space fwidth isoline shader pipeline
│   │   ├── cad-grid-ruler.ts                  # Metric grid, axes, distance/time ruler & dB colorbar legend
│   │   ├── cad-zone-painter.ts                # Audience/stage polygons, section cut line & pill collision guard
│   │   ├── cad-entity-painter.ts              # Speaker glyphs, -6 dB cones, aim handles, sub arrays & mic pins
│   │   └── canvas-cad-painter.ts              # Top-level 2D CAD overlay coordinator
│   ├── charts/                                # @foh/charts Scene Adapter
│   │   └── wss-chart-adapter.ts               # Virtual Mic, Histogram & referenceZeroDbY DSP Group EQ scene builder
│   └── ui/                                    # Application Shell, Topbar, Sidebar & Per-Entity Inspectors
│       ├── app-shell.ts                       # <wss-app-shell> root coordinator
│       ├── app-shell-styles.ts                # App layout styles extending @foh/ui tokens/controls/panels
│       ├── keyboard-shortcuts.ts              # Shortcut bindings via @foh/ui shortcut-router
│       ├── topbar/                            # Venue presets, Band/Palette/Contours, Coverage badges & Layout
│       ├── sidebar/                           # Scene tree built on @foh/ui renderEntityTree
│       └── inspectors/                        # Modular PointSource, SubArray, DspGroup, Surface, Mic, Env & Library modal
└── tests/
    ├── integration/                           # simulation-worker-presets.test.ts
    └── e2e/                                   # speaker-sim.spec.ts (Playwright, port 5174)
```

---

## 3. Simulation Worker Protocol (`sim.worker.ts`)

Main-thread edits never block frame rendering:
1. **`SET_SPEAKER_BALLOONS`:** Transfers serialized `BalloonData` `Float32Array` tables to the worker once whenever a speaker definition is loaded or modified, avoiding redundant balloon copies on position drags.
2. **`EVALUATE_SCENE`:** Sends a lightweight `SimulationRequest` containing flattened radiator poses (`x, y, z, azimuth, tilt, roll`), DSP parameters, atmospheric conditions, reflection planes, receptor grid bounds/resolution (`coarse` vs. `fine`), and virtual microphone coordinates, stamped with a monotonically increasing `requestId`.
3. **Request Coalescing & Progressive Refinement:** During continuous pointer drags, `sim.worker.ts` immediately computes and posts `GRID_RESULT` (`coarse` `0.8 m` step) + `MIC_RESULT` (`requestId`), and schedules a `fine` (`0.25 m` step) pass that cancels automatically if a newer `requestId` arrives first.

---

## 4. Two-Layer Viewport & Chart Rendering

Both `<wss-viewport-panel>` and `<foh-chart-panel>` stack two synchronized `<canvas>` elements managed by `@foh/canvas`'s `DualCanvasController`:
1. **Bottom Layer (`WebGL2RenderingContext`, with automatic `Canvas2D` fallback):**
   - `<wss-viewport-panel>` uploads the worker's `Float32Array` SPL grid as an `R32F` floating-point texture, applies the active acoustic LUT (`Turbo` / `Rainbow`, `Inferno` / `Thermal`, or `Viridis`), masks out-of-bounds pixels, and draws anti-aliased `1`/`2`/`3`/`6 dB` isobar contours via screen-space derivatives (`fwidth`).
   - `<foh-chart-panel>` renders log-frequency Magnitude, Phase, and Group Delay curves directly from `Float32Array` buffers with $\pm 180^\circ$ phase-wrap break suppression.
2. **Top Layer (`CanvasRenderingContext2D`):**
   - `<wss-viewport-panel>` renders crisp metric grids, audience zones, speaker enclosures with $-6\text{ dB}$ dispersion cones, aim handles, virtual mic pins, label collision pills (`occupiedPills`), and the live SPL colorbar legend.
   - `<foh-chart-panel>` renders axes, arrival stems, SPL coverage histograms, `referenceZeroDbY`-anchored draggable DSP Group EQ handles, and the floating canvas cursor HUD.
