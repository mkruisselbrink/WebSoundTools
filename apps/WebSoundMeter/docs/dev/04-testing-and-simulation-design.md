# 04. Automated Testing & Virtual Acoustic Simulator

## 1. Design Philosophy: "Testable by Construction"

Audio and graphics applications are difficult to test when DSP math, state management, Web Audio nodes, and `<canvas>` rendering calls are tightly coupled. `WebSoundMeter` enforces clean architectural boundaries so that every subsystem is covered by automated tests:

1. **Pure TypeScript Functional DSP Core (`@foh/dsp`, `@foh/acoustics`, `src/dsp/`)**:
   - Every math and signal-processing module (`@foh/dsp`, `@foh/acoustics`, `transfer-function.ts`, `deconvolution.ts`, `weighting-meters.ts`, `signal-generator.ts`, `analyzer-pipeline.ts`, `spl-history.ts`, `feedback-detector.ts`) operates purely on `Float32Array` buffers with zero DOM or Web Audio dependencies.
2. **Co-Located Pure UI & State Controllers (`src/sources/`, `src/charts/`, `src/ui/`, `@foh/*`)**:
   - State machines and adapters—such as `SourceStore`, `wsm-chart-adapter.ts`, `url-state.ts`, `workspace-session.ts`, `session-storage.ts`, and `keyboard-shortcuts.ts`—live alongside co-located `*.test.ts` unit suites.
3. **First-Class Simulated Acoustic Rig (`src/dsp/synthetic-rig.ts`)**:
   - The same mathematical acoustic simulator that powers the interactive **Built-in Demo Simulator** in the browser UI also runs deterministically in unit, integration, and Playwright E2E tests.

---

## 2. Automated Test Suite Architecture

Run all workspace unit and integration tests via `npm test` (`vitest run`) and full browser E2E tests via `npm run test:e2e` (`playwright test`).

### 2.1 Co-Located Unit Test Suites (`src/**/*.test.ts` & `packages/*/src/**/*.test.ts`)

| Test Suite | Module Under Test | What It Verifies |
| :--- | :--- | :--- |
| `packages/pwa/src/*.test.ts` | `@foh/pwa` | Offline precaching, old cache cleanup, parameterized navigation URL fallback (`/?layout=...`), Cache-First static asset serving, and `COOP`/`COEP` header preservation. |
| `packages/dsp/src/*.test.ts` | `@foh/dsp` | Radix-2 FFT/IFFT & Parseval's theorem, window functions, RBJ biquads, LR/Butterworth crossovers, `SourceDspConfig` chain evaluation, $O(1)$ octave smoothing, and group delay. |
| `packages/acoustics/src/*.test.ts` | `@foh/acoustics` | Speed of sound & ISO 9613-1 air absorption, IEC 61672-1 A/C/Z weighting, ISO 266 octave grids, musical pitch mapping, and `.FRD`/`.CAL` parsing, serialization & interpolation. |
| `packages/charts/src/*.test.ts` | `@foh/charts` | Log-frequency and linear-time coordinate math, WebGL2 trace buffer builders (coherence alpha & phase-wrap splitting), 2D Canvas grid/overlay painters, and `<foh-chart-panel>` interaction. |
| `src/dsp/transfer-function.test.ts` | `src/dsp/transfer-function.ts` | $H_1$ and OSM transfer function recovery ($\pm 0.05\text{ dB}$ magnitude, $\pm 0.5^\circ$ phase), complex vector phase wrap-around averaging at $\pm 180^\circ$, coherence $\gamma^2(f)$ vs. theoretical SNR, and Bessel LPF averaging. |
| `src/dsp/deconvolution.test.ts` | `src/dsp/deconvolution.ts` | Zero-error integer sample delay detection, sub-sample parabolic interpolation ($\pm 0.05$ samples), polarity inversion detection, and Step Response integration. |
| `src/dsp/weighting-meters.test.ts` | `src/dsp/weighting-meters.ts` | IEC 61672 Class 1 A/C/Z frequency response across ISO third-octave frequencies and Fast/Slow/Impulse/$L_{\text{eq}}$/Peak ballistics. |
| `src/dsp/spl-history.test.ts` | `src/dsp/spl-history.ts` | Multi-tier (`4 Hz` / `1 Hz` / `8 s`) linear-energy ring buffers, rolling `LAeq`/`LCeq` windows, compliance alerts, checkpoint hydration, and CSV formatting. |
| `src/dsp/feedback-detector.test.ts` | `src/dsp/feedback-detector.ts` | Prominence, parabolic frequency tracking, persistence/kurtosis/harmonic music rejection, and ISO 31-band GEQ / notch recommendations. |
| `src/dsp/signal-generator.test.ts` | `src/dsp/signal-generator.ts` | White noise, Voss-McCartney pink noise ($-3\text{ dB/octave}$ spectral slope), sine wave frequency accuracy, and logarithmic sweep synthesis. |
| `src/sources/sources.test.ts` | `src/sources/eq-source.ts`, `union-source.ts`, `source-data.ts` | `SourceDspConfig` Virtual EQ + crossovers, `.FRD` import/export SPL normalization, and Math Union vector/power average, subtract, min, and max. |
| `src/sources/source-store.test.ts` | `src/sources/source-store.ts` | Capturing live/fallback traces, updating stored trace offsets, Virtual EQ editing, Math Union evaluation, and IndexedDB persistence hooks. |
| `src/sources/session-storage.test.ts` | `src/sources/session-storage.ts` | IndexedDB v3 CRUD round-trips for `stored-traces`, `eq-sources`, `union-sources`, `calibration-curves`, and `spl-show-logs`. |
| `src/sources/workspace-session.test.ts` | `src/sources/workspace-session.ts` | `localStorage` serialization, validation, and corrupted-JSON fallback for DSP config, generator config, calibration ID, and hardware audio routing. |
| `src/ui/url-state.test.ts` | `src/ui/url-state.ts` | URL query parsing, default-omitting serialization (`?layout`, `plots`, `mode`, `preset=hw`, `spl`, `src`), and `pushState`/`replaceState` history sync. |
| `src/charts/wsm-chart-adapter.test.ts` | `src/charts/wsm-chart-adapter.ts` | Mapping `SourceData[]` across all plot types into `@foh/charts` `TraceSeries` and interactive EQ handles. |
| `src/ui/keyboard-shortcuts.test.ts` | `src/ui/keyboard-shortcuts.ts` | Shortcut dispatch (`Cmd/Ctrl+Z`, `Space`, `C`, `D`, `R`, `E`, `U`, `1`–`3`, `Escape`) and Shadow DOM input retargeting protection. |
| `src/audio/audio-engine-and-router.test.ts` | `src/audio/audio-engine.ts`, `hardware-audio-router.ts` | Worker message coordination, hardware `getUserMedia` constraints (`echoCancellation: false`), channel splitter/merger routing, and pause/resume propagation. |
| `src/dsp/capture-worklet-and-worker.test.ts` | `src/audio/worklets/capture-worklet.ts`, `dsp.worker.ts` | `CaptureTapProcessor` SPSC `SharedArrayBuffer` ring buffer & `MessagePort` fallback, pause output muting, and multi-slot DSP Worker tick orchestration. |

### 2.2 Integration Test Suites (`tests/integration/` — 3 Suites)
- **`ring-buffer.test.ts`**: Randomized chunk-size producer/consumer wrap-around tests and overrun/underrun safety on `SPSC` `SharedArrayBuffer` ring buffers.
- **`analyzer-pipeline.test.ts`**: End-to-end `AnalyzerPipeline` verification feeding `SyntheticAcousticRig` presets into the full FFT + $H_1$ + Deconvolution + SPL pipeline.
- **`demo-simulator-workflow.test.ts`**: Multi-step PA alignment workflow test (detecting delay on `sub-top-misaligned`, compensating delay, capturing a stored trace, and flattening room modes with `EqualizerSource`).

### 2.3 End-to-End Browser Tests (`tests/e2e/demo-simulator.spec.ts`)
- Runs headless Chromium via Playwright against the Vite dev server:
  1. Verifies live DSP frames stream from the Built-in Demo Simulator and update the Auto Delay Finder (`11.5 ms` on `flat-delayed`) and SPL/Leq meter.
  2. Applies the detected delay (`D` / **Apply**), switches presets (`room-modes`), captures a **Stored Trace**, creates a **Virtual Parametric EQ** source, creates a **Math Union** source, and switches between `1`, `2`, and `3` chart layouts.
  3. Reloads the page and verifies that URL parameters (`?layout=3...`), `localStorage` workspace settings (`delayMs`), and `IndexedDB` sources (Stored Trace, Virtual EQ, Math Union) are all restored automatically.

---

## 3. Built-in Demo Simulator Presets (`src/dsp/synthetic-rig.ts`)

The Input selector in the top bar includes **6 interactive acoustic presets** under `Built-in Demo Simulator`:

| Preset ID | Display Name | What It Simulates | Features It Showcases |
| :--- | :--- | :--- | :--- |
| `flat-delayed` | **1. Flat System (Delayed 10ms)** | Ideal flat speaker at `10.0 ms` (`3.43 m`) air delay + `-75 dBFS` quiet noise floor | Auto Delay Finder (`10.00 ms`), Phase flattening once delay is matched, clean Impulse peak at `0 ms`. |
| `pa-room-modes` | **2. PA Tuning (Room Modes + HF Loss)** | Main PA at `8.5 ms` with `+6.5 dB` boom at `160 Hz`, `-5.0 dB` dip at `800 Hz`, and HF loss above `9 kHz` | Transfer Function Magnitude/Phase, capturing a baseline trace, and designing a corrective **Virtual Parametric EQ**. |
| `sub-top-misaligned` | **3. Sub + Top Crossover (Misaligned)** | 2-way `100 Hz` LR24 crossover where the Subwoofer is delayed by `+4.5 ms` and polarity-inverted | Deep crossover cancellation notch at `100 Hz`, phase slope inspection, polarity inversion, and delay alignment. |
| `comb-filtering` | **4. Floor Bounce Comb Filtering** | Main speaker at `5.0 ms` + strong floor reflection at `+2.0 ms` (`-3.5 dB`) | Severe Magnitude/Phase comb filtering (`500 Hz` spacing), secondary reflection spike on the **Impulse / ETC** plot. |
| `noisy-crowd` | **5. Noisy Venue / FOH Crowd Noise** | PA response buried in loud uncorrelated ambient/crowd noise (`-16 dBFS`) | Coherence ($\gamma^2$) alpha fading and **$H_1$ FIFO/LPF averaging** recovering the transfer function from noise. |
| `feedback-ring-demo` | **6. Live Show Feedback Ring (2.5 kHz & 630 Hz)** | Live FOH/Monitor mix with a `2.48 kHz` feedback howl (`+16 dB`) and `630 Hz` stage ring (`+11.5 dB`) | Multi-stage narrowband **Feedback Detector**, musical pitch + ISO 31-band GEQ callouts, and one-click `Cut Notch`. |
