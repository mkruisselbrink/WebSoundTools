# WebSoundMeter

**WebSoundMeter** is an offline-capable, browser-based multi-channel acoustic measurement, PA alignment, and sound level metering platform built in pure TypeScript with Web Audio (`AudioWorklet`), lock-free `SharedArrayBuffer` ring buffers, a dedicated DSP `Worker`, and hybrid WebGL2 + HiDPI Canvas2D charting.

---

## Key Features

- **Multi-Channel Dual-FFT Acoustic Analysis (`Measurement` vs. `Reference`):**
  - **Simultaneous Multi-Channel Live Measurements (`+ Meas` / `M`):** Run multiple concurrent live measurement pipelines from any physical input channels (`Ch 1..64`) or independent Demo Simulator presets. Transform/averaging settings are synchronized across all live slots so spatial averages (`Math Union`) always share identical frequency bins, while delay, gain, polarity, input filter, and calibration remain per-measurement.
  - **Global Reference (`Ref`) with Per-Measurement Override:** Configure a global reference channel (`Internal Gen` or `In Ch 1..N`) in the Topbar while allowing individual live measurements to override their reference channel under **Advanced Settings**.
  - **Dual-Real Packed Radix-2 FFT** (`1024` to `32768` points) that transforms both Measurement and Reference channels in a single complex FFT pass.
  - **Transfer Function Estimators:** $H_1(f) = \langle G_{rm}(f) \rangle / \langle G_{rr}(f) \rangle$ cross-spectral estimator for uncorrelated room noise rejection, plus $|M(f)|/|R(f)|$ ratio mode with complex unit-vector phase averaging.
  - **Magnitude-Squared Coherence ($\gamma^2$):** Independent rolling cross-spectral window with coherence-weighted trace alpha rendering.
  - **Regularized Deconvolution:** Tikhonov-regularized inverse FFT impulse response, step response, polarity detection, and parabolic sub-sample **Auto Delay Finder**.
  - **Fractional-Octave Smoothing:** $O(1)$ prefix-sum `1/48`, `1/24`, `1/12`, `1/6`, `1/3`, and `1/1` octave magnitude and complex phase smoothing.
- **IEC 61672 Broadband Metering:**
  - Simultaneous **A**, **C**, and **Z** frequency weightings with **Fast** ($125\text{ ms}$), **Slow** ($1000\text{ ms}$), **Impulse**, **Leq**, and **Peak** readouts.
- **Built-in Synthetic Acoustic Rig & Signal Generator:**
  - Zero-setup demo simulator modeling multi-tap room reflections, propagation delay, room modes, HF air absorption, and sub/top Linkwitz-Riley crossovers (`5` presets).
  - Built-in Pink Noise, White Noise, Sine, and Log Sweep generator with hardware output channel routing (`Out Ch 1..N`, `All Channels`, or `Muted`).
- **Virtual Sources, 3-Tier Persistence & Offline PWA:**
  - **URL Query & History State (`url-state.ts`):** Shareable URL query parameters (`?layout=...&plots=...&preset=...`) with full Browser Back/Forward (`popstate`) support.
  - **Workspace Session (`workspace-session.ts`):** Synchronous `localStorage` persistence for multi-slot live measurement configs, global reference routing, remembered hardware device labels, and generator settings.
  - **IndexedDB Library (`session-storage.ts`):** Persistent storage for **Stored Traces**, **Virtual Parametric EQ** (interactive 6-band biquad cascade + Auto-Flatten Room Modes), **Math / Union Sources** (Vector Avg, Power Avg, Sum, Subtract, Cascade Apply, dB Diff, Min/Max), and reusable **Microphone Calibration Curves** (`.cal` / `.frd` / `.txt`).
  - **Installable Offline PWA (`src/pwa/`):** Web App Manifest (`manifest.webmanifest`) and build-time precaching Service Worker (`sw.js`) that works 100% offline while preserving `COOP`/`COEP` headers for `SharedArrayBuffer`.

---

## Architecture

```
Audio Thread (AudioWorklet + Dynamic 64ch ChannelSplitter)
  └── capture-worklet.ts ──► MultiChannelRingBuffer (8 Hardware Taps + Internal Loopback)
                                     │
DSP Worker Thread (dsp.worker.ts) ◄──┘
  ├── SignalGenerator + Per-Slot SyntheticAcousticRig (Simulator Mode)
  └── Multi-Slot MeasurementPipeline[]
        ├── Input Gain, Polarity & Pre-Filters (Z / A / C / 1 kHz Notch)
        ├── BroadbandMeterBank (IEC 61672 A / C / Z, Fast / Slow / Impulse / Leq)
        ├── Radix2FFT (Dual-Real Packed Cooley–Tukey + Float64 Twiddle Tables)
        ├── TransferFunctionAnalyzer (H1 / Ratio, FIFO / LPF Averaging, Coherence)
        └── DeconvolutionAnalyzer (Impulse, Step, Auto Delay Finder)
                │
Main Thread (Lit 3 UI + Charts) ◄────┘
  ├── AudioEngine & HardwareAudioRouter (src/audio/)
  ├── SourceStore, WorkspaceSession & SessionStorage (src/sources/)
  ├── WebSoundMeterApp (src/ui/app-shell.ts, topbar/*, inspectors/*)
  └── ChartPanel (src/charts/* — WebGL2 + HiDPI Canvas2D, rAF-debounced)
```

Detailed architecture and design documentation is available in [`docs/`](./docs/):
- [`docs/01-overview-and-comparison.md`](./docs/01-overview-and-comparison.md)
- [`docs/02-architecture-and-dsp-design.md`](./docs/02-architecture-and-dsp-design.md)
- [`docs/03-roadmap-and-implementation-plan.md`](./docs/03-roadmap-and-implementation-plan.md)
- [`docs/04-testing-and-simulation-design.md`](./docs/04-testing-and-simulation-design.md)
- [`docs/05-persistence-and-state-management.md`](./docs/05-persistence-and-state-management.md)

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `Space` or `C` | Capture current active trace to Stored Sources |
| `D` | Run Auto Delay Finder and apply estimated delay to active Live Measurement |
| `M` | Add a new simultaneous Live Measurement source (`+ Meas`) |

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


