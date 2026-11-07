# 01. Investigation, Feature Comparison & Product Vision

## 1. Assessment of the Current Prototype (`WebSoundMeter`)

### What Exists Today
The current workspace is an early proof-of-concept built with **TypeScript** and **Lit 3** (`lit-element`):
- **[`NOTES.md`](../NOTES.md)**: Captures the right high-level instinct:
  - Web Audio nodes for sources
  - Web Audio worklets for signal generators
  - Custom analyzer worklet writing into a `SharedArrayBuffer`
- **[`audio-worklets/noise-worklet.ts`](../audio-worklets/noise-worklet.ts) & [`utils.ts`](../audio-worklets/utils.ts)**: Implements a `WhiteNoiseGenerator` and a Voss-McCartney `PinkNoiseGenerator` as `AudioWorkletProcessor`s using a deterministic LCG pseudo-random generator and trailing-zero bit-ops (`ctrz`). **This is solid and reusable.**
- **[`main.ts`](../main.ts)**: Sets up an `AudioContext`, a `GeneratorManager` that switches between Sine (`OscillatorNode`), Pink Noise, and White Noise using `GainNode`s, and connects the output to a standard Web Audio `AnalyserNode` (`fftSize = 16384`).
- **[`src/time_chart.ts`](../src/time_chart.ts) & [`src/number_input.ts`](../src/number_input.ts)**: Implements Lit web components (`LineChartElement`, `TimeChartElement`, `FrequencyChartElement`) that poll `analyser.getFloatTimeDomainData()` and `analyser.getFloatFrequencyData()` inside a `requestAnimationFrame` loop and draw to a 2D `<canvas>`.

### Why the Prototype Stalled (Architectural Bottlenecks)
1. **Web Audio's `AnalyserNode` is a Dead End for System Tuning**:
   - `AnalyserNode` only computes single-channel magnitude (`getFloatFrequencyData`) and discards all **complex phase** information.
   - Because phase and complex cross-spectra are unavailable, `AnalyserNode` **cannot** compute:
     - **Transfer Function** (Magnitude & Phase of Measurement $M$ relative to Reference $R$)
     - **Coherence** ($\gamma^2(f)$)
     - **Impulse Response / Step Response** (via frequency-domain deconvolution + IFFT)
     - **Propagation Delay Estimation** (cross-correlation delay finder)
     - **Log Fourier Transform (LFT) / Multi-Time Window (MTW)** (logarithmically spaced frequency bins with frequency-dependent window lengths)
     - **Complex Vector Averaging** or **Bessel Low-Pass Filtering** per bin
   - Additionally, `AnalyserNode` has a hardcoded Blackman window, a maximum `fftSize` of `32768`, and no sample-accurate synchronization between two channels.
2. **Missing Audio Input & Reference Routing**:
   - There is no `navigator.mediaDevices.getUserMedia()` integration yet.
   - Browsers enable `echoCancellation`, `noiseSuppression`, and `autoGainControl` by default on microphone inputs, which destroys acoustic measurements unless explicitly disabled.
   - A real measurement tool must route arbitrary channels from a multi-channel USB/Thunderbolt audio interface (e.g., Channel 1 = Mic, Channel 2 = Console Loopback) **or** use an internal digital reference directly from the built-in signal generator.
3. **2D Canvas Rendering Limits**:
   - Drawing 8,192+ points per trace on a CPU-bound 2D `<canvas>` struggles when rendering multiple live and stored traces, coherence-weighted opacity per frequency bin, phase wrap-around jumps at $\pm 180^\circ$, and scrolling spectrograms at 60 FPS.
4. **Build Ergonomics**:
   - Relying on raw `tsc --build` and manual `<script type="importmap">` in [`test.html`](../test.html) makes importing libraries, bundling AudioWorklets/Web Workers, and configuring `SharedArrayBuffer` headers (`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`) cumbersome.

---

## 2. Deep Dive: How Open Sound Meter (`osm/`) Works

Open Sound Meter (v1.4.1 in `osm/`) is a C++17 / Qt5.15 / OpenGL & Metal application with a remarkably clean and extensible architecture.

### 2.1 The Unified `Abstract::Data` & `Abstract::Source` Pattern
The foundational design insight in OSM (`osm/src/abstract/data.h` and `osm/src/abstract/source.h`) is that **every data producer in the application shares a single uniform data structure**:

```
Abstract::Data
 ├── m_ftdata: vector<FTData>          (Frequency Domain)
 │    ├── frequency   (Hz)
 │    ├── module      (linear amplitude of Measurement channel → RTA / Spectrum)
 │    ├── magnitude   (linear transfer function |M(f)| / |R(f)| → Magnitude dB)
 │    ├── phase       (Complex unit vector e^(i(φ_M - φ_R)) → Phase / Group Delay)
 │    ├── coherence   (0.0 .. 1.0 → Coherence plot & trace alpha weighting)
 │    ├── peakSquared (per-bin peak hold squared → RTA Peak & Crest Factor)
 │    └── meanSquared (per-bin RMS squared → Crest Factor)
 ├── m_impulseData: vector<TimeData>   (Time Domain / Deconvolution)
 │    ├── time        (ms, centered around 0 ms)
 │    └── value       (Complex/real impulse amplitude → Impulse / Step / ETC)
 └── m_levelsData: LevelsData          (Broadband Metering)
      ├── levels[(Weighting::A|C|Z, Meter::Fast|Slow|Impulse|Leq)]
      ├── peaks[(Weighting::A|C|Z, ...)]
      └── referenceLevel (dBFS)
```

Because **every chart only reads `Abstract::Source` (which extends `Abstract::Data`)**, OSM can treat all of the following as interchangeable "Sources" in its sidebar (`osm/src/source/`):
1. **`Measurement`**: Live dual-channel (or internal-reference) analyzer running on an 80ms (12.5 Hz) transform timer (`osm/src/source/measurement.cpp`).
2. **`Stored`**: A frozen snapshot of any source's `Abstract::Data`, complete with user notes, gain offset, delay offset, and JSON serialization.
3. **`Union` (Math Source)**: Combines multiple sources in real time using vector average, power average, sum, difference ($A - B$), minimum, or maximum.
4. **`Equalizer` (Virtual EQ)**: Applies a chain of parametric biquad filters to any source's transfer function, letting the engineer design an EQ curve against a live or stored trace and see the predicted resulting magnitude, phase, and impulse response immediately.
5. **`FilterSource` (Virtual Crossover)**: Generates or applies standard crossover filters (Butterworth, Linkwitz-Riley, Bessel, APF) for phase alignment modeling.
6. **`SourceWindowing`**: Applies a time-domain window to an existing source's Impulse Response and re-computes the FFT to yield reflection-free frequency/phase responses.
7. **`StandardLine` & `TargetTrace`**: Reference curves (Equal Loudness Contours, X-Curve, custom target bands).
8. **`RemoteItem`**: Networked measurements streamed from another OSM instance over TCP/UDP.

### 2.2 OSM's DSP Pipeline (`osm/src/math/` & `measurement.cpp`)
- **Circular Buffers & Delay Compensation**:
  - Incoming audio writes into `m_data` (Measurement) and `m_reference` (Reference) circular buffers (`65536` samples), plus `m_loopBuffer` for the internal generator loopback.
  - Delay compensation shifts one buffer relative to the other by `m_delay` samples.
- **Fourier Transform Modes (`FourierTransform`)**:
  - **Fast (Fixed Radix-2 FFT)**: Powers of 2 from $2^{10}$ (`1024`) to $2^{16}$ (`65536`), with DC offset removal and selectable window functions (`Rectangular`, `Hann`, `Hamming`, `Blackman`, `FlatTop`, etc.).
  - **LFT (Log Fourier Transform)**: Computes **24 points per octave across 11 octaves** (264 log-spaced frequencies) by evaluating precomputed complex basis vectors (`m_logBasis`) whose window length $N_i$ shrinks logarithmically as frequency increases (starting from $N = 65536$ at low frequencies down to short windows at high frequencies). This eliminates the classic fixed-FFT tradeoff between low-frequency resolution and high-frequency time smearing.
- **Temporal Averaging**:
  - **Off**: Instantaneous frame.
  - **FIFO**: Rolling ring buffer of the last $N$ frames for `module`, `magnitude`, `phase` (averaged as complex vectors so $\pm 180^\circ$ wrap-around never averages to $0^\circ$), and `impulse`.
  - **LPF**: 4th-order **Bessel Low-Pass Filter** (`BesselLPF` at 0.25 Hz, 0.5 Hz, or 1 Hz) per frequency bin and per impulse sample.
- **Coherence (`Coherence`)**:
  - Tracks auto-spectra $G_{rr}(f) = |R(f)|^2$, $G_{mm}(f) = |M(f)|^2$, and cross-spectrum $G_{rm}(f) = R^*(f)M(f)$ over a rolling window (depth 21):
    $$\gamma(f) = \frac{\left|\sum G_{rm}(f)\right|}{\sqrt{\sum G_{rr}(f) \cdot \sum G_{mm}(f)}}$$
- **Deconvolution & Auto Delay Finder (`Deconvolution`)**:
  - Computes point-wise complex division $H(f) = M(f) / R(f)$ in the frequency domain, applies an inverse FFT, and circularly shifts $t = 0$ to the center of the window.
  - A secondary $2^{16}$-point `m_delayFinder` deconvolution runs every 25 transform cycles (~2s) and finds the peak index (`maxIndex()`) to report the estimated propagation delay and delta.
- **GPU Shader Rendering (`osm/shaders/` & `osm/src/chart/opengl/`)**:
  - OSM renders all 14 plot types (`RTA`, `Magnitude`, `Phase`, `Impulse`, `Step`, `Coherence`, `GroupDelay`, `PhaseDelay`, `Spectrogram`, `CrestFactor`, `Nyquist`, `Scope`, `Level`, `SPL`) using OpenGL/Metal shaders.
  - Geometry/vertex shaders convert linear frequency bins to log-X coordinates on the GPU, handle phase wrap-around without drawing vertical jump lines across the chart, and map per-bin `coherence` directly to vertex alpha opacity.

---

## 3. What Smaart Adds Beyond OSM

While OSM covers the core live-sound tuning workflow admirably, **Rational Acoustics Smaart (v8 / v9)** sets the industry standard in several additional areas worth considering in our design:

1. **Multi-Time Window (MTW) via Cascaded Multi-Rate FFTs**:
   - Instead of computing a direct DFT dot-product per log frequency (which can be CPU-heavy at 264+ bins), Smaart's MTW uses a **multi-rate decimation filterbank** (recursively low-pass filtering and downsampling by 2× per octave) and runs small, fast radix-2 FFTs on each octave band. This achieves 1/48th-octave resolution from 20 Hz to 20 kHz with very low CPU usage.
2. **True $H_1(f)$ Cross-Spectral Transfer Function**:
   - In OSM (`measurement.cpp:576`), `magnitude` is computed per frame as $|M(f)| / |R(f)|$ and then averaged. In noisy environments, uncorrelated background noise in $M(f)$ biases $|M(f)| / |R(f)|$ upward even when averaged.
   - Smaart computes the classic **$H_1$ estimator** using averaged cross-spectrum over auto-spectrum:
     $$H_1(f) = \frac{\langle G_{rm}(f) \rangle}{\langle G_{rr}(f) \rangle} = \frac{\sum_{k} R_k^*(f) M_k(f)}{\sum_{k} |R_k(f)|^2}$$
     Because uncorrelated noise has random phase relative to $R(f)$, $\sum R_k^*(f) N_k(f) \to 0$ as averages accumulate, actively rejecting room/crowd noise from both magnitude and phase!
3. **Fractional-Octave Frequency Smoothing (1/1 to 1/48 Octave)**:
   - Smaart allows dynamic post-FFT fractional-octave smoothing (e.g., 1/3, 1/6, 1/12, 1/24, 1/48 octave) on Magnitude, Phase, and RTA traces without re-running the transform.
4. **Live IR (LIR) Mini-Pane + Coherence Blanking Threshold**:
   - Smaart allows a hard or soft **Coherence Blanking threshold** (e.g., hide or fade trace segments wherever $\gamma^2(f) < 40\%$) and docks a live Envelope Time Curve (ETC / dB Impulse) mini-view alongside the Transfer Function.
5. **Dedicated Acoustic IR Analysis Mode**:
   - Post-processing of captured Impulse Responses for room acoustics: Schroeder backward integration, **RT60 ($T_{20}, T_{30}$, EDT)**, **Clarity ($C_{50}, C_{80}$)**, **Definition ($D_{50}$)**, and **STI (Speech Transmission Index)**.
6. **Dedicated SPL / Leq Exposure & Logging Mode**:
   - Long-term time-history logging of $L_{\text{Aeq}, T}$, $L_{\text{Ceq}, T}$, $L_{\text{C}-\text{A}}$, Peak, and noise dose exposure with configurable averaging windows (e.g., $L_{\text{eq}, 1\text{m}}$, $L_{\text{eq}, 15\text{m}}$, $L_{\text{eq}, 60\text{m}}$) and threshold alerts.

---

## 4. Feature Comparison Matrix

| Capability | Current Prototype | Open Sound Meter (`osm/`) | Smaart Suite | Proposed `WebSoundMeter` Target |
| :--- | :---: | :---: | :---: | :---: |
| **Single-Channel RTA / Spectrum** | Basic (AnalyserNode) | Line, Octave Bars, Peak, Crest | Line, Bars, Spectrograph, Multi-input | **Phase 1 (Core MVP)** |
| **Dual-Channel Transfer Function (Mag + Phase)** | No | $|M|/|R|$ + Complex Phase | $H_1 = G_{rm}/G_{rr}$ | **Phase 1 ($H_1$ + OSM modes)** |
| **Coherence ($\gamma^2$) & Alpha Weighting** | No | Rolling window + Shader Alpha | Rolling window + Blanking/Alpha | **Phase 1 (Core MVP)** |
| **Impulse Response / Deconvolution & ETC** | No | IFFT of $M/R$ + Step | Live IR + Full IR Acoustic Mode | **Phase 1 (Live IR) / Phase 3 (RT60)** |
| **Auto Delay Finder** | No | $2^{16}$ Deconvolution peak | Cross-correlation + Delay Tracker | **Phase 1 (Core MVP)** |
| **Log-Frequency / Multi-Time Window (LFT/MTW)** | No | 24 PPO Log DFT (`LFT`) | 48 PPO Multi-rate FFT (`MTW`) | **Phase 2** |
| **Averaging (FIFO, Exponential/LPF, Infinite)** | No | FIFO & 4th-order Bessel LPF | FIFO, EMA, Infinite | **Phase 1 (FIFO + EMA/Bessel)** |
| **Fractional-Octave Smoothing** | No | On RTA bars | 1/1 to 1/48 oct on all traces | **Phase 1** |
| **Stored Traces & Session Persistence** | No | JSON + Stored Source | `.trc` / `.ref` files | **Phase 1 (IndexedDB + JSON/CSV)** |
| **Virtual Sources (Math/Union, Virtual EQ, IR Window)** | No | `Union`, `Equalizer`, `Filter`, `Windowing` | Trace Math & Delay/Gain offsets | **Phase 2 (Huge differentiator!)** |
| **Signal Generator** | White, Pink, Sine | Pink, White, Brown, Sweep, M-Noise, Burst | Pink, P-Noise, Sweep, Dual-band | **Phase 1 (Core) / Phase 2 (Sweep/Burst)** |
| **SPL / Leq Metering & History** | No | A/C/Z, Fast/Slow/Leq + Level Plot | Full SPL Logger + Alarms + Dose | **Phase 1 (A/C/Z + Leq) / Phase 2 (History)** |
| **Mic Calibration (`.cal` / `.txt`)** | No | Mag + Phase interpolation | Mag + Phase + SPL Calibrator | **Phase 1** |
| **Built-in Simulated Acoustic Rig (Demo Mode)** | No | No | No (requires external loopback/files) | **Phase 1 (Core Web Advantage!)** |

---

## 5. Licensing & Clean-Room DSP Considerations

Open Sound Meter (`osm/LICENSE`) is licensed under the **GNU General Public License v3.0 (GPLv3)**.

We should be deliberate about how we use `osm/` as a reference:
1. **Standard Textbook DSP & Acoustic Formulas (Public Domain / Non-Copyrightable)**:
   - Radix-2 Cooley–Tukey FFT/IFFT, window functions (Hann, Hamming, Blackman, FlatTop), cross-spectral transfer function ($H_1(f) = \langle G_{rm} \rangle / \langle G_{rr} \rangle$), magnitude-squared coherence ($\gamma^2(f)$), Robert Bristow-Johnson (RBJ) Audio EQ Cookbook biquad filters, and IEC 61672 A/C weighting curves are standard mathematical equations. Writing these from scratch in idiomatic TypeScript over `Float32Array`s is completely independent of OSM's C++/SSE code.
2. **Project License Choice**:
   - **Option A (GPLv3)**: If we choose to license `WebSoundMeter` under **GPLv3**, we are free to directly adapt OSM's specific algorithms (such as its exact `LFT` basis parameterization or `SourceWindowing` heuristics) and UI workflows with proper copyright/attribution notices.
   - **Option B (Permissive — MIT / Apache-2.0)**: If you want `WebSoundMeter` to be MIT/Apache-licensed, we should treat `osm/` strictly as a feature/UX reference and implement all TypeScript DSP algorithms from standard textbook specifications (RBJ Cookbook, IEC 61672, Oppenheim & Schafer / Bendat & Piersol cross-spectral formulas).
3. **Trademarked Signals**:
   - Note that `osm/src/generator/mnoise.cpp` bundles a WAV file subject to Meyer Sound's M-Noise™ EULA and trademark restrictions. We should **not** copy `mnoise.wav` or use the "M-Noise" trademark; if we want a high-crest-factor music-like noise generator later, we can synthesize shaped crest-factor pink noise algorithmically under a generic name.

