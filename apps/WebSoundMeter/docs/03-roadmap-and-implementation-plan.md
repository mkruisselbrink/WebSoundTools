# 03. Codebase Structure & Module Reference

## 1. Technology Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Build & Dev Server** | **Vite** + TypeScript (`strict: true`) | Native `AudioWorklet` & `Web Worker` bundling, fast HMR, and `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers for `SharedArrayBuffer`. |
| **UI Components** | **Lit 3** (`lit`) | Reactive Web Components (`<wsm-app-shell>`, `<wsm-chart-panel>`) plus pure functional sub-views for topbar groups, sidebar, and source inspectors. |
| **Audio I/O & Worklets** | **Web Audio API + `AudioWorklet`** | Raw multi-channel `getUserMedia` routing (`HardwareAudioRouter`), worklet signal generator & dual-channel tap (`CaptureTapProcessor`), and lock-free `SPSC` `RingBuffer`. |
| **DSP Engine** | **Dedicated Web Worker (Pure TS)** | Runs off the main UI thread and off the 2.67 ms audio thread (`src/dsp/dsp.worker.ts`). Pure TypeScript over `Float32Array` buffers. |
| **Chart Rendering** | **WebGL2 + 2D Canvas Overlay** | `GlTraceRenderer` for GPU-accelerated traces with coherence alpha and phase-wrap suppression; `CanvasChartPainter` for grids, cursors, and draggable EQ nodes. |
| **Persistence & Offline PWA** | **URL + `localStorage` + `IndexedDB` + Service Worker** | 3-tier state persistence (`url-state.ts`, `workspace-session.ts`, `session-storage.ts`) plus installable PWA (`manifest.webmanifest`) and offline Service Worker (`sw-core.ts`). |
| **Automated Testing** | **Vitest** + **Playwright** | 24 Vitest unit & integration test suites (74 tests) + Playwright E2E browser tests driven by the built-in Acoustic Simulator. |

---

## 2. Repository Directory Structure

Every file in `src/` is organized around a single responsibility so modules remain concise and independently testable:

```text
WebSoundMeter/
├── index.html
├── vite.config.ts                       # Configures COOP/COEP headers & Vitest
├── playwright.config.ts                 # Headless Chromium E2E test configuration
├── package.json
├── tsconfig.json
├── LICENSE                              # GNU General Public License v3.0 (GPLv3)
├── public/
│   ├── manifest.webmanifest             # PWA installability manifest
│   └── icons/                           # Vector (SVG) and raster (192/512 PNG) app icons
├── docs/
│   ├── 01-overview-and-comparison.md
│   ├── 02-architecture-and-dsp-design.md
│   ├── 03-roadmap-and-implementation-plan.md
│   ├── 04-testing-and-simulation-design.md
│   ├── 05-persistence-and-state-management.md
│   ├── 06-spl-history-and-logging.md
│   └── 07-feedback-detection-design.md
├── src/
│   ├── main.ts                          # Application bootstrap & Service Worker registration
│   ├── pwa/
│   │   ├── sw-core.ts                   # Pure offline precache/runtime cache & COOP/COEP header core
│   │   └── register-sw.ts               # Browser Service Worker registration helper
│   ├── audio/
│   │   ├── audio-engine.ts              # Multi-slot coordinator between DSP Worker & HardwareAudioRouter
│   │   ├── hardware-audio-router.ts     # AudioContext, 64ch getUserMedia, dynamic 8-tap splitter/merger routing
│   │   ├── ring-buffer.ts               # Lock-free SPSC MultiChannelRingBuffer (SharedArrayBuffer)
│   │   └── worklets/
│   │       └── capture-worklet.ts       # AudioWorkletProcessor: signal generator + 8-channel + loopback tap
│   ├── dsp/                             # 100% Pure TypeScript (Zero DOM/WebAudio dependencies)
│   │   ├── dsp.worker.ts                # Background Web Worker running AnalyzerPipeline & SyntheticAcousticRig
│   │   ├── analyzer-pipeline.ts         # Full dual-channel measurement pipeline orchestrator
│   │   ├── synthetic-rig.ts             # Deterministic PA/Room simulator (5 presets)
│   │   ├── signal-generator.ts          # Pink (Voss-McCartney), White, Sine, and Log Sweep synthesis
│   │   ├── fft.ts                       # Radix-2 FFT / IFFT with precomputed twiddle & bit-reversal tables
│   │   ├── window-functions.ts          # Hann, Hamming, Blackman, FlatTop, Rectangular windows + coherent gain
│   │   ├── biquad.ts                    # RBJ Cookbook biquads (PEQ, shelves, LPF/HPF, notch, allpass, LR24)
│   │   ├── transfer-function.ts         # H1 & OSM estimators, FIFO/Bessel LPF averaging, coherence γ²(f)
│   │   ├── deconvolution.ts             # Regularized IFFT impulse response, step response & auto delay finder
│   │   ├── smoothing.ts                 # O(1) prefix-sum fractional-octave smoothing (1/1 .. 1/48 oct)
│   │   ├── weighting-meters.ts          # IEC 61672 A/C/Z weighting filters & Fast/Slow/Impulse/Leq/Peak meters
│   │   └── calibration.ts               # 2/3-column .cal/.txt/.frd parser & log-frequency interpolator
│   ├── sources/                         # Unified SourceData Model, Virtual Sources & Persistence
│   │   ├── source-data.ts               # Structure-of-Arrays (SoA) Float32Array data structures & helpers
│   │   ├── source-store.ts              # Reactive store managing Stored, Virtual EQ, and Math Union sources
│   │   ├── eq-source.ts                 # Virtual Parametric EQ evaluation (up to 8 bands)
│   │   ├── union-source.ts              # Multi-source math (Vector Avg, Power Avg, RMS Avg, Subtract, Min, Max)
│   │   ├── workspace-session.ts         # Tier 2 localStorage persistence (DSP config, gen config, audio routing)
│   │   └── session-storage.ts           # Tier 3 IndexedDB v2 persistence (Stored, EQ, Union, Calibration curves)
│   ├── charts/                          # Hybrid WebGL2 + 2D Canvas Chart Engine
│   │   ├── chart-panel.ts               # <wsm-chart-panel> Lit element coordinating canvas layers & resize
│   │   ├── chart-header-view.ts         # Plot type selector, alignment badge, and cursor readout bar
│   │   ├── chart-interaction.ts         # Pure cursor hover, Y-axis zoom/pan, and EQ band drag state machine
│   │   ├── canvas-chart-painter.ts      # 2D Canvas grid, axes, traces fallback, peak hold, and EQ handles
│   │   ├── gl-trace-renderer.ts         # WebGL2 shader pipeline for traces, coherence alpha & phase wrapping
│   │   └── plot-types.ts                # Plot metadata, coordinate mappers, Group Delay & Crest Factor math
│   └── ui/                              # Application Shell, Topbar, Sidebar & Inspector Views
│       ├── app-shell.ts                 # <wsm-app-shell> root coordinator
│       ├── app-shell-styles.ts          # Scoped CSS design tokens and layout styles
│       ├── url-state.ts                 # Tier 1 URL query parser, serializer & History API integration
│       ├── keyboard-shortcuts.ts        # Global keyboard shortcut dispatcher (Space, C, D, R, E, U, 1-3, Esc)
│       ├── sidebar-view.ts              # Right-hand source list (Live, Stored, Virtual EQ, Math Union)
│       ├── topbar/
│       │   ├── topbar-view.ts           # Top bar container composing functional toolbar groups
│       │   ├── input-routing-group.ts   # Unified Input dropdown (Simulator + Hardware), global Ref, Pause/Resume
│       │   ├── generator-group.ts       # Signal generator controls (type, frequency, level dBFS, enable)
│       │   └── spl-meter-group.ts       # Live broadband SPL / Leq / Peak meter & crest factor badge
│       └── inspectors/
│           ├── live-measurement-inspector.ts # Per-slot source/delay/gain/polarity/cal + collapsible Advanced settings
│           ├── stored-source-inspector.ts    # Rename, color, gain/delay offsets, notes & JSON export
│           ├── eq-source-inspector.ts        # Target source selector & 8-band parametric EQ editor table
│           └── union-source-inspector.ts     # Math mode selector & multi-source checkbox matrix
└── tests/
    ├── unit/                            # 20 fast Vitest unit test suites
    ├── integration/                     # 3 Vitest multi-module pipeline & workflow test suites
    └── e2e/                             # Playwright full-browser E2E & persistence tests
```

---

## 3. Keyboard Shortcuts (`src/ui/keyboard-shortcuts.ts`)

All keyboard shortcuts inspect `e.composedPath()[0]` so typing inside Shadow DOM `<input>`, `<textarea>`, or `<select>` elements never triggers global commands:

| Key | Action |
| :--- | :--- |
| `Space` | **Pause / Resume** live measurement and hardware signal generator |
| `C` | **Capture** current active trace into a new `StoredSource` snapshot |
| `D` | **Apply** the Auto Delay Finder's estimated propagation delay to the active Live Measurement |
| `M` | Add a new simultaneous **Live Measurement** source (`+ Meas`) |
| `R` | **Reset** averaging buffers and peak hold accumulators |
| `E` | Create a new **Virtual Parametric EQ** source targeting the active trace |
| `U` | Create a new **Math Union** source |
| `1` / `2` / `3` | Switch viewport between **1**, **2**, or **3** stacked charts |
| `Escape` | Close the Source Properties Inspector drawer |
