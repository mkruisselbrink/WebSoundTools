# WebSoundMeter

**WebSoundMeter** is an offline-capable, browser-based multi-channel acoustic measurement, PA alignment, and sound level metering platform built in pure TypeScript with Web Audio (`AudioWorklet`), lock-free `SharedArrayBuffer` ring buffers, a dedicated DSP `Worker`, and hybrid WebGL2 + HiDPI Canvas2D charting.

- **Live Web App:** **[meter.mkrsound.com](https://meter.mkrsound.com)** *(installable offline PWA)*

---

## Key Features

- **Multi-Channel Dual-FFT Acoustic Analysis (`Measurement` vs. `Reference`):**
  - **Simultaneous Multi-Channel Live Measurements (`+ Meas` / `M`):** Run concurrent live measurement pipelines across up to `8` distinct physical hardware input taps (for example, `7` measurement microphones sharing `1` physical loopback reference channel, or `8` microphones against the internal digital generator loopback) or independent Demo Simulator presets. Transform/averaging settings synchronize across live slots so spatial averages (`Math Union`) share identical frequency bins, while delay, gain, polarity, input filter, and calibration remain per-measurement.
  - **Global Reference (`Ref`) with Per-Measurement Override:** Configure a global reference channel (`Internal Gen` or `In Ch 1..N`) in the Topbar while allowing individual live measurements to override their reference channel under **Advanced Settings**.
  - **Preamp Headroom Metering (`dBFS` + `CLIP`):** Live pre-gain RMS/Peak `dBFS` bars and `-0.5 dBFS` clip indicators on both Measurement (`Meas M`) and Reference (`Ref R`) taps.
  - **Dual-Real Packed Radix-2 FFT** (`1024` to `32768` points) transforming both Measurement and Reference channels in a single complex FFT pass.
  - **Transfer Function Estimators:** $H_1(f) = \langle G_{rm}(f) \rangle / \langle G_{rr}(f) \rangle$ cross-spectral estimator for uncorrelated room noise rejection, plus $\lvert M(f) \rvert / \lvert R(f) \rvert$ ratio mode with complex unit-vector phase averaging.
  - **Magnitude-Squared Coherence (`γ²`):** Independent rolling cross-spectral window with `Alpha Fade`, `Hard Cutoff` (`γ² ≥ 20%..95%`), or `Off` blanking modes.
  - **Regularized Deconvolution:** Tikhonov-regularized inverse FFT impulse response (`Linear` and logarithmic `ETC dB`), step response, polarity detection, and parabolic sub-sample **Auto Delay Finder**.
  - **Fractional-Octave Smoothing:** `O(1)` prefix-sum `1/48`, `1/24`, `1/12`, `1/6`, `1/3`, and `1/1` octave magnitude and complex phase smoothing.
- **IEC 61672 Broadband Metering & Live Show Compliance:**
  - Simultaneous **A**, **C**, and **Z** frequency weightings with **Fast** (`125 ms`), **Slow** (`1000 ms`), **Impulse** (`35 ms`), **Leq**, and **Peak** readouts.
  - **Show Mode (`🎚 Show`):** Hardware generator safety lockout, `4`-hour rolling `LAeq1m` / `LAeq5m` / `LAeq15m` / `LAeq60m` & `LCeq − LAeq` tracking with `IndexedDB` crash checkpoints, UTC CSV compliance export, and multi-stage narrowband **Feedback Watch** with one-click `Notch EQ` insertion.
- **Built-in Demo Simulator & Signal Generator:**
  - Zero-setup synthetic acoustic rig modeling multi-tap reflections, propagation delay, room modes, HF air absorption, sub/top Linkwitz-Riley crossovers, and live feedback rings (`6` presets).
  - Built-in **Pink Noise**, **White Noise**, **Brown Noise**, **Burst Pink**, **1 kHz Sine**, and **2s Log Sweep** generator with hardware output routing (`Out Ch 1+2`, `Out Ch 1..N`, or `Mute Out`) and automatic safety mute when switching to hardware inputs.
- **Virtual Sources, 3-Tier Persistence & Offline PWA:**
  - **URL Query & History State (`url-state.ts`):** Shareable URL query parameters with Browser Back/Forward (`popstate`) support.
  - **Workspace Session (`workspace-session.ts`):** Synchronous `localStorage` persistence for multi-slot live measurement configs, global reference routing, remembered hardware device labels, and generator settings.
  - **IndexedDB Library (`session-storage.ts`):** Persistent storage for **Stored Traces**, **Virtual Parametric EQ** (Butterworth/LR `12–48 dB/oct` crossovers, up to `12` biquad bands with draggable `Freq`/`Gain`/`Shift+Q` handles, and target-aware `Auto-Match Room`), **Math / Union Sources** (N-input `Vector Average`, `Power Average`, `Vector Sum`, `Minimum/Maximum Envelope`, plus binary `Vector Subtract`, `dB Difference`, and `Apply Filter`), and **Microphone Calibration Curves** (`.cal` / `.frd` / `.txt`).
  - **Installable Offline PWA:** Web App Manifest (`manifest.webmanifest`) and build-time precaching Service Worker (`sw.js`) with offline `COOP`/`COEP` headers for `SharedArrayBuffer`.

---

## Architecture

```text
Audio Thread (AudioWorklet + Dynamic 64ch ChannelSplitter)
  └── capture-worklet.ts ──► MultiChannelRingBuffer (8 Hardware Taps + Internal Loopback)
                                     │
DSP Worker Thread (dsp.worker.ts) ◄──┘
  ├── SignalGenerator + Per-Slot SyntheticAcousticRig (Simulator Mode)
  └── Multi-Slot MeasurementPipeline[]
        ├── Pre-Gain dBFS Meter + Input Gain, Polarity & Pre-Filters (Z / A / C / 1 kHz Notch)
        ├── BroadbandMeterBank (IEC 61672 A / C / Z, Fast / Slow / Impulse / Leq) + SplHistoryTracker
        ├── Radix2FFT (Dual-Real Packed Cooley–Tukey + Float64 Twiddle Tables)
        ├── TransferFunctionAnalyzer (H1 / Ratio, FIFO / LPF Averaging, Coherence) + FeedbackDetector
        └── DeconvolutionAnalyzer (Impulse, ETC dB, Step, Auto Delay Finder)
                │
Main Thread (Lit 3 UI + Charts) ◄────┘
  ├── AudioEngine & HardwareAudioRouter (src/audio/)
  ├── SourceStore, WorkspaceSession & SessionStorage (src/sources/)
  ├── WebSoundMeterApp (src/ui/app-shell.ts, topbar/*, inspectors/*)
  └── ChartPanel (src/charts/* — @foh/charts WebGL2 + HiDPI Canvas2D)
```

## Documentation

- **[User & Controls Reference (`docs/user-guide.md`)](./docs/user-guide.md)** — Complete reference for every topbar control, plot mode, inspector setting, math operation, and shortcut.
- **[Step-by-Step FOH Tutorials (`../../docs/tutorials/`)](../../docs/tutorials/README.md)** — Illustrated walkthroughs for hardware setup, PA alignment, Predict-to-Measure verification, Show SPL compliance, and troubleshooting.
- **Developer Design Docs (`docs/dev/`):**
  - [`01-overview-and-comparison.md`](./docs/dev/01-overview-and-comparison.md)
  - [`02-architecture-and-dsp-design.md`](./docs/dev/02-architecture-and-dsp-design.md)
  - [`03-codebase-structure-and-modules.md`](./docs/dev/03-codebase-structure-and-modules.md)
  - [`04-testing-and-simulation-design.md`](./docs/dev/04-testing-and-simulation-design.md)
  - [`05-spl-history-and-logging.md`](./docs/dev/05-spl-history-and-logging.md)
  - [`06-feedback-detection-design.md`](./docs/dev/06-feedback-detection-design.md)
  - [`../../docs/architecture/01-monorepo-and-packages.md`](../../docs/architecture/01-monorepo-and-packages.md) & [`../../docs/architecture/02-persistence-and-pwa.md`](../../docs/architecture/02-persistence-and-pwa.md)

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `Cmd / Ctrl + Z` | Undo last authored Stored Trace, Virtual EQ, or Math Union edit |
| `Cmd / Ctrl + Shift + Z` / `Ctrl + Y` | Redo authored edit |
| `Space` | Pause / Resume live measurement and signal generator |
| `C` | Capture current active trace to Stored Traces |
| `D` | Find & Apply estimated propagation delay on active Live Measurement |
| `M` | Add a new simultaneous Live Measurement slot (`+ Meas`) |
| `E` | Create a new Virtual Parametric EQ source (`+ EQ`, Tuning mode) |
| `U` | Create a new Math Union source (`+ Math`, Tuning mode) |
| `R` | Reset averaging buffers and peak-hold accumulators on active slot |
| `1` / `2` / `3` | Switch between 1, 2, or 3 stacked chart panels |
| `?` | Open or close Help, Keyboard Shortcuts & GitHub dialog |
| `Escape` | Close dialog, collapse Advanced Settings, or return selection to active Live Measurement |

---

## Getting Started

```bash
npm install
npm run dev          # Vite dev server with COOP/COEP headers on http://localhost:5173
npm run build        # Production PWA bundle (dist/ + sw.js)
npm test             # Vitest unit & integration suite
npm run test:e2e     # Playwright end-to-end browser suite
```

---

## License & Acknowledgements

Licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`) — see [`LICENSE`](../../LICENSE).

Inspired by [Open Sound Meter (OSM)](https://opensoundmeter.com/) by Pavel Smokotnin (`GPL-3.0`).
