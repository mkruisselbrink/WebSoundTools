# WebSoundTools

Browser-native Front-of-House (FOH) acoustic prediction and real-time audio measurement toolkit (`GPL-3.0-or-later`).

## Applications

- **[`apps/WebSoundMeter`](apps/WebSoundMeter/README.md)** — Dual-channel FFT acoustic analyzer, transfer function / coherence / impulse-response measurement, virtual crossover & parametric EQ modeling, and Live Show SPL compliance + feedback watch.
- **[`apps/WebSpeakerSim`](apps/WebSpeakerSim/README.md)** — Interactive 2D/3D acoustic SPL venue simulator, line-array / point-source / cardioid sub-array modeling, `.gll` / `.clf` / `.frd` loudspeaker importers, and Virtual Mic `.frd` target export.

## Shared Workspace Packages (`@foh/*`)

| Package | Responsibility |
| :--- | :--- |
| `packages/dsp` (`@foh/dsp`) | Pure digital signal processing: RBJ biquads, Butterworth/LR crossovers, DSP chains, FFT, windowing, octave smoothing, group delay |
| `packages/acoustics` (`@foh/acoustics`) | ISO 9613-1 atmosphere, IEC 61672 A/C/Z weighting, ISO 266 octave bands, musical pitch lookup, `.frd` curve I/O |
| `packages/state` (`@foh/state`) | Headless `ReactiveUndoStore` (`txKey` coalescing), IndexedDB repository with in-memory fallback, workspace autosave, URL sync |
| `packages/pwa` (`@foh/pwa`) | Offline Network-First Service Worker with COOP/COEP headers and shared Vite precache build plugin |
| `packages/canvas` (`@foh/canvas`) | HiDPI `DualCanvasController` (WebGL2 + 2D overlay), WebGL2 shader helpers, RGBA color utilities |
| `packages/ui` (`@foh/ui`) | FOH dark-console CSS design tokens, compact inspector field primitives, DSP chain editor, entity tree, modal, toast, shortcut router |
| `packages/charts` (`@foh/charts`) | Unified `<foh-chart-panel>` WebGL2 + 2D acoustic plotter with canvas cursor HUD and draggable on-chart EQ handles |

## Quickstart

```bash
npm install

# Run development servers
npm run dev:wsm        # WebSoundMeter (http://localhost:5173)
npm run dev:wss        # WebSpeakerSim (http://localhost:5174)

# Typecheck, unit/integration tests, production builds & Playwright E2E
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Documentation

- **End-User Tutorials:**
  - [WebSoundMeter User Guide](apps/WebSoundMeter/docs/user-guide.md)
  - [WebSpeakerSim User Guide](apps/WebSpeakerSim/docs/user-guide.md)
  - [Predict-to-Measure `.FRD` Workflow](docs/predict-to-measure-workflow.md)
- **Developer Architecture:**
  - [Monorepo & Package Boundaries](docs/architecture/01-monorepo-and-packages.md)
  - [Persistence & Offline PWA](docs/architecture/02-persistence-and-pwa.md)
  - Per-package API contracts in `packages/*/README.md` and app deep dives in `apps/*/docs/dev/`
- **Agent Guidelines:** [AGENTS.md](AGENTS.md), [apps/WebSoundMeter/AGENTS.md](apps/WebSoundMeter/AGENTS.md), [apps/WebSpeakerSim/AGENTS.md](apps/WebSpeakerSim/AGENTS.md)
