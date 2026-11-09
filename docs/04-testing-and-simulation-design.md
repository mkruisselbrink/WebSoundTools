# 04. Automated Testing & Virtual Acoustic Simulator

## 1. Design Philosophy: "Testable by Construction"

Audio and graphics applications are difficult to test when DSP math, state management, Web Audio nodes, and `<canvas>` rendering calls are tightly coupled. `WebSoundMeter` enforces clean architectural boundaries so that every subsystem is covered by automated tests:

1. **Pure TypeScript Functional DSP Core (`src/dsp/`)**:
   - Every math and signal-processing module (`fft.ts`, `window-functions.ts`, `biquad.ts`, `transfer-function.ts`, `deconvolution.ts`, `smoothing.ts`, `weighting-meters.ts`, `calibration.ts`, `signal-generator.ts`, `analyzer-pipeline.ts`) operates purely on `Float32Array` buffers with zero DOM or Web Audio dependencies.
2. **Extracted Pure UI & State Controllers (`src/sources/`, `src/charts/`, `src/ui/`)**:
   - Complex state machines—such as `SourceStore`, `ChartInteractionController`, `url-state.ts`, `workspace-session.ts`, `session-storage.ts`, and `keyboard-shortcuts.ts`—are isolated into standalone TypeScript modules with fast unit tests.
3. **First-Class Simulated Acoustic Rig (`src/dsp/synthetic-rig.ts`)**:
   - The same mathematical acoustic simulator that powers the interactive **Built-in Demo Simulator** in the browser UI also runs deterministically in unit, integration, and Playwright E2E tests.

---

## 2. Automated Test Suite Architecture

Run all unit and integration tests via `npm test` (`npx vitest run`) and full browser E2E tests via `npm run test:e2e` (`npx playwright test`).

### 2.1 Unit Test Suites (`tests/unit/` — 21 Suites)

| Test Suite | Module Under Test | What It Verifies |
| :--- | :--- | :--- |
| `sw-offline.test.ts` | `src/pwa/sw-core.ts`, `register-sw.ts` | Offline precaching, old cache cleanup, parameterized navigation URL fallback (`/?layout=...`) to cached `/index.html`, Cache-First static asset serving, and `COOP`/`COEP` header preservation. |
| `fft.test.ts` | `src/dsp/fft.ts` | Impulse flatness, bin-centered sinusoid amplitude/phase recovery, `IFFT(FFT(x))` invertibility ($< 10^{-5}$ error), and Parseval's energy theorem. |
| `window-functions.test.ts` | `src/dsp/window-functions.ts` | Window symmetry, endpoint tapering, and coherent gain normalization for `Hann`, `Hamming`, `Blackman`, `FlatTop`, and `Rectangular`. |
| `biquad.test.ts` | `src/dsp/biquad.ts` | RBJ Audio EQ Cookbook coefficients, analytical transfer function evaluation $H(e^{j\omega})$, and Linkwitz-Riley (`LR24`) crossover summation. |
| `transfer-function.test.ts` | `src/dsp/transfer-function.ts` | $H_1$ and OSM transfer function recovery ($\pm 0.05\text{ dB}$ magnitude, $\pm 0.5^\circ$ phase), complex vector phase wrap-around averaging at $\pm 180^\circ$, coherence $\gamma^2(f)$ vs. theoretical SNR, and Bessel LPF averaging. |
| `deconvolution.test.ts` | `src/dsp/deconvolution.ts` | Zero-error integer sample delay detection, sub-sample parabolic interpolation ($\pm 0.05$ samples), polarity inversion detection, and Step Response integration. |
| `smoothing.test.ts` | `src/dsp/smoothing.ts` | $O(1)$ prefix-sum fractional-octave smoothing (`1/1` to `1/48` oct) energy preservation and unit-vector complex phase smoothing across $\pm 180^\circ$. |
| `weighting-meters.test.ts` | `src/dsp/weighting-meters.ts` | IEC 61672 Class 1 A/C/Z frequency response across ISO third-octave frequencies and Fast/Slow/Impulse/$L_{\text{eq}}$/Peak ballistics. |
| `calibration.test.ts` | `src/dsp/calibration.ts` | Parsing of 2-column and 3-column `.cal`/`.txt`/`.frd` files and log-frequency magnitude/phase interpolation. |
| `signal-generator.test.ts` | `src/dsp/signal-generator.ts` | White noise, Voss-McCartney pink noise ($-3\text{ dB/octave}$ spectral slope), sine wave frequency accuracy, and logarithmic sweep synthesis. |
| `sources.test.ts` | `src/sources/eq-source.ts`, `union-source.ts` | Virtual Parametric EQ cascading & inverse-EQ speaker flattening; Math Union vector average phase cancellation, power average, subtract, min, and max. |
| `source-store.test.ts` | `src/sources/source-store.ts` | Capturing live/fallback traces, updating stored trace offsets, adding/updating Virtual EQ bands, Math Union evaluation, and IndexedDB persistence hooks. |
| `session-storage.test.ts` | `src/sources/session-storage.ts` | IndexedDB v2 CRUD round-trips for `stored-traces`, `eq-sources`, `union-sources`, and `calibration-curves`. |
| `workspace-session.test.ts` | `src/sources/workspace-session.ts` | `localStorage` serialization, validation, and corrupted-JSON fallback for DSP config, generator config, calibration ID, and hardware audio routing. |
| `url-state.test.ts` | `src/ui/url-state.ts` | URL query parsing, default-omitting serialization (`?layout`, `plots`, `mode`, `preset=hw`, `spl`, `src`), and `pushState`/`replaceState` history sync. |
| `plot-types.test.ts` | `src/charts/plot-types.ts` | Log-frequency and linear-time coordinate conversions, Group Delay derivative $-\frac{d\phi}{d\omega}$, and Crest Factor dB extraction. |
| `chart-interaction.test.ts` | `src/charts/chart-interaction.ts` | Cursor readout hit-testing, Y-axis wheel zoom & drag pan, and interactive EQ node hit-testing, frequency/gain dragging, and `Shift`+wheel $Q$ adjustment. |
| `canvas-and-gl-renderers.test.ts` | `src/charts/canvas-chart-painter.ts`, `gl-trace-renderer.ts` | 2D Canvas rendering across all 8 plot types (with EQ handles & cursors) and WebGL2 shader compilation, buffer upload, coherence alpha, and phase-wrap splitting. |
| `keyboard-shortcuts.test.ts` | `src/ui/keyboard-shortcuts.ts` | Shortcut dispatch (`Space`, `C`, `D`, `R`, `E`, `U`, `1`–`3`, `Escape`) and Shadow DOM input retargeting protection via `composedPath()`. |
| `audio-engine-and-router.test.ts` | `src/audio/audio-engine.ts`, `hardware-audio-router.ts` | Worker message coordination, hardware `getUserMedia` constraints (`echoCancellation: false`), channel splitter/merger routing, and pause/resume propagation. |
| `capture-worklet-and-worker.test.ts` | `src/audio/worklets/capture-worklet.ts`, `dsp.worker.ts` | `CaptureTapProcessor` SPSC `SharedArrayBuffer` ring buffer & `MessagePort` fallback, pause output muting, and DSP Worker tick orchestration. |

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

The Input selector in the top bar includes **5 interactive acoustic presets** under `Built-in Demo Simulator`:

| Preset ID | Display Name | What It Simulates | Features It Showcases |
| :--- | :--- | :--- | :--- |
| `flat-delayed` | **1. Flat PA (11.5 ms Delay)** | Ideal flat speaker at `11.5 ms` (`3.95 m`) air delay + `-42 dB` room noise floor | Auto Delay Finder (`11.50 ms`), Phase flattening once delay is matched, clean Impulse peak at `0 ms`. |
| `room-modes` | **2. Room Modes + HF Roll-off** | Main PA at `8.2 ms` with `+6.5 dB` boom at `140 Hz`, `-4.5 dB` dip at `650 Hz`, and HF loss above `8 kHz` | Transfer Function Magnitude/Phase, capturing a baseline trace, and designing a corrective **Virtual Parametric EQ**. |
| `sub-top-misaligned` | **3. Sub + Top Misaligned (100 Hz)** | 2-way `100 Hz` LR24 crossover where the Subwoofer is delayed by `+4.5 ms` and polarity-inverted | Deep crossover cancellation notch at `100 Hz`, phase slope inspection, polarity inversion, and delay alignment. |
| `comb-filtering` | **4. Stage Monitor Floor Bounce** | Main wedge at `5.0 ms` + strong floor reflection at `+2.2 ms` (`-3.5 dB`) | Severe Magnitude/Phase comb filtering (454 Hz spacing), secondary reflection spike on the **Impulse** plot. |
| `noisy-crowd` | **5. Noisy Venue (Low SNR)** | PA response buried in loud uncorrelated ambient/crowd noise (`+2 dB` SNR) | Coherence ($\gamma^2$) alpha fading and the power of **$H_1$ FIFO/Bessel averaging** to recover the true transfer function from noise. |
