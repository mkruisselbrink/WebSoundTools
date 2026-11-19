# AGENTS.md — `WebSoundTools` Workspace Guide

Operational rules and invariants for coding agents working in `WebSoundTools`. Read the relevant app `AGENTS.md` or `packages/<pkg>/README.md` before modifying domain code.

## Commands

- **Typecheck all workspaces:** `npm run typecheck`
- **Run all unit & integration tests:** `npm test`
- **Run a single workspace project's tests:** `npx vitest run --project <name>` (e.g. `@foh/dsp`, `web-sound-meter`, `web-speaker-sim`)
- **Build production bundles (`dist/` + `sw.js`):** `npm run build`
- **Run Playwright E2E suites:** `npm run test:e2e` (`WebSoundMeter` on port `5173`, `WebSpeakerSim` on port `5174`)
- **Regenerate all 22 Retina tutorial & user-guide screenshots:** `npm run docs:screenshots` (`docs/scripts/generate-screenshots.mjs`)

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
  - `apps/WebSpeakerSim/**`: `// Copyright (C) 2026 WebSpeakerSim Contributors` (+ `// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)` on `src/library/importers/gll/*`) + `// SPDX-License-Identifier: GPL-3.0-or-later`

## Shared Architecture, Charting & Documentation Guardrails

- **Direct TypeScript Source Exports (No Package Build Step):** `@foh/*` packages export `./src/index.ts` directly (resolved by Vite and `tsc --noEmit` via `"moduleResolution": "bundler"`). Never emit compiled `.js`/`.d.ts` files inside `packages/*` or point `packages/*/package.json` at `dist/`. Use explicit `.js` extensions on relative intra-package imports (`import { ... } from './foo.js'`) and bare specifiers (`@foh/dsp`, `@foh/pwa/client`) across workspace packages.
- **Locked Single-Row `.chart-header` & Canvas Cursor HUD (`@foh/charts`):** Both `<chart-panel>` (`WebSoundMeter`) and `<wss-chart-panel>` (`WebSpeakerSim`) subclass `FohChartPanelBase`. Keep `.chart-header` locked to a single row (`height: 32px; flex-wrap: nowrap; overflow: hidden`) and render all hover/cursor readouts on the 2D overlay canvas (`drawFloatingCursorHud`)—never render dynamic cursor coordinates as DOM text inside `.chart-header` (which causes header line-wrapping, triggering `ResizeObserver` and clearing/thrashing the WebGL2 & 2D canvases on pointer move).
- **Adaptive Plot Auto-Scaling & Magnitude-Gated Group Delay (`@foh/charts`):** Preserve `computeAdaptiveMagnitudeBounds` (`peak + 5 dB` headroom with `30 / 60 / 80 dB` span windows) and `computeAdaptiveGroupDelayBounds` (gating group-delay auto-scale to bins within `50 dB` of peak magnitude so deep `-120 dB` comb-filter phase nulls do not blow out the millisecond scale), as well as non-clipping plot box padding (`left: 52, right: 18, top: 12, bottom: 24`).
- **Undo/Redo Drag Coalescing (`txKey`), Strict IDB Durability & Shadow-DOM Shortcuts (`@foh/state`, `@foh/ui`):** Pass a deterministic `txKey` to `ReactiveUndoStore` during continuous pointer drags or slider scrubs and call `endTransaction()` on pointer release so a drag records a single `Cmd/Ctrl + Z` step. Keep `IdbRepository` synchronous `resolvedDb` caching and `{ durability: 'strict' }` + `tx.commit?.()` on `readwrite` transactions so immediate `page.reload()` never aborts in-flight writes. Route all global keyboard shortcuts through `@foh/ui`'s `dispatchKeyboardShortcut` (`isEditableShortcutTarget` checks `event.composedPath()` across Shadow DOM boundaries).
- **Offline PWA Asset Precaching (`@foh/pwa`):** Any new static asset added under `apps/*/public/` must be included in `fohPwaPlugin({ staticPaths: [...] })` in that app's `vite.config.ts` so offline `COOP`/`COEP` precaching (`SharedArrayBuffer` support) serves it when offline.
- **Playwright Binary File Uploads (No `@types/node` in `tsconfig.base.json`):** Browser/worker code intentionally omits `@types/node`. In Playwright E2E specs, `locator.setInputFiles([{ name, mimeType, buffer }])` requires a runtime Node `Buffer` rather than a raw `Uint8Array`; use `(globalThis as unknown as { Buffer: { from(b: Uint8Array): unknown } }).Buffer.from(bytes)`.
- **Neutral Acoustic Terminology in Docs & UI:** In `WebSpeakerSim` docs, tutorials, and UI copy, refer to acoustic principles and standard file formats (`.gll`, `.clf`, `.frd`) rather than unnecessarily naming commercial third-party prediction or processor software.

## Documentation Pointers

- App-specific invariants (storage keys, threads, coordinate systems): `apps/WebSoundMeter/AGENTS.md` and `apps/WebSpeakerSim/AGENTS.md`
- Package API contracts: `packages/*/README.md`
- Cross-cutting architecture: `docs/architecture/`
- End-user guides & step-by-step tutorials (keep free of TypeScript implementation details): `apps/*/docs/user-guide.md` and `docs/tutorials/`
