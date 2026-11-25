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
2. **DSP Worker Thread (`src/dsp/dsp.worker.ts`, `src/dsp/dsp-worker-runtime.ts`):**
   - Pure TypeScript + `@foh/dsp` + `@foh/acoustics` (zero DOM / Lit imports). `dsp.worker.ts` is a thin Web Worker host delegating all message handling, ring-buffer/simulator consumption, and 32-ch `MixerInputWatchScanner` sweeps to the directly unit-testable `DspWorkerRuntime` class.
   - Drives `MeasurementPipeline` instances across simultaneous live measurement slots (`SHARED_MEASUREMENT_CONFIG_KEYS` in `src/dsp/measurement-config.ts` synchronize FFT size, window, averaging, and octave smoothing across slots so `Math Union` traces always share identical frequency bins).
   - Stateful time-domain `BroadbandMeterBank` (`src/dsp/weighting-meters.ts`) uses explicit runtime `sampleRateHz` (`createWeightingBiquadCoeffs` from `@foh/acoustics`) and preserves `consumeEpochEnergy()` for SPL/Leq logging.
3. **UI & Rendering Thread (`src/ui/`, `src/charts/`, `src/sources/`):**
   - `AudioSessionController` (`src/ui/controllers/audio-session-controller.ts`), `MixerWatchController` (`src/ui/controllers/mixer-watch-controller.ts`), and `WorkspaceLayoutController` (`src/ui/workspace-store.ts`) own audio lifecycle, dual-device Mixer Input Watch (`DualDeviceCaptureCoordinator`), Tuning vs. Show mode layouts, routing, SPL alerts, and URL / `localStorage` autosave, feeding `<wsm-topbar>`, `<wsm-tuning-sidebar>`, `<wsm-show-sidebar>`, `<wsm-mobile-show-deck>`, and `<wsm-mixer-watch-modal>`.
   - `SourceStore` (`src/sources/source-store.ts`) composes `@foh/state`'s `ReactiveUndoStore` **strictly around user-authored state** (`storedSources`, `eqSources`, `unionSources`, and live slot user metadata) while delegating 25 FPS telemetry to `LiveTelemetryFeed` (`src/sources/live-telemetry-feed.ts`) and virtual EQ/Union evaluation to `DerivedSourceEvaluator` (`src/sources/derived-source-evaluator.ts`), emitting `'live' | 'authored' | 'selection'` change kinds. **Never** store 25 FPS telemetry (`liveSourcesById`, `feedbackRingLog`, or `Float32Array` bins) inside undo snapshots.

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
- **Chart Rendering (`src/charts/chart-panel.ts`, `src/charts/wsm-chart-adapter.ts`):** `<chart-panel>` subclasses `@foh/charts`'s `FohChartPanelBase`, mapping `SourceData[]` directly to `ChartScene` TypedArrays (`Float32Array`) with `WeakMap` RTA bar caching (`1/3`, `1/6`, `1/12` octave) so 25 FPS frames allocate zero per-bin objects.
- **Test Layout & Selectors:** Co-locate unit tests alongside source files (`src/**/*.test.ts`). Keep `tests/integration/` and `tests/e2e/demo-simulator.spec.ts` intact, and preserve all `data-testid` attributes.
- **SPDX Header:** Start every `.ts` file in `apps/WebSoundMeter/` with:
  ```ts
  // Copyright (C) 2026 WebSoundMeter Contributors
  // Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

## Audio, DSP & Live Show Mode Invariants

- **Hardware Reload Gesture Deferral & Native Clock Rate:**
  - When reloading in `'hardware'` input mode, start paused (`isPaused = true`, `hardwareStreamDeferred = true`) and display the remembered `selectedDeviceLabel` until the user clicks **Resume** (which supplies the browser user gesture for `AudioContext.resume()` / `getUserMedia`).
  - Instantiate `new AudioContext()` without forcing `{ sampleRate: 48000 }`, forward the actual `audioContext.sampleRate` to `dsp.worker.ts`, clear `MultiChannelRingBuffer` (which uses unsigned 32-bit `Uint32Array` atomic indices + `>>> 0` wrap-around so counters never overflow after 12.4 hours at 48 kHz) on mode switch, and guard `setInputMode()` with a concurrency sequence token (`modeSwitchSeq`).
  - Always resolve `slot.referenceChannel` (`REFERENCE_CHANNEL_GLOBAL = -2` for Follow Global Ref, `-1` for Internal Generator Loopback on ring-buffer slot `8`, or `0..63` for physical input channels) via `resolveEffectiveReferenceChannel()` in both `live-slot-manager.ts` and `dsp.worker.ts`.
- **DSP Pipeline Correctness & Drift Prevention:**
  - **Never Double-Weight `BroadbandMeterBank`:** Pass gain-adjusted, unweighted `rawM` into `BroadbandMeterBank.processSample()`—never `filtM` (output of `preFilterM`), as `BroadbandMeterBank` already runs parallel Z, A, and C biquad cascades internally.
  - **Periodic Running-Sum Recalibration & Wall-Clock `dtSeconds`:** Keep the 1,024-frame FIFO running-sum recomputation in `TransferFunctionAnalyzer` (and reallocate coherence FIFOs when `coherenceDepth` changes) plus the 1,024-second recomputation in `SplHistoryTracker` to prevent floating-point drift over multi-hour shows. Measure real `dtSeconds` via `performance.now()` (clamped to `[0.005, 0.25]`) in `dsp.worker.ts`, and never alias an unknown `slotId` onto Slot 0 in `getOrCreateSlotRuntime(slotId)`.
  - **Linear-Only Impulse Union:** In `union-source.ts`, combine `timeData.impulse` only for linear superposition operations (`sum`, `subtract`, `vector-avg`, `power-avg`); leave `timeData.impulse` zeroed for `apply`, `diff-db`, `min`, and `max`.
- **Live Show Mode Safety & Dual-Resolution SPL History:**
  - **Hardware Generator Safety Interlock:** Entering **🎚 Show** mode while `audioInputMode === 'hardware'` must force `genConfig.enabled = false` and hide generator controls (and never auto-enable on return to **🛠 Tuning**). In `'simulator'` mode, keep generator and per-slot Simulator Preset controls accessible inside Show mode.
  - **Mode-Scoped Layouts & Stored Trace Filtering:** `WorkspaceLayoutController` maintains independent layout presets/plots for Tuning (`pa-triple`, `tf-dual`, `rta-mix`, `single`) vs. Show (`show-dual`, `show-triple`, `single`). `getVisibleSourcesForMode()` hides `kind === 'stored'` traces in Show mode without mutating their persisted `visible` flags.
  - **Tier B → Tier A Checkpoint Backfill & Multi-Slot Plotting:** `SplHistoryTracker` runs Tier A (`4 Hz`, 5-min ring for `1m`/`5m` views) and Tier B (`1 Hz`, 4-hour ring for `15m`/`1h`/`4h` views, persisted to IndexedDB `'spl-show-logs'`). `hydrateCheckpoint()` must backfill the latest 300 s of Tier B into Tier A (and `dsp.worker.ts` must immediately post `splHistory` on `'hydrate-spl-history'` / `'set-spl-history-window'`) so `1m`/`5m` views work right after reload. `buildSplHistoryTraces()` must render all visible live slots in every `SplHistoryTraceMode` using each slot's `src.color` (differentiating metrics via solid/dashed/dotted line styles and opacity).
  - **4 Hz `epochSeq` Throttling:** `dsp.worker.ts` only attaches `splHistory` when `epochSeq` advances (or on window/hydration changes); `SourceStore.setLiveFrames()` must preserve `existing.splHistory` when an intermediate 40 ms frame omits it.
- **Virtual EQ Dual-Field Sync & Zero-Allocation Hot Loops:**
  - Keep `EqualizerSourceConfig.bands` (`BiquadSpec[]`) and `config.dsp.eqBands` (`ParametricEqBand[]`) synchronized via `normalizeEqSourceConfig`, `syncEqConfigWithBands`, or `applyPatchToEqConfig`.
  - Use `writeEffectiveBinResponse()` with pre-allocated scratch structs in `eq-source.ts` and `union-source.ts`, preserve `WeakMap` caches for EQ curves and RTA octave bars, and debounce IndexedDB writes (`150 ms`) during on-chart EQ handle drags.

