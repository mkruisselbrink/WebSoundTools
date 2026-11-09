# 02. System Architecture & DSP Design

## 1. Three-Thread Real-Time Architecture

Web Audio's `AudioWorkletProcessor.process()` runs on a real-time audio thread in 128-sample quanta (~2.67 ms at 48 kHz). Running large FFTs and deconvolutions inside `process()` would cause audio dropouts. `WebSoundMeter` separates responsibilities across three execution contexts:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. AUDIO THREAD (Web Audio API / AudioWorkletGlobalScope - 128-sample tick)│
│                                                                            │
│  [Hardware Input] ──► [ChannelSplitterNode] ───────┬──────► [CaptureWorklet]
│                                                    │         (inputs[0]=M, │
│  [CaptureWorklet SignalGenerator] ──► [ChannelMergerNode]     inputs[1]=R) │
│   (Pink / White / Sine / Sweep)    └► [Physical Output]          │         │
└──────────────────────────────────────────────────────────────────┼─────────┘
                                                                   │
                    Lock-Free SPSC RingBuffer (SharedArrayBuffer)  │
                    or chunked Float32Array via MessagePort        │
                                                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. DSP WORKER THREAD (src/dsp/dsp.worker.ts - Pure TypeScript Float32Array)│
│                                                                            │
│  • Ingests hardware [M, R] blocks OR synthesizes blocks via                │
│    `SyntheticAcousticRig` when running in Built-in Demo Simulator mode     │
│  • Runs `AnalyzerPipeline` (`src/dsp/analyzer-pipeline.ts`):               │
│      - Input Filtering (A/C/Z weighting or 1 kHz Notch) & SPL/Leq Meters   │
│      - Sample-accurate Delay Compensation (`delayMs`) & Polarity/Gain      │
│      - Radix-2 FFT (1024..32768) with selectable Window Functions          │
│      - Transfer Function (`H1` cross-spectrum or `OSM` |M|/|R| + Bessel)   │
│      - Magnitude-Squared Coherence γ²(f), Peak Hold, Mean Squared          │
│      - Fractional-Octave Smoothing (O(1) prefix-sum integral array)        │
│      - Microphone Calibration curve interpolation (Mag dB & Phase deg)     │
│      - Regularized Deconvolution IFFT → Impulse & Step Response            │
│      - Auto Delay Finder (cross-correlation peak + parabolic interpolation)│
└──────────────────────────────────────────────────────────────────┬─────────┘
                                                                   │
                                       `SourceData` Frame Snapshot │
                                                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. UI & RENDERING THREAD (Main Thread - Lit 3 + WebGL2 / 2D Canvas)        │
│                                                                            │
│  • `<wsm-app-shell>` orchestrates Top Bar, Chart Panels, and Source Drawer │
│  • `SourceStore` evaluates Virtual EQ (`EqualizerSource`) and Math Union   │
│    (`UnionSource`) graphs whenever live or stored sources update           │
│  • `<wsm-chart-panel>` renders traces via WebGL2 (`GlTraceRenderer`) and   │
│    crisp logarithmic/linear grids, cursors, and interactive EQ handles     │
│    via 2D Canvas (`CanvasChartPainter`)                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Audio I/O & Routing Layer (`src/audio/`)

### 2.1 Hardware Audio Router (`src/audio/hardware-audio-router.ts`)
When Hardware Audio mode is active, `HardwareAudioRouter` requests raw, unprocessed multi-channel audio (up to 64 channels) from `navigator.mediaDevices.getUserMedia`:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
    echoCancellation: { exact: false },
    noiseSuppression: { exact: false },
    autoGainControl: { exact: false },
    channelCount: { ideal: 64 },
    sampleRate: { ideal: 48000 },
  },
});
```

- **Dynamic Multi-Channel Splitter Routing (2 to 64+ Interface Channels)**:
  - Creates a `ChannelSplitterNode` for all channels exposed by the hardware interface (`availableChannels`, e.g., 32 or 64 channels on a digital console or Dante interface).
  - `setActivePhysicalChannels()` collects the deduplicated physical channels referenced across all active Live Measurement sources (up to `MAX_CAPTURE_TAP_SLOTS = 8` simultaneous physical channels) and dynamically connects those splitter outputs into the 8 capture tap inputs on `CaptureTapProcessor`.
  - Returns a `channelTapMap: Record<number, number>` mapping each physical channel index to its ring buffer tap slot (`0..7`).
- **Internal Loopback Reference (`referenceChannel = -1`)**: Selecting `Internal Generator Loopback` reads directly from slot `8` (`INTERNAL_LOOPBACK_SLOT_INDEX`) of the `MultiChannelRingBuffer`, providing sample-synchronous digital reference without an external loopback cable.
- **Pause Behavior**: Pausing measurement (`Space` or **Pause** button) halts both sample capture and hardware Signal Generator output so the room falls silent immediately while inspecting traces.

### 2.2 Lock-Free Multi-Channel SPSC Ring Buffer (`src/audio/ring-buffer.ts`)
When `SharedArrayBuffer` is available (via `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers configured in `vite.config.ts` and preserved offline by the Service Worker), `CaptureTapProcessor` writes 9 sample-synchronous planar channels (`0..7` hardware taps + slot `8` internal generator loopback) into `MultiChannelRingBuffer` synchronized with a single atomic `[writeIndex, readIndex]` header. When `SharedArrayBuffer` is unavailable, `CaptureTapProcessor` automatically falls back to posting batched multi-channel `Float32Array[]` chunks over its `MessagePort`.

### 2.3 Built-in Virtual Acoustic Rig (`src/dsp/synthetic-rig.ts`)
In **Built-in Demo Simulator** mode, `dsp.worker.ts` generates sample-accurate `[M, R]` streams using `SyntheticAcousticRig`. It models:
1. **Fractional Propagation Delay Line**: Air flight time (e.g., `11.5 ms` / `3.95 m`) using linear/all-pass interpolation.
2. **2-Way Loudspeaker Crossover**: Linkwitz-Riley 4th-order (`LR24`) crossover with independent Sub gain, Sub delay, and Sub polarity inversion.
3. **Room Modes & Air Absorption**: Cascaded RBJ biquad filters (`peaking`, `lowshelf`, `highshelf`).
4. **Early Reflections**: Multi-tap delay lines creating realistic comb filtering in Magnitude/Phase and secondary spikes in the Impulse Response.
5. **Uncorrelated Ambient Noise**: Independent noise generator mixed into $M$ at a configurable SNR to exercise Coherence ($\gamma^2$) drop-offs and $H_1$ noise rejection.

---

## 3. DSP Pipeline Specification (`src/dsp/`)

### 3.1 Radix-2 FFT & Window Functions (`src/dsp/fft.ts`, `src/dsp/window-functions.ts`)
- Precomputes bit-reversal permutation tables and complex twiddle factors for any power-of-two size from `1024` to `32768`.
- Removes DC offset prior to windowing and supports `hann`, `hamming`, `blackman`, `flattop`, and `rectangular` windows with exact coherent-gain normalization.

### 3.2 Transfer Function Estimators & Averaging (`src/dsp/transfer-function.ts`)
For each frequency bin $k$ at frame $t$, given complex spectra $M_t(k)$ and $R_t(k)$:
- **Auto- and Cross-Power Spectra**:
  $$G_{rr, t}(k) = |R_t(k)|^2, \quad G_{mm, t}(k) = |M_t(k)|^2, \quad G_{rm, t}(k) = R_t^*(k) \cdot M_t(k)$$
- **$H_1$ Cross-Spectral Estimator (`estimator: 'H1'`)**:
  Maintains temporally averaged $\overline{G}_{rr}(k)$, $\overline{G}_{mm}(k)$, and $\overline{G}_{rm}(k)$ (via FIFO ring buffer of depth $N$, 4th-order Bessel LPF, or infinite cumulative average):
  $$H_1(k) = \frac{\overline{G}_{rm}(k)}{\overline{G}_{rr}(k) + \epsilon}$$
  Uncorrelated noise in $M$ averages toward zero in $\overline{G}_{rm}(k)$, rejecting room/crowd noise from both magnitude and phase.
- **OSM Ratio Estimator (`estimator: 'OSM'`)**:
  Computes per-frame $|M_t(k)| / |R_t(k)|$ and unit phase vector $(\cos\phi, \sin\phi)$, then averages across frames using FIFO or 4th-order cascaded Bessel low-pass filters (`0.25 Hz`, `0.5 Hz`, `1 Hz`, `2 Hz`).
- **Magnitude-Squared Coherence**:
  $$\gamma^2(k) = \frac{|\overline{G}_{rm}(k)|^2}{\overline{G}_{rr}(k) \cdot \overline{G}_{mm}(k) + \epsilon} \in [0, 1]$$

### 3.3 Deconvolution & Auto Delay Finder (`src/dsp/deconvolution.ts`)
- **Impulse & Step Response**:
  Computes regularized point-wise frequency deconvolution:
  $$H_{\text{deconv}}(k) = \frac{M(k) \cdot R^*(k)}{|R(k)|^2 + \lambda}$$
  Applies `IFFT`, circular-shifts $t = 0\text{ ms}$ to the center of the window, normalizes to percentage amplitude, and integrates $h(t)$ to produce the Step Response.
- **Sub-Sample Auto Delay Finder**:
  Locates the peak index $n_{\text{peak}} = \arg\max_n |h[n]|$ and applies 3-point parabolic interpolation over $(|h[n_{\text{peak}}-1]|, |h[n_{\text{peak}}]|, |h[n_{\text{peak}}+1]|)$ to estimate propagation delay with sub-sample accuracy (`delayMs` and `delaySamples`).

### 3.4 $O(1)$ Prefix-Sum Fractional-Octave Smoothing (`src/dsp/smoothing.ts`)
- Builds a cumulative prefix-sum array $P[i] = \sum_{m=0}^{i} X[m]$ in $O(K)$ time.
- For each bin $i$ and fractional bandwidth $1/B$ octave (`1/1` through `1/48`), computes lower and upper bin bounds $i_{\text{low}} = \lfloor i \cdot 2^{-1/(2B)} \rfloor$ and $i_{\text{high}} = \lceil i \cdot 2^{+1/(2B)} \rceil$ and evaluates the smoothed value in $O(1)$ time per bin. Phase vectors $(\cos\phi, \sin\phi)$ are smoothed as unit complex vectors and re-normalized so $\pm 180^\circ$ wrap boundaries never average toward $0^\circ$.

### 3.5 Broadband Weighting & SPL/Leq Metering (`src/dsp/weighting-meters.ts`)
- Implements bilinear-transformed IEC 61672-1 Class 1 **A-weighting** and **C-weighting** IIR biquad cascades alongside flat **Z-weighting**.
- Tracks exponential time-weighted **Fast** ($\tau = 125\text{ ms}$), **Slow** ($\tau = 1000\text{ ms}$), **Impulse** ($\tau_{\text{attack}} = 35\text{ ms}$, $\tau_{\text{decay}} = 1500\text{ ms}$), true energy-equivalent **$L_{\text{eq}}$**, and instantaneous **Peak** across all three weightings simultaneously.

---

## 4. Hybrid WebGL2 + 2D Canvas Chart Engine (`src/charts/`)

Each `<wsm-chart-panel>` (`src/charts/chart-panel.ts`) delegates responsibilities across four focused modules:
1. **`plot-types.ts`**: Coordinate transforms (logarithmic frequency X-axis, linear ms X-axis, dB/degree/percent Y-axis), wavelength/period calculations, and derived plot extractors (Group Delay $-\frac{d\phi}{d\omega}$ and Crest Factor $\text{Peak}/\text{RMS}$).
2. **`gl-trace-renderer.ts`**: GPU-accelerated WebGL2 line renderer that uploads trace vertices with per-bin coherence alpha (`smoothstep` opacity fade) and suppresses vertical wrap-around artifacts when Phase jumps across $\pm 180^\circ$.
3. **`canvas-chart-painter.ts`**: Renders crisp logarithmic/linear grid lines, axis labels, trace legends, hover crosshair readouts, RTA peak-hold overlays, and interactive Parametric EQ node handles.
4. **`chart-interaction.ts`**: Pure state and math controller for cursor hover readouts, Y-axis scroll-wheel zoom, Y-axis drag pan, and direct dragging of Virtual EQ bands (frequency on X, gain dB on Y, and $Q$ factor via `Shift`+wheel).
