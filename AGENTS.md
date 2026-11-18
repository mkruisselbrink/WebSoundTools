# AGENTS.md — `WebSoundTools` Workspace Guide

Operational rules and invariants for coding agents working in `WebSoundTools`. Read the relevant app `AGENTS.md` or `packages/<pkg>/README.md` before modifying domain code.

## Commands

- **Typecheck all workspaces:** `npm run typecheck`
- **Run all unit & integration tests:** `npm test`
- **Run a single workspace project's tests:** `npx vitest run --project <name>` (e.g. `@foh/dsp`, `web-sound-meter`, `web-speaker-sim`)
- **Build production bundles (`dist/` + `sw.js`):** `npm run build`
- **Run Playwright E2E suites:** `npm run test:e2e` (`WebSoundMeter` on port `5173`, `WebSpeakerSim` on port `5174`)

## Package Dependency DAG (Strict Layering)

Imports must strictly flow top-down—never introduce cycles or pull DOM/Lit into worker-safe packages:

1. **Zero-DOM / Worker-Safe Core (`0` Lit or browser UI imports):**
   - `@foh/dsp` (`0` dependencies; analytical transfer functions default to `DSP_REFERENCE_SAMPLE_RATE_HZ = 192000`, stateful time-domain filters require explicit runtime `sampleRateHz`)
   - `@foh/acoustics` (depends only on `@foh/dsp`)
   - `@foh/state` (`0` UI dependencies; IndexedDB must preserve in-memory `Map` fallback for Node/headless tests)
   - `@foh/pwa` (`./client`, `./sw`, `./vite` entrypoints)
2. **Browser Rendering & UI Layer (`lit` peer/direct dependency):**
   - `@foh/canvas` (`DualCanvasController`, WebGL2 shader & color utils)
   - `@foh/ui` (depends on `lit`, `@foh/dsp`)
   - `@foh/charts` (depends on `lit`, `@foh/canvas`, `@foh/ui`, `@foh/dsp`, `@foh/acoustics`)
3. **Applications (`apps/WebSoundMeter`, `apps/WebSpeakerSim`):**
   - Never import from one app into the other or from a `@foh/*` package back into `apps/*`.

## Code, Testing & Header Conventions

- **File Size Target:** Keep modules focused and cohesive (~100–300 lines). Split pure math/algorithms from stateful controllers and Lit views.
- **Current-State Code Comments:** Write JSDoc and inline comments that document the current contract and invariants cleanly—never leave transitional comments ("Upgraded to...", "for legacy compatibility", "extracted from...").
- **Co-Located Unit Tests:** Place unit tests right beside the module under test (`src/foo.test.ts` next to `src/foo.ts`). Reserve `apps/*/tests/` strictly for multi-module `integration/` and Playwright `e2e/` specs.
- **Package Exports:** Never expose wildcard `./src/*` exports in `packages/*/package.json`—export explicit entrypoints (`./src/index.ts`) so `.test.ts` files stay internal.
- **Compact SPDX Copyright Headers (`GPL-3.0-or-later`):** Every `.ts` file starts with the compact per-layer SPDX header:
  - `packages/*`: `// Copyright (C) 2026 WebSoundTools Contributors` (+ `// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin` on OSM-inspired DSP/acoustics/chart modules) + `// SPDX-License-Identifier: GPL-3.0-or-later`
  - `apps/WebSoundMeter/**`: `// Copyright (C) 2026 WebSoundMeter Contributors` + `// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin` + `// SPDX-License-Identifier: GPL-3.0-or-later`
  - `apps/WebSpeakerSim/**`: `// Copyright (C) 2026 WebSpeakerSim Contributors` + `// SPDX-License-Identifier: GPL-3.0-or-later`

## Documentation Pointers

- App-specific invariants (storage keys, threads, coordinate systems): `apps/WebSoundMeter/AGENTS.md` and `apps/WebSpeakerSim/AGENTS.md`
- Package API contracts: `packages/*/README.md`
- Cross-cutting architecture: `docs/architecture/`
- End-user guides & step-by-step tutorials (keep free of TypeScript implementation details): `apps/*/docs/user-guide.md` and `docs/tutorials/`
