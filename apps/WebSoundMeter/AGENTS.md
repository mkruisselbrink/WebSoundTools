# AGENTS.md — `WebSoundMeter` (`apps/WebSoundMeter`)

Operational rules and architectural invariants for coding agents modifying `WebSoundMeter`. Also read the root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide rules.

## Commands

- **Dev server (with `COOP`/`COEP` headers on port `5173`):** `npm run dev:wsm` (from root) or `npm run dev` (in `apps/WebSoundMeter`)
- **Typecheck:** `npm --workspace web-sound-meter run typecheck`
- **Unit & integration tests:** `npx vitest run --project web-sound-meter`
- **Playwright E2E tests (port `5173`):** `npm --workspace web-sound-meter run test:e2e`

## Real-Time 3-Thread Architecture

1. **Audio Thread (`src/audio/worklets/capture-worklet.ts`):**
   - Runs in `AudioWorkletGlobalScope` on 128-sample quanta (~2.67 ms at 48 kHz).
   - **Zero heap allocations** inside `process()`. Writes up to 8 physical hardware tap channels + 1 internal generator loopback channel (`slot 8`) into `MultiChannelRingBuffer` (`SharedArrayBuffer`), falling back to batched 1024-sample `MessagePort` chunks when cross-origin isolation is unavailable.
2. **DSP Worker Thread (`src/dsp/dsp.worker.ts`):**
   - Pure TypeScript + `@foh/dsp` + `@foh/acoustics` (zero DOM / Lit imports).
   - Drives `MeasurementPipeline` instances across simultaneous live measurement slots (`SHARED_MEASUREMENT_CONFIG_KEYS` synchronize FFT size, window, averaging, and octave smoothing across slots so `Math Union` traces always share identical frequency bins).
   - Stateful time-domain `BroadbandMeterBank` (`src/dsp/weighting-meters.ts`) uses explicit runtime `sampleRateHz` (`createWeightingBiquadCoeffs` from `@foh/acoustics`) and preserves `consumeEpochEnergy()` for SPL/Leq logging.
3. **UI & Rendering Thread (`src/ui/`, `src/charts/`, `src/sources/`):**
   - `WorkspaceStore` (`src/ui/workspace-store.ts`) manages Tuning vs. Show mode, plot layouts, routing, SPL alert thresholds, and URL / `localStorage` autosave.
   - `SourceStore` (`src/sources/source-store.ts`) composes `@foh/state`'s `ReactiveUndoStore` **strictly around user-authored state** (`storedSources`, `eqSources`, `unionSources`, and live slot user metadata). **Never** store 25 FPS telemetry (`liveSourcesById`, `feedbackRingLog`, or `Float32Array` bins) inside undo snapshots.

## Browser Persistence Invariants (Do Not Rename)

Renaming any of these constants will wipe existing user calibrations, stored traces, or compliance logs:

- **`localStorage` Workspace Key:** `'web-sound-meter:workspace:v1'` (`src/sources/workspace-session.ts`)
- **`IndexedDB` Database:** `DB_NAME = 'web-sound-meter-db'`, `DB_VERSION = 3` (`src/sources/session-storage.ts`, `fallbackMode: 'noop'`)
  - `'stored-traces'` — Captured & imported `.frd` traces
  - `'eq-sources'` — Virtual DSP / Parametric EQ configurations (`EqualizerSourceConfig`)
  - `'union-sources'` — Multi-trace Math / Union configurations (`UnionSourceConfig`)
  - `'calibration-curves'` — Microphone calibration files (`.cal` / `.frd` / `.txt`)
  - `'spl-show-logs'` — Rolling SPL / Leq compliance checkpoints
- **Service Worker Cache Prefix:** `'wsm-precache-'`, version `'v2'` (`vite.config.ts`)

## UI, DSP & Testing Guardrails

- **Tuning Mode vs. Show Mode Sidebars:** **🛠 Tuning** mode uses `@foh/ui`'s grouped `renderEntityTree` sidebar (`src/ui/sidebar-view.ts`), while **🎚 Show** mode uses its dedicated compliance & feedback watch view (`src/ui/show-sidebar-view.ts`). Keep both workflows intact.
- **Virtual EQ (`src/sources/eq-source.ts`):** Evaluates the full `@foh/dsp` `SourceDspConfig` chain (Gain, Electronic Delay $e^{-j\omega\tau}$, Polarity, Mute, Butterworth / Linkwitz-Riley HPF & LPF crossovers, and Parametric EQ bands at `DSP_REFERENCE_SAMPLE_RATE_HZ = 192000`). On-chart EQ handle dragging, Auto-Flatten Room Modes (`auto-eq-matcher.ts`), and Feedback Watch notch insertion index strictly into `eqBands[]` independent of active crossover sections.
- **Chart Rendering (`src/charts/wsm-chart-adapter.ts`):** Maps `SourceData[]` directly to `<foh-chart-panel>` `ChartScene` TypedArrays (`Float32Array`) with `WeakMap` RTA bar caching (`1/3`, `1/6`, `1/12` octave) so 25 FPS frames allocate zero per-bin objects.
- **Test Layout & Selectors:** Co-locate unit tests alongside source files (`src/**/*.test.ts`). Keep `tests/integration/` and `tests/e2e/demo-simulator.spec.ts` intact, and preserve all `data-testid` attributes.
- **SPDX Header:** Start every `.ts` file in `apps/WebSoundMeter/` with:
  ```ts
  // Copyright (C) 2026 WebSoundMeter Contributors
  // Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

