# 02. Web Technical Architecture & DSP Design

## 1. High-Level System Architecture

A browser-based acoustic analyzer faces a critical real-time constraint: **Web Audio's `AudioWorkletProcessor.process()` runs on a real-time audio thread in 128-sample quanta (~2.67 ms at 48 kHz)**. Running a 16,384-point or 65,536-point FFT, deconvolution, and LFT inside `process()` will cause audio glitches/dropouts whenever a transform frame triggers.

Instead, just as OSM separates its audio callback thread (`writeData` writing into lock-free/mutex circular buffers) from its transform timer thread (`Measurement::transform()` running every ~40–80 ms), `WebSoundMeter` should split responsibilities across **three threads**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. AUDIO THREAD (Web Audio API / AudioWorkletGlobalScope - 128-sample tick)│
│                                                                            │
│  [Mic / Multi-ch Input] ──► [ChannelSplitter] ────────────┐                │
│                                                           ▼                │
│  [Generator Worklet] ──┬──► [Virtual PA/Room Simulator] ─► [CaptureWorklet]│
│   (Pink/White/Sine)    └──► [Physical Output]                              │
│                                                           │ Interleaved    │
│                                                           │ [M, R] float32 │
└───────────────────────────────────────────────────────────┼────────────────┘
                                                            │
                         Lock-Free SPSC RingBuffer (SharedArrayBuffer)
                         (Fallback: chunked Float32Array via MessagePort)
                                                            │
┌───────────────────────────────────────────────────────────▼────────────────┐
│ 2. DSP WORKER THREAD (Dedicated Web Worker - Pure TypeScript Float32Array) │
│                                                                            │
│  • Reads M (Measurement) & R (Reference) samples into 64k Circular Buffers │
│  • Applies Input Filters (A/C/Z weighting, 1kHz Notch) & SPL/Leq Meters    │
│  • Applies sample-accurate Delay Compensation (m_delay)                    │
│  • Runs Transform Tick (~25–30 Hz):                                        │
│      - Fixed FFT (1k..64k) in Phase 1; LFT / MTW in Phase 2                │
│      - Cross-Spectrum H1(f) = <G_rm>/<G_rr>, Module, Complex Phase         │
│      - Coherence γ²(f), Peak Hold, Crest Factor                            │
│      - Deconvolution IFFT → Impulse Response & Step Response               │
│      - Periodic 64k Cross-Correlation → Auto Delay Finder                  │
│  • Evaluates Virtual Sources (Union/Math, Virtual EQ, Crossover, Window)   │
│  • Publishes Double-Buffered `SourceData` snapshots                        │
└───────────────────────────────────────────────────────────┬────────────────┘
                                                            │
                         SharedArrayBuffer Views / Transferable Snapshots
                                                            │
┌───────────────────────────────────────────────────────────▼────────────────┐
│ 3. UI & RENDERING THREAD (Main Thread / OffscreenCanvas)                   │
│                                                                            │
│  • Lit 3 Reactive UI Shell (OSM-style Sidebar, Drawer, Generator, SPL Bar) │
│  • Hybrid Chart Renderer (60 FPS requestAnimationFrame):                   │
│      - WebGL2 Layer: Traces, Coherence Alpha, Phase Wrap, Spectrogram      │
│      - 2D Canvas Overlay: Crisp Log/Lin Grids, Labels, Cursors, EQ Nodes   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Audio I/O & Routing Layer

### 2.1 Raw Measurement Input Acquisition
Browsers apply aggressive voice-processing DSP to `getUserMedia` streams by default. For acoustic measurement, we must request raw, unprocessed multi-channel audio:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
    echoCancellation: { exact: false },
    noiseSuppression: { exact: false },
    autoGainControl: { exact: false },
    channelCount: { ideal: 32 }, // Request all available interface channels
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 24 },
  }
});
```

After creating the `MediaStreamAudioSourceNode`, we inspect `sourceNode.channelCount` (or `stream.getAudioTracks()[0].getSettings().channelCount`) and connect a `ChannelSplitterNode(context, { numberOfOutputs: maxChannels })` so the user can assign any physical input channel as **Measurement ($M$)** or **Reference ($R$)**.

### 2.2 Internal Loopback Reference vs. External Hardware Reference
In OSM (`measurement.cpp:477-508`), if the user selects the internal generator as the Reference channel (or in single-interface setups without a physical loopback cable), the generator's digital output samples are fed directly into the Reference buffer (`m_loopBuffer`).
- In Web Audio, this is even cleaner: the `CaptureTapWorklet` has **2 inputs**:
  - `inputs[0]`: Selected Measurement channel from the `ChannelSplitterNode`
  - `inputs[1]`: Either a selected Reference channel from the `ChannelSplitterNode` **or** a direct Web Audio connection from the internal `GeneratorManager` node!
- Because both `inputs[0]` and `inputs[1]` arrive in the exact same `CaptureTapWorklet.process()` call, internal reference loopback is sample-synchronous within the Web Audio graph, and external hardware latency is handled by the Delay Finder.

### 2.3 Built-in Virtual Acoustic Rig (Hardware-Free Demo & Test Simulator)
To allow full interactive demos, development, and automated end-to-end testing without an external audio interface, microphone, or loudspeaker, the Audio Engine exposes a built-in **"Simulated Acoustic Rig"** selectable as a virtual input device.

When selected, the Reference channel ($R$) receives the internal Signal Generator output directly, while the Measurement channel ($M$) is synthesized through a configurable Web Audio / DSP graph modeling a real PA and room:
1. **Propagation Delay Line (`DelayNode` / fractional delay)**: Configurable air flight time (e.g., `11.8 ms` ≈ `4.05 m`) to exercise the **Auto Delay Finder** and **Phase alignment**.
2. **Loudspeaker Crossover & Driver Model**: Configurable 2-way (Sub + Main) Linkwitz-Riley / Butterworth crossover with independent Sub gain, Sub delay, and Sub polarity inversion switch—allowing users to practice **Sub/Top phase alignment** visually.
3. **Room/Cabinet Resonances (`BiquadFilterNode` cascade)**: 2–4 peaking/shelving filters modeling room modes and HF air absorption—allowing users to practice flattening a system using the **Virtual EQ** source.
4. **Early Reflections (Tapped Delay Lines)**: 1–3 secondary delay taps (e.g., `+2.4 ms` floor bounce at `-6 dB`, `+22 ms` back-wall reflection at `-12 dB`)—creating realistic comb filtering in Magnitude/Phase, visible secondary spikes in the **Impulse / ETC** plot, and exercising **IR Time Windowing**.
5. **Uncorrelated Ambient Noise Injection**: An independent noise generator mixed into $M$ at a selectable SNR (e.g., `∞ dB`, `+20 dB`, `+10 dB`, `0 dB`)—causing realistic **Coherence ($\gamma^2$)** drop-offs and demonstrating how $H_1$ averaging recovers the clean transfer function from background noise.

---

## 3. Unified Data Model (`SourceData`)

Directly adopting OSM's `Abstract::Data` + `Abstract::Source` design (`osm/src/abstract/data.h`), every source in `WebSoundMeter` (live measurement, stored trace, math union, virtual EQ, crossover filter, windowed IR) exposes a uniform typed-array-backed `SourceData` structure:

```ts
export interface FrequencyDomainData {
  readonly length: number;
  readonly frequency: Float32Array;    // Hz per bin/point
  readonly module: Float32Array;       // Linear RTA amplitude |M(f)|
  readonly magnitude: Float32Array;    // Linear Transfer Function |H(f)|
  readonly phaseReal: Float32Array;    // cos(φ) of unit phase vector
  readonly phaseImag: Float32Array;    // sin(φ) of unit phase vector
  readonly coherence: Float32Array;    // γ²(f) or |γ(f)| in [0, 1]
  readonly peakSquared: Float32Array;  // Peak hold |M(f)|²
  readonly meanSquared: Float32Array;  // RMS |M(f)|² (for Crest Factor)
}

export interface TimeDomainData {
  readonly length: number;
  readonly timeMs: Float32Array;       // Time in ms (centered at 0 ms)
  readonly impulse: Float32Array;      // Deconvolved impulse h(t)
}

export interface BroadbandLevels {
  // Indexed by Weighting ('Z' | 'A' | 'C') and Integration ('Fast' | 'Slow' | 'Impulse' | 'Leq')
  readonly levelsDb: Record<'Z' | 'A' | 'C', Record<'Fast' | 'Slow' | 'Impulse' | 'Leq', number>>;
  readonly peaksDb: Record<'Z' | 'A' | 'C', number>;
  readonly referenceRmsDb: number;
  readonly referencePeakDb: number;
}
```

### Why `SoA` (Structure of Arrays) Instead of `AoS` (Array of Structs)?
In C++, OSM uses `std::vector<FTData>` (Array of Structs). In JavaScript/TypeScript + WebGL, **Structure of Arrays (`Float32Array` per field)** has two massive advantages:
1. **Zero-Allocation SIMD / DSP Loops**: Tight loops over contiguous `Float32Array`s JIT-compile to native vector instructions in V8/SpiderMonkey/JavaScriptCore (and map 1:1 to WebAssembly linear memory).
2. **Direct GPU Buffer Upload**: `gl.bufferSubData(gl.ARRAY_BUFFER, 0, sourceData.frequencyDomain.magnitude)` uploads an entire trace to WebGL2/WebGPU in a single call with zero object traversal or marshaling!

---

## 4. Mathematical & DSP Pipeline Specification

### 4.1 Transform Modes: Fixed STFT vs. Log/Multi-Time Window (LFT / MTW)
We should support two transform families:
1. **Fixed Radix-2 FFT (`FFT10` = 1024 to `FFT16` = 65536)**:
   - Uses a precomputed bit-reversal permutation table and twiddle factors (or a tiny WASM/SIMD radix-2/split-radix FFT kernel).
   - Trick from OSM (`fouriertransform.cpp:204`): Pack real channel $M[n]$ and real channel $R[n]$ into a single complex vector $Z[n] = M[n] + i R[n]$ (or SIMD 4-float vector `[M.re, M.im, R.re, R.im]`) so both channels are transformed in a single pass.
2. **Multi-Time Window (MTW) / Log Fourier Transform (LFT)**:
   - Provides 24 or 48 points per octave from 20 Hz to 20 kHz.
   - **Recommended Web Implementation**: Smaart-style **Cascaded Half-Band Decimation + Small FFTs** (or OSM's precomputed `m_logBasis` dot-product for lower octaves + FFT for upper octaves). Running a 2048-point FFT at 48 kHz (top 2 octaves), downsampling 2× with an anti-aliasing IIR/FIR filter and running a 2048-point FFT at 24 kHz, 12 kHz, 6 kHz, 3 kHz, 1.5 kHz, etc., achieves 1/48th-octave resolution down to 10 Hz with <10% of the CPU cost of a 65,536-point FFT!

### 4.2 Transfer Function ($H_1$) & Coherence ($\gamma^2$)
For each frequency bin $k$ at frame $t$, given complex spectra $M_t(k)$ and $R_t(k)$:
1. **Instantaneous Auto- and Cross-Power Spectra**:
   $$G_{rr, t}(k) = |R_t(k)|^2, \quad G_{mm, t}(k) = |M_t(k)|^2, \quad G_{rm, t}(k) = R_t^*(k) \cdot M_t(k)$$
2. **Temporal Averaging (FIFO Ring Buffer of depth $N$, or EMA / Bessel LPF)**:
   Maintain smoothed accumulators $\overline{G}_{rr}(k)$, $\overline{G}_{mm}(k)$, and complex $\overline{G}_{rm}(k)$:
   - **$H_1$ Transfer Function Complex Estimate**:
     $$H_1(k) = \frac{\overline{G}_{rm}(k)}{\overline{G}_{rr}(k) + \epsilon}$$
   - **Magnitude**: $|H_1(k)|$ (displayed as $20 \log_{10}|H_1(k)|$)
   - **Phase**: Unit vector $\hat{\phi}(k) = \frac{\overline{G}_{rm}(k)}{|\overline{G}_{rm}(k)|} = (\cos\phi, \sin\phi)$, displayed as $\text{atan2}(\sin\phi, \cos\phi) \cdot \frac{180}{\pi}$.
   - **Magnitude-Squared Coherence**:
     $$\gamma^2(k) = \frac{|\overline{G}_{rm}(k)|^2}{\overline{G}_{rr}(k) \cdot \overline{G}_{mm}(k) + \epsilon} \in [0, 1]$$
   *(Note: We can also offer OSM's per-frame $|M|/|R|$ + Bessel LPF mode as a selectable option in Measurement settings so traces match OSM 1:1 when desired.)*

### 4.3 Deconvolution (Impulse Response) & Auto Delay Finder
- **Live Impulse Response (`Deconvolution`)**:
  - For each bin $k$, compute regularised complex division:
    $$H_{\text{deconv}}(k) = \frac{M(k) \cdot R^*(k)}{|R(k)|^2 + \lambda}$$
    where $\lambda$ is a small regularization floor (prevents division-by-zero blowup at frequencies where the reference signal has no energy, e.g., band-limited sub signals).
  - Run `IFFT(H_deconv)` and circular-shift by $N/2$ so $t = 0\text{ ms}$ sits at the center of the buffer (`[-T/2, +T/2]`).
- **Auto Delay Finder**:
  - Runs on a $2^{15}$ or $2^{16}$ window (~680 ms to 1.36 s range at 48 kHz) every ~1–2 seconds (or on user click of **"Find Delay"**).
  - Finds $\arg\max_n |h[n]|$ and uses parabolic 3-point interpolation around the peak for sub-sample delay accuracy (in ms and samples).

### 4.4 Fractional-Octave Smoothing (1/1 to 1/48 Octave)
- Using OSM's `IntegrationTree` (`osm/src/math/integration_tree.h`) or a **Prefix-Sum (Integral Array)** over power values:
  - Build a prefix sum array $P[i] = \sum_{m=0}^{i} |X[m]|^2$ in $O(K)$ time.
  - For any bin $i$ at frequency $f_i$, the lower and upper bin indices for $1/B$-octave smoothing are $i_{\text{low}} = \lfloor i \cdot 2^{-1/(2B)} \rfloor$ and $i_{\text{high}} = \lceil i \cdot 2^{+1/(2B)} \rceil$.
  - The smoothed value is simply $\sqrt{\frac{P[i_{\text{high}}] - P[i_{\text{low}} - 1]}{i_{\text{high}} - i_{\text{low}} + 1}}$ in **$O(1)$ time per bin**, regardless of FFT size or smoothing width!

---

## 5. High-Performance Chart Rendering Architecture

### Why a Two-Layer Canvas (WebGL2 + 2D/HTML Overlay) is Ideal
Rendering acoustic charts has two very different visual requirements:
1. **Heavy Dynamic Data (60 FPS)**: Multiple traces of 4,096–32,768 vertices, per-vertex coherence opacity, phase wrap-around detection, RTA bars, and scrolling 2D spectrograms.
2. **Crisp UI & Typography (Event-driven)**: Axis ticks, logarithmic grid lines, frequency/dB readouts, cursor crosshairs, and draggable Parametric EQ nodes.

By stacking a **WebGL2 `<canvas>`** (bottom) and a **2D `<canvas>` or SVG overlay** (top) inside a `<chart-viewport>` Lit component:
- **Logarithmic X-Axis on the GPU**: Just like OSM's `shaders/logx.vert`, the vertex shader transforms frequency $f$ directly into normalized device coordinates:
  ```glsl
  float x_ndc = 2.0 * (log(freq / u_fMin) / log(u_fMax / u_fMin)) - 1.0;
  ```
- **Coherence Alpha Blending**: The fragment shader receives `v_coherence` from the vertex attribute buffer and computes trace opacity:
  ```glsl
  float alpha = smoothstep(u_coherenceThreshold, 1.0, v_coherence);
  fragColor = vec4(u_traceColor.rgb, u_traceColor.a * alpha);
  ```
- **Artifact-Free Phase Wrapping**: In the vertex/instanced line shader (matching OSM's `shaders/phase.geom`), if $|\phi_{i+1} - \phi_i| > \pi$, the segment between bin $i$ and $i+1$ is either split at $\pm 180^\circ$ or discarded so vertical wrap lines never clutter the phase plot.

---

## 6. Storage, Calibration & File Formats

All persistence works 100% locally in the browser (offline-capable PWA) with optional file import/export:
- **Session & Stored Trace Persistence**: `IndexedDB` stores active layout, measurement settings, and unlimited `Stored` traces (serialized in a compact binary/JSON format compatible with OSM `.osm` JSON exports where practical).
- **Calibration Files (`.cal` / `.txt` / `.frd`)**: Drag-and-drop parser supporting standard 2-column (`Freq`, `dB`) and 3-column (`Freq`, `dB`, `Phase`) microphone calibration files, interpolated onto the active frequency vector.
- **Trace Export/Import**: CSV/FRD text export, PNG chart snapshot export, and WAV impulse response export.

