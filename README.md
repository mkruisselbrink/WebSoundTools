# WebSoundTools

Browser-native Front-of-House (FOH) acoustic prediction and real-time audio measurement toolkit (`GPL-3.0-or-later`).

## Applications

- **[`apps/WebSoundMeter`](apps/WebSoundMeter/README.md)** — Multi-channel dual-FFT acoustic analyzer, transfer function / coherence / impulse-response measurement, virtual crossover & parametric EQ modeling, and Live Show SPL compliance + feedback watch.
- **[`apps/WebSpeakerSim`](apps/WebSpeakerSim/README.md)** — Synchronized 2D Plan & Side Section venue simulator over a 3D direct-field + ground-reflection acoustic solver, point-source & cardioid/end-fire/arc subwoofer modeling, `.gll` / `.clf` / `.frd` loudspeaker importers, and Virtual Mic `.frd` target export.

## Shared Workspace Packages (`@foh/*`)

| Package | Responsibility |
| :--- | :--- |
| `packages/dsp` (`@foh/dsp`) | Pure digital signal processing: RBJ biquads, Butterworth/LR crossovers, DSP chains, FFT, windowing, octave smoothing, group delay |
| `packages/acoustics` (`@foh/acoustics`) | ISO 9613-1 atmosphere, IEC 61672 A/C/Z weighting, ISO 266 octave bands, musical pitch lookup, `.frd` curve I/O |
| `packages/state` (`@foh/state`) | Headless `ReactiveUndoStore` (`txKey` coalescing), IndexedDB repository with in-memory fallback, workspace autosave, URL sync |
| `packages/pwa` (`@foh/pwa`) | Offline Network-First Service Worker with COOP/COEP headers and shared Vite precache build plugin |
| `packages/canvas` (`@foh/canvas`) | HiDPI `DualCanvasController` (WebGL2 + 2D overlay), WebGL2 shader helpers, RGBA color utilities |
| `packages/ui` (`@foh/ui`) | FOH dark-console CSS design tokens, compact inspector field primitives, DSP chain editor, entity tree, modal, toast, shortcut router |
| `packages/charts` (`@foh/charts`) | Unified `<foh-chart-panel>` WebGL2 + 2D acoustic plotter with canvas cursor HUD and draggable on-chart EQ handles (`Freq` / `Gain` / `Shift+Q`) |

## Quickstart

```bash
npm install

# Run development servers
npm run dev:wsm        # WebSoundMeter (http://localhost:5173)
npm run dev:wss        # WebSpeakerSim (http://localhost:5174)

# Typecheck, unit/integration/docs tests, production builds & Playwright E2E
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Documentation

- **End-User Reference Guides & Tutorials:**
  - **[Step-by-Step FOH Tutorial Series (`docs/tutorials/`)](docs/tutorials/README.md)** — Hardware cabling & calibration, venue prediction & sub arrays, PA alignment & virtual EQ, Predict-to-Measure verification, Show SPL compliance & feedback ring-out, custom venue & delay-ring design, and troubleshooting/glossary.
  - **[WebSoundMeter Reference Guide](apps/WebSoundMeter/docs/user-guide.md)** — Panel-by-panel UI, plot types, measurement settings, math operations, and keyboard shortcuts.
  - **[WebSpeakerSim Reference Guide](apps/WebSpeakerSim/docs/user-guide.md)** — 3D venue coordinates, colormaps, CAD gestures, sub-array modes, importers, and keyboard shortcuts.
- **Developer Architecture:**
  - [Monorepo & Package Boundaries](docs/architecture/01-monorepo-and-packages.md)
  - [3-Tier Persistence & Offline PWA](docs/architecture/02-persistence-and-pwa.md)
