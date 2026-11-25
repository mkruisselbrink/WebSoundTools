# 03. Codebase Structure & Module Reference

## 1. Technology Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Build & Dev Server** | **Vite** + `@foh/pwa/vite` + TypeScript (`strict: true`) | Native `AudioWorklet` & `Web Worker` bundling, fast HMR, `COOP`/`COEP` headers for `SharedArrayBuffer`, and hashed `sw.js` build precaching. |
| **UI Components** | **Lit 3** + `@foh/ui` | `<wsm-app-shell>`, shared FOH console CSS tokens, `<foh-modal>`, `<foh-toast>`, grouped `renderEntityTree` (Tuning Mode), dedicated `show-sidebar-view.ts` (Show Mode), and shared `renderDspChainEditor`. |
| **Audio I/O & Worklets** | **Web Audio API + `AudioWorklet`** | Raw multi-channel `getUserMedia` routing (`HardwareAudioRouter`), worklet signal generator & dual-channel tap (`CaptureTapProcessor`), and lock-free `SPSC` `MultiChannelRingBuffer`. |
| **DSP Engine** | **Dedicated Web Worker + `@foh/dsp` & `@foh/acoustics`** | Runs off the main UI thread and off the 2.67 ms audio thread (`src/dsp/dsp.worker.ts`) over contiguous `Float32Array` buffers. |
| **Chart Rendering** | **`@foh/charts` (`<foh-chart-panel>`)** | WebGL2 + HiDPI Canvas2D acoustic plotter driven by zero-GC `Float32Array` `ChartScene` adapters (`wsm-chart-adapter.ts`), `WeakMap` RTA bar caching, floating canvas cursor HUD, and on-chart EQ handles. |
| **Persistence & Undo** | **`@foh/state`** | 3-tier persistence (`url-state.ts`, `workspace-session.ts`, `session-storage.ts`) + `ReactiveUndoStore` (`Cmd/Ctrl + Z`) around authored user state. See [`../../../../docs/architecture/02-persistence-and-pwa.md`](../../../../docs/architecture/02-persistence-and-pwa.md). |
| **Automated Testing** | **Vitest** + **Playwright** | Co-located unit tests (`src/**/*.test.ts`), multi-module `tests/integration/*.test.ts`, and Playwright E2E specs (`tests/e2e/demo-simulator.spec.ts` on port `5173`). |

---

## 2. Application Directory Structure (`apps/WebSoundMeter/`)

```text
apps/WebSoundMeter/
├── index.html
├── main.ts                                    # Application bootstrap & Service Worker registration
├── vite.config.ts                             # fohPwaPlugin (wsm-precache-v2) + Vitest project config
├── playwright.config.ts                       # Headless Chromium E2E test configuration (port 5173)
├── package.json
├── tsconfig.json
├── AGENTS.md                                  # Operational rules & invariants for coding agents
├── README.md                                  # Overview, features, shortcuts & quickstart
├── public/
│   ├── manifest.webmanifest                   # PWA installability manifest
│   └── icons/                                 # Vector (SVG) and raster (192/512 PNG) app icons
├── docs/
│   ├── user-guide.md                          # Illustrated end-user tutorials (Tuning, EQ, Show Mode)
│   ├── images/                                # Playwright-captured tutorial screenshots
│   └── dev/
│       ├── 01-overview-and-comparison.md
│       ├── 02-architecture-and-dsp-design.md
│       ├── 03-codebase-structure-and-modules.md
│       ├── 04-testing-and-simulation-design.md
│       ├── 05-spl-history-and-logging.md
│       └── 06-feedback-detection-design.md
├── src/                                       # Domain modules + co-located *.test.ts unit suites
│   ├── pwa/
│   │   └── register-sw.ts                     # @foh/pwa/client wrapper
│   ├── audio/
│   │   ├── audio-engine.ts                    # Multi-slot coordinator between DSP Worker & HardwareAudioRouter
│   │   ├── live-slot-manager.ts               # Live slot config management & shared FFT/averaging sync
│   │   ├── hardware-audio-router.ts           # AudioContext, 64ch getUserMedia, dynamic 40-tap + secondary mixer router
│   │   ├── ring-buffer.ts                     # Lock-free SPSC MultiChannelRingBuffer (SharedArrayBuffer)
│   │   └── worklets/
│   │       └── capture-worklet.ts             # AudioWorkletProcessor: signal generator + multi-ch + loopback tap
│   ├── dsp/                                   # 100% Pure TypeScript (Zero DOM/WebAudio dependencies)
│   │   ├── dsp-worker-protocol.ts             # Typed main <-> DSP worker message contracts
│   │   ├── dsp.worker.ts                      # Background Web Worker running AnalyzerPipeline & MixerInputWatchScanner
│   │   ├── analyzer-pipeline.ts               # Dual-channel measurement pipeline orchestrator
│   │   ├── synthetic-rig.ts                   # Deterministic PA/Room & 4-ch Stage Mixer simulator
│   │   ├── signal-generator.ts                # Pink (Voss-McCartney), White, Sine, and Log Sweep synthesis
│   │   ├── transfer-function.ts               # H1 & Ratio estimators, FIFO/Bessel LPF averaging, coherence γ²(f)
│   │   ├── deconvolution.ts                   # Regularized IFFT impulse/step response & auto delay finder
│   │   ├── weighting-meters.ts                # IEC 61672 A/C/Z time-domain meters (Fast/Slow/Impulse/Leq/Peak)
│   │   ├── spl-ring-buffers.ts                # Circular multi-resolution SPL history storage
│   │   ├── spl-compliance.ts                  # LAeq15 / LAeq1 / Peak threshold & dose compliance evaluator
│   │   ├── spl-csv-export.ts                  # Timestamped SPL show log CSV serializer
│   │   ├── spl-history.ts                     # Rolling SPL history coordinator & checkpoint serializer
│   │   ├── feedback-phase-tracker.ts          # Phase-vocoder instantaneous frequency & pitch-jitter tracker
│   │   ├── feedback-discriminators.ts         # Sparse-safe prominence, narrowband Q & 2nd–6th harmonic comb sieve
│   │   ├── feedback-detector.ts               # Phase-coherent FeedbackDetector & post-transient overhang tracker
│   │   ├── mixer-watch-scanner.ts             # Lightweight 32-ch console input scanner & causal Mix-Bus guard
│   │   ├── feedback-culprit-resolver.ts       # Cross-channel feedback merger & culprit confidence ranker
│   │   └── calibration.ts                     # Microphone calibration curve adapter (@foh/acoustics .frd/.cal)
│   ├── sources/                               # SourceData Model, Virtual Sources & Persistence
│   │   ├── source-data.ts                     # Structure-of-Arrays (SoA) Float32Array data structures & .frd export
│   │   ├── source-store.ts                    # Authored ReactiveUndoStore + 25 FPS live telemetry store
│   │   ├── eq-source.ts                       # Full @foh/dsp SourceDspConfig virtual crossover/delay/PEQ model
│   │   ├── auto-eq-matcher.ts                 # Room-mode inverse PEQ synthesizer & per-culprit Notch EQ builder
│   │   ├── mixer-patch-storage.ts             # Named Mixer Input Patch presets & deviceId/label affinity storage
│   │   ├── union-source.ts                    # Vector Avg, Power Avg, Sum, Subtract, Cascade, dB Diff, Min/Max
│   │   ├── calibration-manager.ts             # Calibration file import/delete & active slot assignment
│   │   ├── workspace-session.ts               # Tier 2 localStorage ('web-sound-meter:workspace:v1')
│   │   └── session-storage.ts                 # Tier 3 IndexedDB v3 ('web-sound-meter-db')
│   ├── charts/                                # @foh/charts Scene Adapters & Header Toolbar
│   │   ├── plot-types.ts                      # Plot metadata, coordinate mappers, Group Delay & Crest Factor math
│   │   ├── wsm-chart-adapter.ts               # Zero-GC Float32Array ChartScene & WeakMap RTA bar builder
│   │   └── wsm-chart-controls.ts              # Plot-specific header controls (RTA bars, Span, SPL trace mode)
│   └── ui/                                    # Application Shell, WorkspaceStore, Topbar, Sidebars & Inspectors
│       ├── app-shell.ts                       # <wsm-app-shell> root coordinator
│       ├── app-shell-styles.ts                # App layout styles extending @foh/ui tokens/controls/panels
│       ├── workspace-store.ts                 # Tuning/Show mode, plot layouts, routing & autosave/URL sync
│       ├── url-state.ts                       # Tier 1 URL query parser & serializer
│       ├── keyboard-shortcuts.ts              # Shortcut bindings via @foh/ui shortcut-router
│       ├── sidebar-view.ts                    # Tuning Mode sidebar built on @foh/ui renderEntityTree
│       ├── show-sidebar-view.ts               # Show Mode compliance dashboard & Feedback Watch ring log
│       ├── mixer-watch-modal.ts               # 32-ch Mixer Input Watch & Named Patch Presets dialog
│       ├── topbar/                            # Input routing, generator, and live SPL/Leq meter groups
│       └── inspectors/                        # Live, Calibration, Stored (.frd), EQ (dsp-chain-editor) & Union views
└── tests/
    ├── integration/                           # analyzer-pipeline, demo-simulator-workflow & ring-buffer suites
    └── e2e/                                   # demo-simulator.spec.ts (Playwright, port 5173)
```

---

## 3. Keyboard Shortcuts (`src/ui/keyboard-shortcuts.ts`)

Routed via `@foh/ui`'s Shadow-DOM-aware `isEditableShortcutTarget` guard so typing in `<input>`, `<textarea>`, or `<select>` elements never triggers global commands:

| Key | Action |
| :--- | :--- |
| `Cmd / Ctrl + Z` | **Undo** last authored source, EQ, or slot configuration edit |
| `Cmd / Ctrl + Shift + Z` / `Ctrl + Y` | **Redo** source, EQ, or slot edit |
| `Space` | **Pause / Resume** live measurement and hardware signal generator |
| `C` | **Capture** current active trace into a new `StoredSource` snapshot |
| `D` | **Apply** the Auto Delay Finder's estimated propagation delay to the active Live Measurement |
| `M` | Add a new simultaneous **Live Measurement** source (`+ Meas`) |
| `R` | **Reset** averaging buffers and peak hold accumulators |
| `E` | Create a new **Virtual Parametric EQ** source targeting the active trace |
| `U` | Create a new **Math Union** source |
| `1` / `2` / `3` / `4` | Switch viewport between **1**, **2**, **3**, or **4** stacked charts |
| `Escape` | Close open modal or inspector selection |
