# WebSpeakerSim

**WebSpeakerSim** is an offline-capable, browser-based live-sound speaker placement and 3D electro-acoustic direct-field simulation platform built in pure TypeScript with Lit 3, a dedicated Simulation Web Worker, and hybrid WebGL2 + HiDPI Canvas2D rendering.

- **Live Web App:** **[speakersim.mkrsound.com](https://speakersim.mkrsound.com)** *(installable offline PWA)*

---

## Key Features

- **3D Direct-Field & Planar-Reflection Acoustic Prediction:**
  - Complex pressure summation across 3D space accounting for inverse-square spherical spreading ($1/d$), acoustic phase propagation ($e^{-jkd}$), 3D directional balloon attenuation and phase, per-cabinet trim, and DSP Group processing.
  - **ISO 9613-1 Atmospheric Attenuation:** High-frequency air absorption and speed-of-sound $c(T, RH, P)$ modeling across temperature, relative humidity, and barometric pressure.
  - **Ground-Plane Image-Source Reflection:** Toggleable 1st-order floor boundary reflection (`Z = 0 m`) modeling half-space loading and ground-bounce interference via Householder pose reflection.
- **Point Sources, Subwoofer Arrays & Group DSP:**
  - **Point-Source Loudspeakers:** Full 6-DOF placement `(x, y, z)` and orientation (`azimuth`, `tilt`, `roll`), per-cabinet trim (`dB`, `ms`, polarity `Ø`), and optional `Symmetric L/R Pair` mirroring (`Main L` / `Main R`).
  - **Subwoofer Array Designer:** Automated geometry, delay, trim, and polarity synthesis for **Broadside Line**, **Cardioid Stack (CSA)** (`2-box` pairs and `3-box` triplets with `Set λ/4`), **End-Fire**, and **Electronic Delay Arc** deployments.
  - **DSP Processor Groups:** Group gain, delay (`ms`), polarity (`Ø`), mute, Butterworth & Linkwitz-Riley (`12`–`48 dB/oct`) high-pass and low-pass crossovers, and up to `8`-band parametric EQ (`peaking`, `lowshelf`, `highshelf`, `notch`, `allpass`) with on-chart `Freq` / `Gain` / `Shift+Q` handles.
- **Synchronized 2D Plan & Side Section CAD Viewports:**
  - GPU-accelerated **WebGL2 SPL Heatmaps** with `1` / `2` / `3` / `6 dB` isoline contours and stepped isobars across **Broadband Pink**, **Broadband Music**, **Subwoofer Passband (`31.5–100 Hz`)**, and `1/1` single-octave bands (`31.5 Hz` – `16 kHz`).
  - Editable **Venue Grid Bounds** and multi-surface geometry supporting trapezoidal floors, raked orchestra seating, overhanging balconies, and stage rejection zones with live **Mean**, **±3dB %**, and **Stage Rej** metrics.
- **Virtual Measurement Microphones & Alignment:**
  - Place `1..N` virtual probe microphones anywhere in 3D space to inspect high-resolution (`20 Hz – 20 kHz`) predicted **Magnitude (dB)**, **Phase (°)**, **Group Delay (ms)**, **Impulse Arrivals**, and **SPL Histogram**, plus one-click inter-group time/polarity alignment and `.FRD` target export.
- **Loudspeaker Library, Datasheet Spec Builder & Importers:**
  - Built-in loudspeaker models and `3` **Demo Venue Presets** (Live Club, Outdoor Festival Field, Raked Auditorium & Balcony).
  - In-app **Datasheet Spec Builder** (`H° × V°` coverage, `-3 dB` passband, Max SPL @ 1 m) plus client-side importers for `.gll` binary loudspeaker containers, `.clf` polar text files, `.frd` curves, and `.wss-speaker.json` definitions.
- **3-Tier State Persistence & Offline PWA:**
  - Shareable URL state, `220 ms` debounced `localStorage` workspace autosave, `IndexedDB` project & custom speaker library storage, `.wss-project.json` portable bundles, and an installable offline Service Worker PWA.

---

## Architecture

```text
Main Thread (Lit 3 UI + 2D CAD + WebGL2)
  ├── ProjectStore, Undo/Redo & 3-Tier Persistence (src/model/)
  ├── Loudspeaker Library, Spec Builder & File Importers (src/library/)
  ├── Synchronized Plan & Section Viewports (src/viewport/ — WebGL2 SPL + Canvas2D CAD)
  └── Virtual Mic Response Charts (src/charts/ — @foh/charts WebGL2 + Canvas2D Overlay)
          │
          ▼  Scene State / Custom Speaker Balloons
Simulation Worker Thread (src/physics/sim.worker.ts — Pure TypeScript Float32Array)
  ├── 3D Transforms & Householder Planar Image-Source Mirroring (transform3d.ts)
  ├── ISO 9613-1 Atmosphere & Speed of Sound (@foh/acoustics)
  ├── 3D Spherical Directivity Balloon Interpolation (directivity-balloon.ts)
  ├── RBJ Biquads, Butterworth/LR Crossovers & DSP Chains (@foh/dsp)
  ├── 2D/3D Receptor Grid Complex Summation Solver (summation-solver.ts)
  └── High-Resolution Virtual Mic Transfer Function Solver (virtual-mic-solver.ts)
```

## Documentation

- **[User & Inspector Reference (`docs/user-guide.md`)](./docs/user-guide.md)** — Complete reference for 3D venue coordinates, topbar/colormap controls, CAD viewport gestures, entity inspectors, and importers.
- **[Step-by-Step FOH Tutorials (`../../docs/tutorials/`)](../../docs/tutorials/README.md)** — Illustrated walkthroughs for club/balcony/festival prediction, cardioid & end-fire sub arrays, delay rings, and Predict-to-Measure field verification.
- **Developer Design Docs (`docs/dev/`):**
  - [`01-overview-and-system-capabilities.md`](./docs/dev/01-overview-and-system-capabilities.md)
  - [`02-acoustic-physics-and-summation-model.md`](./docs/dev/02-acoustic-physics-and-summation-model.md)
  - [`03-codebase-structure-and-rendering.md`](./docs/dev/03-codebase-structure-and-rendering.md)
  - [`04-loudspeaker-models-and-importers.md`](./docs/dev/04-loudspeaker-models-and-importers.md)
  - [`../../docs/architecture/01-monorepo-and-packages.md`](../../docs/architecture/01-monorepo-and-packages.md) & [`../../docs/architecture/02-persistence-and-pwa.md`](../../docs/architecture/02-persistence-and-pwa.md)

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd / Ctrl + Z` | Undo last scene edit |
| `Cmd / Ctrl + Shift + Z` / `Ctrl + Y` | Redo scene edit |
| `P` | Add Point-Source Loudspeaker (`+ Top`) |
| `S` | Add Subwoofer Array (`+ Sub`) |
| `M` | Add Virtual Measurement Microphone (`+ Mic`) |
| `G` | Toggle 1st-Order Ground Reflection |
| `L` | Open Loudspeaker Library, Spec Builder & Importer |
| `1` / `2` / `3` | Switch Layout (`Split` / `Plan` / `Section`) |
| `?` | Open or close Help, Keyboard Shortcuts & GitHub dialog |
| `Escape` | Close open modal or clear active selection |

---

## Getting Started

```bash
npm install
npm run dev          # Vite dev server with COOP/COEP headers on http://localhost:5174
npm run build        # Production PWA bundle (dist/ + sw.js)
npm test             # Vitest unit & integration suite
npm run test:e2e     # Playwright end-to-end browser suite
```

---

## License

Licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`) — see [`LICENSE`](../../LICENSE). GLL binary container parsing in `src/library/importers/gll/` is ported from [`gll-tools`](https://github.com/cwBudde/gll-tools) (`MIT`, see [`src/library/importers/gll/LICENSE.gll-tools.md`](./src/library/importers/gll/LICENSE.gll-tools.md)).
