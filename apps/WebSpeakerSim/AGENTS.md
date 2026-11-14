# AGENTS.md — `WebSpeakerSim` (`apps/WebSpeakerSim`)

Operational rules and architectural invariants for coding agents modifying `WebSpeakerSim`. Also read the root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide rules.

## Commands

- **Dev server (with `COOP`/`COEP` headers on port `5174`):** `npm run dev:wss` (from root) or `npm run dev` (in `apps/WebSpeakerSim`)
- **Typecheck:** `npm --workspace web-speaker-sim run typecheck`
- **Unit & integration tests:** `npx vitest run --project web-speaker-sim`
- **Playwright E2E tests (port `5174`):** `npm --workspace web-speaker-sim run test:e2e`

## Coordinate System & Acoustic Physics Invariants

- **Right-Handed Metric Venue Coordinates (`meters`):**
  - **`+X` (Throw):** Stage (`X = 0 m`) toward audience / FOH (`-X` is upstage).
  - **`+Y` (Lateral):** Stage Left (`+Y`, top of Plan View); Stage Right is `-Y` (bottom of Plan View); centerline is `Y = 0 m`.
  - **`+Z` (Elevation):** Floor (`Z = 0 m`) upward toward ceiling.
  - **Euler Aiming Sign Conventions:** Negative `tiltDeg` (`-10°`) tilts a flown enclosure downward toward the floor. On a Stage-Left (`+Y`) cabinet, negative `azimuthDeg` (`-12°`) toes inward toward centerline (`Y = 0 m`). Mirror L/R pairs invert `y` and `azimuthDeg`.
- **Dedicated Simulation Worker (`src/physics/sim.worker.ts`):**
  - Pure TypeScript + `@foh/dsp` + `@foh/acoustics` over contiguous `Float32Array` buffers (zero DOM / Lit imports).
  - Analytical DSP frequency-response evaluation defaults to `DSP_REFERENCE_SAMPLE_RATE_HZ = 192000` so high-frequency EQ and crossovers suffer zero bilinear Nyquist cramping near `16–20 kHz`.

## Browser Persistence Invariants (Do Not Rename)

Renaming any of these constants will break saved venue projects, imported `.gll`/`.clf`/`.frd` speaker libraries, or crash recovery:

- **`localStorage` Workspace Key:** `'wss.workspace.v1'` (`src/model/workspace-session.ts`)
- **`IndexedDB` Database:** `IDB_DATABASE_NAME = 'web-speaker-sim-db'`, `IDB_DATABASE_VERSION = 1` (`src/model/session-storage.ts`, `fallbackMode: 'memory'`)
  - `'projects'` — Named saved venue scenes & colormap configs (`SavedProjectRecord`)
  - `'speakers'` — Custom spec-built & imported `.gll` / `.clf` / `.frd` loudspeaker definitions (`SpeakerDefinition`)
- **Portable Project Bundle Format:** `format: 'wss-project-v1'` (`.wss-project.json`, bundling scene + colormap + custom speakers)
- **Service Worker Cache Prefix:** `'wss-precache-'`, version `'v1'` (`vite.config.ts`)

## Viewport, Chart & UI Guardrails

- **Dual-Canvas Viewports (`src/viewport/`):** `<wss-viewport-panel>` uses `@foh/canvas`'s `DualCanvasController` (`gl-heatmap-renderer.ts` for WebGL2 SPL LUTs & isoline contours + `canvas-cad-painter.ts` coordinating `cad-grid-ruler.ts`, `cad-zone-painter.ts`, and `cad-entity-painter.ts` with shared `occupiedPills` label collision avoidance and `drawColormapLegendBar`).
- **Virtual Mic Charts & On-Chart EQ (`src/charts/wss-chart-adapter.ts`):** Maps `VirtualMicResponse[]`, `PlanGridResult` audience histograms, and selected `DspGroup` EQ bands into `<foh-chart-panel>`. When a `DspGroup` is selected on the `Magnitude` tab, `InteractiveEqOverlay` anchors `referenceZeroDbY` to the passband mean SPL so 0 dB filter handles sit directly over the acoustic SPL traces (`txKey` coalesces pointer drags into a single Undo step).
- **Predict-to-Measure `.FRD` Export:** `virtual-mic-inspector.ts` exports predicted complex transfer functions (`FreqHz\tMagDb\tPhaseDeg`) via `@foh/acoustics`'s `serializeFrdCurve`, directly importable into `WebSoundMeter`.
- **Test Layout & Selectors:** Co-locate unit tests alongside source files (`src/**/*.test.ts`). Keep `tests/integration/` and `tests/e2e/speaker-sim.spec.ts` intact, and preserve all `data-testid` attributes.
- **SPDX Header:** Start every `.ts` file in `apps/WebSpeakerSim/` with:
  ```ts
  // Copyright (C) 2026 WebSpeakerSim Contributors
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

