# 03. Implementation Plan, Project Structure & Roadmap

## 1. Design Decisions (Resolved from Discussion)

Based on your feedback:
1. **Primary Target**: A combination of **PA / sound system alignment & EQ tuning** (Transfer Function, Phase, Coherence, Auto Delay Finder, Virtual EQ) and **live mixing RTA / SPL monitoring** (Fractional-octave RTA + calibrated A/C/Z Fast/Slow/Leq broadband metering in the primary view).
2. **Transform Strategy**: Start with **Fixed Radix-2 FFT sizes (`1024` to `65536`)** in Phase 1; add Log Fourier Transform / Multi-Time Window (`LFT` / `MTW`) in Phase 2.
3. **UI Layout**: Use the **simpler, cleaner Open Sound Meter style layout**—a persistent top bar (Generator controls + Audio I/O & Demo Simulator selector + live broadband SPL/Leq readout), a main area with 1–3 stacked charts, and a collapsible right-hand Source list with an inline/slide-out properties panel.
4. **Pure TypeScript DSP + Licensing**:
   - Implement the entire DSP engine in **pure TypeScript (`Float32Array`)** inside a dedicated Web Worker, avoiding C++/WASM build complexity unless a specific bottleneck ever requires it.
   - Write all DSP algorithms cleanly from standard textbook equations (Cooley–Tukey FFT, RBJ Audio EQ Cookbook biquads, IEC 61672 weighting, Bendat & Piersol $H_1$ cross-spectral transfer function) so the codebase stays self-contained, testable, and license-clean (see [`01-overview-and-comparison.md` §5](./01-overview-and-comparison.md#5-licensing--clean-room-dsp-considerations)).
5. **Automated Testing for ~Everything & Built-in Demo Simulator**:
   - Every DSP module, virtual source, worker pipeline, and UI component is backed by automated tests (`Vitest` + `Playwright`), and a **Built-in Virtual Acoustic Rig (PA/Room Simulator)** is included from Phase 0/1 so every feature can be demoed and tested without external audio hardware (detailed in [`04-testing-and-simulation-design.md`](./04-testing-and-simulation-design.md)).

---

## 2. Recommended Technology Stack

| Layer | Choice | Rationale |
| :--- | :--- | :--- |
| **Build Tool & Dev Server** | **Vite** + TypeScript | Native support for `AudioWorklet` & `Web Worker` bundling, fast HMR, and `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers for `SharedArrayBuffer`. |
| **Unit & Component Testing** | **Vitest** (`@vitest/browser`) | Instant Node/V8 execution for pure TypeScript DSP math tests + headless browser mode for Lit Web Components and Worker integration tests. |
| **E2E & Visual Testing** | **Playwright** | Full browser automation with WebGL2 canvas screenshot comparisons and end-to-end user flows driven by the built-in Acoustic Simulator. |
| **UI Components** | **Lit 3** (`lit`) | Already in `package.json`. Zero-overhead Web Components, ideal for chart viewports, sidebar source items, and high-frequency meter updates. |
| **Audio Capture, Sim & Gen** | **Web Audio API + `AudioWorklet`** | Extends [`noise-worklet.ts`](../audio-worklets/noise-worklet.ts), adds `capture-worklet.ts` (`SharedArrayBuffer` ring buffer), and includes `simulator-rig.ts` for hardware-free PA/room simulation. |
| **DSP Engine** | **Dedicated Web Worker (Pure TS)** | Runs off the main UI thread and off the 2.67ms audio thread. Pure TypeScript over `Float32Array` easily runs 16k–64k FFT + Deconvolution + Coherence + SPL/Leq at 30 Hz. |
| **Chart Rendering** | **WebGL2 + 2D Canvas Overlay** | Custom WebGL2 renderer for traces, RTA bars, coherence alpha, phase wrap handling, and spectrograms; 2D Canvas overlay for crisp text, log grids, cursors, and interactive EQ nodes. |
| **Local Persistence** | **`IndexedDB`** + File/Blob API | Auto-saves workspace layout, generator state, measurement configs, `.cal` calibration curves, and stored traces (`Stored` sources) locally in the browser. |

---

## 3. Proposed Directory Structure

```text
WebSoundMeter/
├── index.html
├── vite.config.ts               # Configures COOP/COEP headers & Vitest config
├── playwright.config.ts         # E2E & WebGL visual regression config
├── package.json
├── tsconfig.json
├── docs/
│   ├── 01-overview-and-comparison.md
│   ├── 02-architecture-and-dsp-design.md
│   ├── 03-roadmap-and-implementation-plan.md
│   └── 04-testing-and-simulation-design.md
├── src/
│   ├── main.ts                  # App bootstrap
│   ├── audio/
│   │   ├── audio-engine.ts      # AudioContext, device enumeration, raw getUserMedia, routing
│   │   ├── generator-manager.ts # Signal generator controller (Pink, White, Sine, Sweep, Burst)
│   │   ├── simulator-rig.ts     # Web Audio Virtual PA/Room Simulator (delay, crossover, reflections, noise)
│   │   ├── ring-buffer.ts       # Lock-free SPSC RingBuffer backed by SharedArrayBuffer
│   │   └── worklets/
│   │       ├── generator-worklet.ts  # Evolved from audio-worklets/noise-worklet.ts
│   │       └── capture-worklet.ts    # Taps [M, R] channels into SharedArrayBuffer
│   ├── dsp/                     # 100% Pure TypeScript (Zero DOM/WebAudio deps → Fast Unit Tests)
│   │   ├── dsp.worker.ts        # Background DSP orchestrator running at ~25-30 Hz
│   │   ├── synthetic-rig.ts     # Deterministic sample-accurate PA/Room simulator for unit tests
│   │   ├── fft.ts               # Radix-2 FFT / IFFT & Window functions (Hann, Blackman, FlatTop...)
│   │   ├── biquad.ts            # RBJ Cookbook biquads (PEQ, shelves, crossover, notch) + H(e^jw) eval
│   │   ├── transfer-function.ts # H1 cross-spectrum, magnitude, complex phase, coherence
│   │   ├── deconvolution.ts     # Impulse response IFFT, Step response, & 64k Auto Delay Finder
│   │   ├── averaging.ts         # FIFO ring-buffer & Exponential / 4th-order Bessel LPF averaging
│   │   ├── smoothing.ts         # O(1) prefix-sum fractional-octave smoothing (1/1 .. 1/48 oct)
│   │   ├── weighting-meters.ts  # IEC 61672 A/C/Z filters, Fast/Slow/Peak/Leq broadband meters
│   │   └── calibration.ts       # .cal/.txt parser & log-frequency interpolator
│   ├── sources/                 # Unified SourceData & Virtual Sources
│   │   ├── source-data.ts       # Unified SoA Float32Array data model (FTData, TimeData, Levels)
│   │   ├── base-source.ts       # Common properties: uuid, name, color, active, visible
│   │   ├── measurement-source.ts# Live measurement configuration & state
│   │   ├── stored-source.ts     # Frozen trace snapshot + notes + gain/delay offset
│   │   ├── union-source.ts      # Trace math: Vector Avg, Power Avg, A-B Subtract, Min, Max
│   │   └── eq-source.ts         # Virtual Parametric EQ & Crossover modeling source
│   ├── charts/
│   │   ├── chart-container.ts   # Lit wrapper: plot type switcher, axis range controls, cursors
│   │   ├── gl-renderer.ts       # WebGL2 trace, bar, coherence-alpha, phase-wrap & spectrogram
│   │   ├── grid-overlay.ts      # 2D Canvas log/linear grid, labels, crosshair readouts
│   │   └── plots/               # Plot-specific coordinate mappers & shaders
│   │       ├── rta-plot.ts
│   │       ├── magnitude-plot.ts
│   │       ├── phase-plot.ts
│   │       ├── coherence-plot.ts
│   │       ├── impulse-plot.ts
│   │       ├── level-history-plot.ts
│   │       └── spectrogram-plot.ts
│   └── ui/
│       ├── app-shell.ts         # Simple OSM-style layout: Top Bar (Gen + Sim + SPL), Charts, Sidebar
│       ├── spl-meter-bar.ts     # Always-visible A/C/Z Fast/Slow/Leq/Peak numeric + bar readout
│       ├── simulator-panel.ts   # Preset selector & live controls for Demo Mode
│       ├── source-sidebar.ts    # Source list (Live, Stored, Math, EQ) with color/visibility toggles
│       └── properties-drawer.ts # Context-sensitive settings for selected Source or Chart
└── tests/
    ├── unit/                    # Tier 1: Fast Vitest DSP & Source Math tests
    │   ├── fft.test.ts
    │   ├── biquad.test.ts
    │   ├── transfer-function.test.ts
    │   ├── coherence.test.ts
    │   ├── deconvolution.test.ts
    │   ├── weighting-meters.test.ts
    │   ├── smoothing.test.ts
    │   └── sources.test.ts
    ├── integration/             # Tier 2 & 3: RingBuffer, Worker & Lit Component tests
    │   ├── ring-buffer.test.ts
    │   ├── dsp-worker.test.ts
    │   └── ui-components.test.ts
    └── e2e/                     # Tier 4: Playwright E2E + WebGL visual tests using Demo Simulator
        ├── demo-simulator.spec.ts
        └── charts-visual.spec.ts
```

---

## 4. Phased Implementation Roadmap

### Phase 0: Tooling, Test Harness & Audio/Simulator Pipeline
1. **Vite + Vitest + Playwright Setup**:
   - Configure `vite.config.ts` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so `SharedArrayBuffer` works seamlessly in dev, preview, and test modes.
   - Set up `npm test` (`vitest`) and `npm run test:e2e` (`playwright`).
2. **Lock-Free `RingBuffer` & Pure-TS Synthetic Test Rig**:
   - Implement `src/audio/ring-buffer.ts` + `tests/integration/ring-buffer.test.ts`.
   - Implement `src/dsp/biquad.ts` and `src/dsp/synthetic-rig.ts` so every subsequent DSP module can be tested against known synthetic speakers/rooms immediately.
3. **Audio Engine & Web Audio Demo Simulator (`simulator-rig.ts`)**:
   - Build `AudioEngine` supporting both real multi-channel `getUserMedia` devices (with `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`) and the **Built-in Demo Simulator** (with presets for Flat Delayed, Room Modes, Sub+Top Crossover, Comb Filtering, and Noisy Venue).

### Phase 1: Core PA Alignment & Live Mixing RTA/SPL MVP
1. **Pure-TS DSP Core + Exhaustive Unit Tests (`src/dsp/`)**:
   - Fixed Radix-2 FFT (`1024` to `65536`) + Windows (`Hann`, `Hamming`, `Blackman`, `FlatTop`, `Rectangular`) + `fft.test.ts`.
   - Dual-channel Transfer Function ($H_1(f) = \langle G_{rm} \rangle / \langle G_{rr} \rangle$), Complex Phase, and Coherence ($\gamma^2(f)$) + `transfer-function.test.ts` & `coherence.test.ts`.
   - Temporal averaging (`Off`, `FIFO`, Exponential/`LPF`) and $O(1)$ prefix-sum fractional-octave smoothing (`1/1` to `1/48` oct) + `smoothing.test.ts`.
   - Deconvolution Impulse Response ($h(t)$ linear % and ETC dB) + **Auto Delay Finder** (with sub-sample parabolic interpolation) + `deconvolution.test.ts`.
   - **Broadband SPL / Leq Metering**: IEC 61672 A/C/Z weighting biquads, Fast (125 ms), Slow (1000 ms), Peak, and $L_{\text{eq}}$ integration + `weighting-meters.test.ts`.
2. **Hybrid WebGL2 + 2D Overlay Chart Engine (`src/charts/`)**:
   - Build `<chart-container>` with pan/zoom, logarithmic/linear grid overlay, and interactive cursor readouts (Hz, ms, wavelength, dB, Phase, Coherence).
   - Implement the 5 core live plots:
     1. **RTA / Spectrum** (Line + Fractional-Octave Bars + Peak Hold)
     2. **Magnitude** (dB vs. Log Hz, with Coherence alpha fade/blanking)
     3. **Phase** (Wrapped $\pm 180^\circ$ vs. Log Hz, with wrap-jump suppression & Coherence alpha)
     4. **Coherence** (0–100% vs. Log Hz)
     5. **Impulse / ETC** (Amplitude % or dB vs. ms)
3. **Simple OSM-Style App Shell, Stored Traces & Calibration (`src/ui/`)**:
   - Top bar with Signal Generator, Input/Simulator Preset selector, **"Find & Apply Delay"** button, and live **SPL / Leq / Peak Meter Bar**.
   - Collapsible right sidebar for Sources (Live Measurement + captured `Stored` traces), `IndexedDB` session persistence, and `.cal` / `.txt` mic calibration import.
   - Playwright E2E test suite verifying the full PA alignment and RTA/SPL workflow using the Demo Simulator.

### Phase 2: Virtual EQ, Trace Math, Spectrogram & SPL History
1. **Virtual Parametric EQ (`EqualizerSource`) & Crossover Modeling**:
   - Interactive EQ nodes draggable directly on the Magnitude chart, showing the predicted combined Magnitude and Phase response on any live or stored trace in real time.
2. **Trace Math (`UnionSource`) & IR Time Windowing (`WindowingSource`)**:
   - Vector average multiple mic positions (e.g., FOH spatial average), compute $A - B$ difference, and apply reflection-free time gating to Impulse Responses.
3. **Live Mixing Monitoring Additions**:
   - Scrolling **Spectrogram (Waterfall)** plot and scrolling **SPL / Leq Level History** strip chart with configurable threshold alerts.
4. **Log Fourier Transform / Multi-Time Window (`LFT` / `MTW`)**:
   - Add multi-window log-frequency resolution mode alongside fixed FFT sizes.
5. **Expanded Signal Generators**:
   - Logarithmic Sine Sweep, Burst Noise, Brown Noise, and shaped high-crest-factor noise.
