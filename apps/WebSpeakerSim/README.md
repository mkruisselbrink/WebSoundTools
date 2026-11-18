# WebSpeakerSim

**WebSpeakerSim** is an offline-capable, browser-based live-sound speaker placement and 3D electro-acoustic direct-field simulation platform built in pure TypeScript with Lit 3, a dedicated Simulation Web Worker, and hybrid WebGL2 + HiDPI Canvas2D rendering.

---

## Key Features

- **3D Direct-Field & Planar-Reflection Acoustic Prediction:**
  - Complex pressure summation across 3D space accounting for inverse-square spherical spreading ($1/d$), acoustic phase propagation ($e^{-jkd}$), 3D directional balloon attenuation and phase, and per-source DSP filtering.
  - **ISO 9613-1 Atmospheric Attenuation:** Accurate high-frequency air absorption and speed-of-sound $c(T, RH, P)$ modeling across temperature, relative humidity, and barometric pressure.
  - **Ground-Plane Image-Source Reflection:** Toggleable 1st-order boundary reflection modeling half-space loading and ground-bounce interference for subwoofers and ground-stacked sources (built on a general planar reflector interface).
- **Point Sources & Subwoofer Array Design:**
  - **Point-Source Loudspeakers:** Full 6-DOF placement `(x, y, z)` and orientation (`azimuth`, `tilt`, `roll`) for mains, front-fills, out-fills, and delay rings, with optional L/R symmetry linking.
  - **Subwoofer Array Calculators:** Interactive synthesis and delay/polarity optimization for **Broadside Cardioid (CSA)**, **End-Fire**, **Inline Gradient**, and **Electronic Delay Arc** subwoofer deployments.
  - **Per-Source & Group DSP Chain:** Gain, polarity inversion, propagation delay (`ms` / `m`), Butterworth & Linkwitz-Riley (`12`/`24`/`48 dB/oct`) crossovers, allpass phase filters, and 8-band parametric EQ.
- **Synchronized 2D Plan & Side Section Views:**
  - GPU-accelerated **WebGL2 SPL Heatmaps** with `3 dB` / `6 dB` isoline contours across Sub-band, `1/3`-octave, `1/1`-octave, and broadband **A / C / Z-weighted** program spectra.
  - Multi-surface audience geometry supporting flat floors, raked/sloped seating, elevated balconies, and stage/rejection zones with coverage homogeneity metrics ($\pm 3\text{ dB}$ %, mean SPL, and audience-to-stage rejection).
- **Virtual Measurement Microphones & Alignment:**
  - Place `1..N` virtual probe microphones anywhere in the venue to inspect high-resolution (`20 Hz – 20 kHz`) predicted **Magnitude (dB)**, **Phase (°)**, **Group Delay (ms)**, and **Impulse Arrival Times**, plus automated inter-group delay alignment.
- **Loudspeaker Library, Spec Builder & Client-Side Importers:**
  - Built-in parametric loudspeaker models (active 2-way tops & subwoofers) and ready-to-run **Demo Venue Presets**.
  - In-app **Datasheet Spec Builder** plus client-side importers for `.gll` binary loudspeaker containers, `.clf` polar text files, `.frd`/CSV responses, and JSON definitions.
- **3-Tier State Persistence & Offline PWA:**
  - Shareable URL state, automatic `localStorage` workspace recovery, `IndexedDB` project & custom speaker library storage, and an installable Service Worker PWA that runs 100% offline.

---

## Architecture

```text
Main Thread (Lit 3 UI + 2D CAD + WebGL2)
  ├── ProjectStore, Undo/Redo & 3-Tier Persistence (src/model/)
  ├── Loudspeaker Library, Spec Builder & File Importers (src/library/)
  ├── Synchronized Plan & Section Viewports (src/viewport/ — WebGL2 SPL + Canvas2D CAD)
  └── Virtual Mic Response Charts (src/charts/ — WebGL2 Traces + Canvas2D Overlay)
          │
          ▼  Scene State / Slice Descriptors
Simulation Worker Thread (src/physics/sim.worker.ts — Pure TypeScript Float32Array)
  ├── 3D Transforms & Planar Image-Source Mirroring (transform3d.ts)
  ├── ISO 9613-1 Atmosphere & Speed of Sound (atmosphere.ts)
  ├── 3D Spherical Directivity Balloon Interpolation (directivity-balloon.ts)
  ├── RBJ Cookbook Biquads & Linkwitz-Riley Crossovers (biquad.ts)
  ├── 2D/3D Receptor Grid Complex Summation Solver (summation-solver.ts)
  └── High-Resolution Virtual Mic Transfer Function Solver (virtual-mic-solver.ts)
```

Detailed user tutorials, engineering guides, and physics documentation are available in [`docs/`](./docs/) and [`../../docs/tutorials/`](../../docs/tutorials/README.md):
- **[`docs/user-guide.md`](./docs/user-guide.md) — User Guide & Quick Reference**
- **[`../../docs/tutorials/`](../../docs/tutorials/README.md) — Detailed Step-by-Step FOH Tutorials:**
  - [`02-venue-prediction-and-sub-alignment-in-wss.md`](../../docs/tutorials/02-venue-prediction-and-sub-alignment-in-wss.md)
  - [`04-predict-to-measure-field-verification.md`](../../docs/tutorials/04-predict-to-measure-field-verification.md)
- [`docs/dev/01-overview-and-system-capabilities.md`](./docs/dev/01-overview-and-system-capabilities.md)
- [`docs/dev/02-acoustic-physics-and-summation-model.md`](./docs/dev/02-acoustic-physics-and-summation-model.md)
- [`docs/dev/03-codebase-structure-and-rendering.md`](./docs/dev/03-codebase-structure-and-rendering.md)
- [`docs/dev/04-loudspeaker-models-and-importers.md`](./docs/dev/04-loudspeaker-models-and-importers.md)
- [`../../docs/architecture/01-monorepo-and-packages.md`](../../docs/architecture/01-monorepo-and-packages.md) & [`../../docs/architecture/02-persistence-and-pwa.md`](../../docs/architecture/02-persistence-and-pwa.md)

---

## Getting Started

```bash
# Install dependencies
npm install

# Start Vite development server
npm run dev

# Type-check and build production bundle
npm run build

# Run Vitest unit & integration test suite
npm test

# Run Playwright end-to-end browser tests
npm run test:e2e
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd / Ctrl + Z` | Undo last scene edit |
| `Cmd / Ctrl + Shift + Z` / `Ctrl + Y` | Redo scene edit |
| `P` | Add Point-Source Loudspeaker |
| `S` | Add Subwoofer Array |
| `M` | Add Virtual Measurement Microphone |
| `G` | Toggle 1st-Order Ground Reflection |
| `L` | Open Loudspeaker Library, Spec Builder & Importer |
| `1` / `2` / `3` | Switch Layout (`Split` / `Plan Only` / `Section Only`) |
| `Escape` | Close modal or clear active selection |

---

## License & Acknowledgements

This project is licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`) — see [`LICENSE`](../../LICENSE) for details.

Binary `.gll` (`EGLL`) format specifications in [`src/library/importers/gll-importer.ts`](./src/library/importers/gll-importer.ts) were informed by [`cwBudde/gll-tools`](https://github.com/cwBudde/gll-tools) by Christian-W. Budde (MIT License).

