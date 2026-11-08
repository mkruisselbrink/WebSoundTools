# WebSoundMeter

**WebSoundMeter** is a browser-based dual-channel acoustic measurement, PA alignment, and sound level metering platform built in pure TypeScript with Web Audio (`AudioWorklet`), lock-free `SharedArrayBuffer` ring buffers, a dedicated DSP `Worker`, and hybrid WebGL2 + HiDPI Canvas2D charting.

---

## Key Features

- **Dual-Channel Acoustic Analysis (`Measurement` vs. `Reference`):**
  - **Dual-Real Packed Radix-2 FFT** (`1024` to `32768` points) that transforms both Measurement and Reference channels in a single complex FFT pass.
  - **Transfer Function Estimators:** $H_1(f) = \langle G_{rm}(f) \rangle / \langle G_{rr}(f) \rangle$ cross-spectral estimator for uncorrelated room noise rejection, plus $|M(f)|/|R(f)|$ ratio mode with complex unit-vector phase averaging.
  - **Magnitude-Squared Coherence ($\gamma^2$):** Independent rolling cross-spectral window with coherence-weighted trace alpha rendering.
  - **Regularized Deconvolution:** Tikhonov-regularized inverse FFT impulse response, step response, polarity detection, and parabolic sub-sample **Auto Delay Finder**.
  - **Fractional-Octave Smoothing:** `1/48`, `1/24`, `1/12`, `1/6`, `1/3`, and `1/1` octave magnitude and complex phase smoothing.
- **IEC 61672 Broadband Metering:**
  - Simultaneous **A**, **C**, and **Z** frequency weightings with **Fast** ($125\text{ ms}$), **Slow** ($1000\text{ ms}$), **Impulse**, **Leq**, and **Peak** readouts.
- **Built-in Synthetic Acoustic Rig & Signal Generator:**
  - Zero-setup demo simulator modeling multi-tap room reflections, propagation delay, room modes, HF air absorption, and sub/top Linkwitz-Riley crossovers.
  - Built-in Pink Noise, White Noise, Sine, and Log Sweep generator.
- **Virtual Sources & Session Persistence:**
  - **Stored Traces:** Capture live measurements to IndexedDB with post-capture gain and delay offsets.
  - **Virtual Parametric EQ:** Interactive 6-band biquad cascade (draggable directly on the Magnitude chart) with real-time post-EQ response prediction.
  - **Math / Union Sources:** Vector Average, Power Average, Vector Sum/Difference, Cascade Apply ($A \times B$), Level Difference ($\text{dB}$), and Min/Max envelopes.
  - **Microphone Calibration:** `.cal` / `.frd` / `.txt` file parser with log-frequency interpolation.

---

## Architecture

```
Audio Thread (AudioWorklet)
  └── capture-worklet.ts ──► DualChannelRingBuffer (SharedArrayBuffer + Atomics)
                                     │
DSP Worker Thread (dsp.worker.ts) ◄──┘
  ├── SignalGenerator + SyntheticAcousticRig (Simulator Mode)
  └── MeasurementPipeline
        ├── Input Gain, Polarity & Pre-Filters (Z / A / C / 1 kHz Notch)
        ├── BroadbandMeterBank (IEC 61672 A / C / Z, Fast / Slow / Impulse / Leq)
        ├── Radix2FFT (Dual-Real Packed Cooley–Tukey + Float64 Twiddle Tables)
        ├── TransferFunctionAnalyzer (H1 / Ratio, FIFO / LPF Averaging, Coherence)
        └── DeconvolutionAnalyzer (Impulse, Step, Auto Delay Finder)
                │
Main Thread (Lit 3 UI + Charts) ◄────┘
  ├── AudioEngine (Web Audio & Worker Controller)
  ├── WebSoundMeterApp (app-shell.ts, topbar-view.ts, inspector-views.ts)
  └── ChartPanel (WebGL2 + HiDPI Canvas2D, rAF-debounced)
```

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `Space` or `C` | Capture current trace to Stored Sources |
| `D` | Run Auto Delay Finder and apply estimated delay to Reference channel |

---

## Getting Started

```bash
# Install dependencies
npm install

# Start Vite development server (with COOP/COEP headers for SharedArrayBuffer)
npm run dev

# Type-check and build production bundle
npm run build

# Run Vitest unit & integration test suite
npm test

# Run Playwright end-to-end browser tests
npm run test:e2e
```

---

## License & Acknowledgements

This project is licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`) — see the [`LICENSE`](./LICENSE) file for details.

Inspired by [Open Sound Meter (OSM)](https://opensoundmeter.com/) by Pavel Smokotnin (also licensed under GPLv3).


