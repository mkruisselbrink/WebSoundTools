# 04. Automated Testing Strategy & Virtual Acoustic Simulator

## 1. Design Philosophy: "Testable by Construction"

Audio and graphics applications are notoriously difficult to test when DSP logic is entangled with Web Audio nodes or `<canvas>` rendering calls. To ensure we have **automated tests for nearly everything**, we enforce two architectural boundaries:

1. **Pure TypeScript Functional DSP Core (`src/dsp/`)**:
   - Every math and signal-processing module (`fft.ts`, `transfer-function.ts`, `deconvolution.ts`, `coherence.ts`, `averaging.ts`, `smoothing.ts`, `weighting-meters.ts`, `calibration.ts`) is written in **100% pure TypeScript operating on `Float32Array`s** with zero DOM, Web Worker, or `AudioContext` dependencies.
   - This means the entire DSP engine can be unit-tested deterministically in **Vitest (Node/V8)** in milliseconds, feeding mathematically exact test signals and asserting exact floating-point outputs.
2. **First-Class Simulated Acoustic Rig (`src/audio/simulator.ts` & `src/dsp/synthetic-rig.ts`)**:
   - The same mathematical acoustic simulator that powers the **interactive Demo Mode** in the browser UI also runs deterministically in headless tests to generate synthetic `[Measurement, Reference]` sample streams with known ground-truth delay, magnitude, phase, reflections, and SNR.

---

## 2. Four-Tier Automated Test Suite

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Tier 4: E2E & Visual Regression Tests (Playwright - Headless Chromium)  │
│  • Full app workflows using Built-in Simulator (no mic needed)          │
│  • Auto Delay Finder → Apply Delay → Capture Trace → Virtual EQ match   │
│  • WebGL2 canvas pixel/snapshot verification across all plot types      │
├─────────────────────────────────────────────────────────────────────────┤
│ Tier 3: UI Component & State Tests (Vitest Browser Mode + Lit)          │
│  • <app-shell>, <source-sidebar>, <properties-drawer>, <spl-meter>      │
│  • IndexedDB session persistence, .cal file import, keyboard shortcuts  │
├─────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Worker & RingBuffer Integration Tests (Vitest)                  │
│  • SharedArrayBuffer SPSC RingBuffer wrap-around & atomic safety        │
│  • dsp.worker.ts message protocol & multi-source graph updates          │
├─────────────────────────────────────────────────────────────────────────┤
│ Tier 1: Deterministic DSP & Math Unit Tests (Vitest - Fast Node/V8)     │
│  • FFT/IFFT, Windows, H1 Transfer Function, Coherence, Deconvolution    │
│  • IEC 61672 A/C/Z Weighting & Fast/Slow/Leq, Biquads, Union/EQ math    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tier 1: Deterministic DSP & Math Unit Tests (`Vitest`)
Every algorithm in `src/dsp/` and `src/sources/` will have exhaustive unit tests against analytical ground truth:

- **FFT, IFFT & Window Functions (`fft.test.ts`)**:
  - **Impulse & DC**: Verify `FFT([1, 0, 0, ...])` yields flat unity magnitude and zero phase across all bins; verify DC removal.
  - **Bin-Centered Sinusoids**: Inject $x[n] = A \cos(2\pi k n / N + \phi)$ and assert bin $k$ recovers exact amplitude $A$ ($\pm 10^{-5}$) and phase $\phi$ ($\pm 10^{-4}\text{ rad}$).
  - **Invertibility**: Assert `IFFT(FFT(randomSignal))` matches `randomSignal` with max absolute error $< 10^{-5}$.
  - **Parseval's Theorem**: Verify time-domain energy $\sum x[n]^2$ equals frequency-domain energy $\frac{1}{N} \sum |X[k]|^2$.
  - **Window Coherent Gain & Scalloping Loss**: Verify `Hann`, `Hamming`, `Blackman`, and `FlatTop` amplitude accuracy on off-bin sinusoids.

- **Transfer Function ($H_1$) & Complex Phase (`transfer-function.test.ts`)**:
  - **Known Biquad Filter Recovery**: Pass deterministic white/pink noise $R[n]$ through a known digital biquad filter (e.g., RBJ Peaking EQ at $f_0 = 1000\text{ Hz}$, $\text{Gain} = +6.0\text{ dB}$, $Q = 2.0$) to produce $M[n]$. Run the $H_1$ estimator and assert that across 20 Hz–20 kHz:
    - Computed magnitude $|H_1(f)|$ matches the analytical biquad transfer function $|H(e^{j\omega})|$ within **$\pm 0.05\text{ dB}$**.
    - Computed complex phase $\angle H_1(f)$ matches analytical $\angle H(e^{j\omega})$ within **$\pm 0.5^\circ$**.
  - **Phase Wrap-Around Averaging**: Average two frames with phases $+179^\circ$ and $-179^\circ$ and verify complex vector averaging yields $180^\circ$ (not $0^\circ$!).

- **Coherence & Noise Rejection (`coherence.test.ts`)**:
  - **Unity Coherence**: Verify $\gamma^2(f) = 1.0 \pm 10^{-5}$ for any noiseless linear time-invariant filter $M = h * R$.
  - **Zero Coherence**: Verify $\gamma^2(f) \to 0$ as frame count $N \to \infty$ when $M$ and $R$ are independent random noise sequences.
  - **Analytical SNR Relationship**: Mix uncorrelated noise $N[n]$ into $M[n]$ at a known signal-to-noise ratio $\text{SNR}(f) = P_{\text{signal}} / P_{\text{noise}}$. Verify that converged coherence matches the theoretical formula:
    $$\gamma^2(f) = \frac{1}{1 + \frac{1}{\text{SNR}(f)}}$$
    (e.g., at $0\text{ dB}$ SNR where signal equals noise, $\gamma^2 \approx 0.50$).

- **Deconvolution & Auto Delay Finder (`deconvolution.test.ts`)**:
  - **Exact Sample Delay**: Delay $M[n] = R[n - D]$ by $D \in \{0, 1, 47, 480, 12345, -250\}$ samples. Assert `delayFinder.findDelay()` returns $D$ with **0-sample error**.
  - **Sub-Sample Parabolic Interpolation**: Delay $M[n]$ by a fractional sample ($D = 100.4$ samples using an all-pass sinc/Thiran fractional delay filter) and assert sub-sample delay estimation within $\pm 0.05$ samples.
  - **Polarity Inversion**: Delay and invert $M[n] = -R[n - D]$, and assert the impulse response peak at $D$ has negative amplitude $-1.0$.

- **Broadband SPL, Leq & IEC 61672 Weighting (`weighting-meters.test.ts`)**:
  - **A-Weighting & C-Weighting Frequency Response**: Sweep sine waves at standard ISO/IEC 61672-1 third-octave frequencies (31.5 Hz, 63 Hz, 125 Hz, 250 Hz, 500 Hz, 1 kHz, 2 kHz, 4 kHz, 8 kHz, 16 kHz) at 48 kHz and 96 kHz sample rates, and assert the filter attenuation matches IEC 61672 Class 1 tolerance limits (e.g., $0.0\text{ dB}$ at 1 kHz, $-19.1\text{ dB}$ at 100 Hz for A-weighting).
  - **Fast (125 ms), Slow (1000 ms) & $L_{\text{eq}}$ Ballistics**: Feed a 1 kHz tone burst (per IEC 61672 tone-burst response tables) and verify Fast/Slow attack/decay ballistics and true energy-equivalent $L_{\text{eq}}$.

- **Fractional-Octave Smoothing (`smoothing.test.ts`)**:
  - Verify prefix-sum $O(1)$ fractional-octave smoothing (`1/1`, `1/3`, `1/6`, `1/12`, `1/24`, `1/48` oct) preserves total energy and matches reference sliding-window averages.

- **Virtual Sources (`sources.test.ts`)**:
  - **`UnionSource`**: Test Vector Average (constructive/destructive phase cancellation of two traces $180^\circ$ out of phase), Power Average (+3 dB for uncorrelated, +6 dB for in-phase vector sum), Subtract ($A - B$), Min, and Max.
  - **`EqualizerSource`**: Verify cascading multiple virtual parametric EQ bands produces the exact product of their individual complex transfer functions, and verify applying an inverse EQ to a measured speaker trace flattens the combined response to $0.0\text{ dB}$ / $0^\circ$.
  - **`Calibration`**: Verify parsing of 2-column and 3-column `.cal` / `.txt` files and log-frequency interpolation.

### 2.2 Tier 2: Audio Pipeline & Worker Integration Tests
- **Lock-Free `RingBuffer` (`ring-buffer.test.ts`)**:
  - Property-based / randomized chunk-size read/write tests across buffer wrap-around boundaries (`128` samples in, `1024` samples out, simulated producer/consumer overruns and underruns).
- **DSP Worker Integration (`dsp-worker.test.ts`)**:
  - Spins up `dsp.worker.ts`, streams synthetic `[M, R]` blocks from `SyntheticAcousticRig`, changes FFT size, window type, averaging depth, and delay compensation on the fly, and verifies emitted `SourceData` snapshots.

### 2.3 Tier 3 & 4: UI Component & Playwright E2E / Visual Regression Tests
- **Headless WebGL2 Rendering & Plot Verification**:
  - Playwright runs headless Chromium with WebGL2 enabled (`--use-gl=angle`).
  - Tests load deterministic `StoredSource` fixtures (e.g., a known 1 kHz notch filter, a $360^\circ$ phase wrap, and a 50% coherence drop above 8 kHz) and verify:
    - Axis labels, cursor readouts on hover, and legend badges.
    - Visual snapshot comparison (`expect(canvas).toHaveScreenshot()`) for RTA, Magnitude, Phase, Coherence, Impulse, and SPL plots.
- **Full User Workflows (Zero External Audio Required)**:
  - E2E test selects the **"Simulated PA: Sub + Top Misaligned"** preset, starts the Pink Noise generator, clicks **"Auto Delay"**, captures a baseline trace, adds a **Virtual EQ** source to flatten a +5 dB room mode at 160 Hz, and verifies the resulting trace is flat within $\pm 0.5\text{ dB}$.

---

## 3. Built-in Demo Mode & Interactive Simulator Presets

In the live application UI, the Input Device selector will always include **"Built-in Demo Simulator"** at the top of the device list (and auto-select it if no microphone permission is granted or when the user clicks **"Try Demo Mode"**).

When active, a compact **"Simulator Controls"** pill in the top bar lets the user switch between realistic live-sound scenarios (or tweak parameters live):

| Preset Name | What It Simulates | Features It Showcases |
| :--- | :--- | :--- |
| **1. Flat System (Delayed)** | Ideal flat speaker at `11.5 ms` (`3.95 m`) air delay + `-35 dB` room noisefloor | Auto Delay Finder, Phase flattening once delay is matched, clean Impulse peak |
| **2. PA Tuning (Room Modes + HF Roll-off)** | Main PA at `8.2 ms` with a `+6 dB` boom at `140 Hz`, a `-4.5 dB` dip at `650 Hz`, and HF air loss above `10 kHz` | Transfer Function Magnitude/Phase, Capturing a reference trace, designing a corrective **Virtual Parametric EQ** |
| **3. Sub + Top Crossover Alignment** | 2-way system with `100 Hz` LR24 crossover where the Subwoofer is delayed by `+4.5 ms` and polarity-inverted | Deep crossover cancellation notch at `100 Hz`, Phase slope matching, polarity flip, and delay alignment |
| **4. Stage Monitor Comb Filtering** | Main speaker at `5.0 ms` + strong floor/wall reflection at `+2.2 ms` (`-4 dB`) | Severe Magnitude/Phase comb filtering, secondary spike on **Impulse / ETC** plot, coherence ripples |
| **5. Noisy Crowd / FOH Mixing** | PA response buried in loud uncorrelated crowd/ambient noise (`+3 dB` to `-3 dB` SNR) + dynamic level shifts | Low **Coherence ($\gamma^2$)** alpha fading/blanking, power of **$H_1$ FIFO/LPF averaging** to pull trace out of noise, **RTA & SPL/Leq** monitoring |

