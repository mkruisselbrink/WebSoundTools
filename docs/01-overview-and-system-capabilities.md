# 01. Product Overview & System Capabilities

## 1. Purpose

`WebSpeakerSim` is a browser-based electro-acoustic direct-field prediction and loudspeaker deployment design application built with **TypeScript**, **Lit 3**, **Web Workers**, and **WebGL2 / HiDPI 2D Canvas**.

Live sound reinforcement design requires predicting how multiple distributed acoustic sources—main L/R loudspeakers, front-fills, out-fills, delay rings, and directional subwoofer arrays—combine across a 3D audience geometry in both **amplitude** and **phase**. `WebSpeakerSim` runs entirely client-side with zero native dependencies, providing real-time spatial SPL mapping, phase-accurate virtual measurement microphones, and loudspeaker/subwoofer alignment tools offline in the browser.

---

## 2. Core Workflow & Domain Model

### 2.1 Venue & Audience Surfaces
A project defines one or more 3D **Audience Surfaces** and optional **Stage / Rejection Zones**:
- **Flat Listening Planes:** Horizontal rectangular or trapezoidal areas (e.g., main standing floor or seated orchestra level) with configurable **Ear Height** above the surface (`1.65 m` standing, `1.20 m` seated).
- **Raked / Sloped Tiers & Balconies:** Elevated planes defined by start/end `X` coordinates, width (`Y`), and start/end elevation (`Z`), enabling accurate vertical aiming and front-to-back throw analysis in Section View.
- **Stage & Non-Audience Zones:** Regions where low sound pressure is desired, enabling quantitative **Audience-to-Stage Rejection ($\text{dB}$)** metrics—particularly useful when optimizing cardioid and end-fire subwoofer deployments.

### 2.2 Sound Sources & Array Groups
 initial phases focus on **Point-Source Loudspeakers** and **Subwoofer Arrays**, backed by general 6-DOF 3D rigid-body transforms so multi-element flown arrays can plug into the same solver later:
1. **Point Sources:** Individual full-range or fill enclosures positioned at `(x, y, z)` in meters with Euler aiming angles (`azimuth` $\phi$, `tilt` $\theta$, `roll` $\psi$), optional Left/Right mirror symmetry across $y = 0$, and assignment to a shared **DSP Group**.
2. **Subwoofer Arrays:** Parameterized multi-cabinet low-frequency deployments that automatically generate constituent cabinet positions, polarities, and electronic delays:
   - **Broadside Array (Straight / Spaced Stack)** with optional **Electronic Delay Arc** steering for horizontal coverage widening.
   - **Cardioid Subwoofer Array (CSA / Inverted Gradient Stack)** combining forward-firing and rear-facing/inverted elements with quarter-wave spacing/delay cancellation toward the stage.
   - **End-Fire Array** aligning $N$ coaxially spaced cabinets along the throw axis (+X) with progressive inter-cabinet propagation delays $\Delta \tau = \Delta x / c$.

### 2.3 DSP Signal Chain
Every source group (and optional per-cabinet trim) passes through a deterministic complex frequency-domain DSP transfer function $H_{\text{DSP}}(f)$:
- **Gain ($\text{dB}$)**, **Mute**, and **Polarity Inversion ($180^\circ$)**
- **Electronic Delay ($\text{ms}$ and equivalent air distance $\text{m}$)**
- **High-Pass & Low-Pass Crossover Filters:** Butterworth (`12`/`18`/`24`/`48 dB/oct`) and Linkwitz-Riley (`LR12`, `LR24`, `LR48`) with exact phase shift
- **Parametric EQ & Allpass Cascade:** Up to 8 biquad sections (`peaking`, `lowshelf`, `highshelf`, `notch`, `allpass1`, `allpass2`)

### 2.4 Dual-Resolution Acoustic Evaluation
To maintain interactive 60 FPS manipulation while preserving fine frequency-domain phase accuracy, `WebSpeakerSim` runs two complementary solvers inside `src/physics/sim.worker.ts`:
1. **Spatial Heatmap Solver (`SummationSolver`):** Evaluates complex pressure summation across a 2D receptor mesh on all active audience surfaces (Plan View) and along a movable vertical cut plane (Section View). Supports coarse-to-fine progressive refinement (`1.0 m` interactive drag pass $\rightarrow$ `0.25 m` settled pass) across selectable single bands (`Sub`, `1/3`-octave, `1/1`-octave) or broadband **Z / A / C-weighted** program spectra.
2. **Virtual Microphone Solver (`VirtualMicSolver`):** Evaluates 240+ logarithmically spaced frequency bins from `20 Hz` to `20 kHz` at discrete probe coordinates `(x, y, z)`, producing predicted **Magnitude ($\text{dB SPL}$)**, **Wrapped/Unwrapped Phase ($^\circ$)**, **Group Delay ($\text{ms}$)**, and **Discrete Arrival Impulses**.

---

## 3. Capabilities Summary

| Capability | Specification |
| :--- | :--- |
| **Coordinate System** | Right-handed 3D Cartesian meters: $+X$ Stage-to-FOH depth, $+Y$ Stage Right-to-Left width ($Y=0$ centerline), $+Z$ Vertical height ($Z=0$ floor/ground). |
| **Viewports** | Synchronized **2D Plan (Top $X\text{–}Y$)** and **2D Section (Side $X\text{–}Z$)** views with WebGL2 false-color SPL contours and HiDPI Canvas2D CAD overlays. |
| **Atmospheric Model** | **ISO 9613-1** air absorption $\alpha(f, T, RH, P_{\text{atm}})$ and temperature/humidity-adjusted speed of sound $c$. |
| **Boundary Reflections** | Toggleable **1st-order Ground-Plane Image Source** ($Z = 0$) with configurable acoustic reflection factor $R_g \in [0, 1]$ (general planar reflector formulation). |
| **Loudspeaker Data** | Built-in parametric active tops & subwoofers, interactive **Datasheet Spec Builder**, and client-side `.gll`, `.clf`, `.frd`, and `.json` importers. |
| **Alignment Tools** | Inter-group arrival delta & crossover phase alignment solver; automated Cardioid, End-Fire, and Electronic Arc subwoofer calculators. |
| **State & Offline Support** | Full Undo/Redo command stack, 3-tier persistence (`URL` + `localStorage` + `IndexedDB`), and zero-network Service Worker PWA. |

---

## 4. Licensing

`WebSpeakerSim` is licensed under the **GNU General Public License v3.0 or later (`GPL-3.0-or-later`)**. All acoustic physics, 3D geometry, DSP filter math, and file parsers are implemented in clean, self-contained TypeScript over `Float32Array` buffers from published physical standards (ISO 9613-1, IEC 61672 weighting curves, classical piston/horn radiation theory, and RBJ Audio EQ Cookbook biquad transfer functions).
