# WebSoundTools — Step-by-Step FOH Tutorials

Each tutorial in this directory is a standalone, illustrated Front-of-House walkthrough—covering physical audio interface cabling and gain staging, 3D venue prediction and subwoofer array design in **WebSpeakerSim**, dual-FFT transfer-function alignment and multi-mic EQ in **WebSoundMeter**, Predict-to-Measure field verification, live-show SPL compliance, and troubleshooting.

> **No audio interface connected right now?** Every tutorial includes both **physical hardware instructions** and matching **Built-in Demo Simulator** steps so you can practice every workflow offline at your desk or on a flight.

---

## Tutorial Index

| # | Tutorial | Application(s) | What You Will Learn |
| :--- | :--- | :--- | :--- |
| **01** | **[Hardware Setup, Cabling & Mic Calibration](./01-hardware-setup-and-mic-calibration.md)** | `WebSoundMeter` | Choosing a measurement mic & USB audio interface, wiring a physical reference loopback (`2×2` and `4×4` diagrams), disabling OS voice DSP, staging preamp headroom (`dBFS` & `CLIP` meters), loading `.cal` curves, and calibrating SPL (`94` / `114 dB`). |
| **02** | **[Club Venue Prediction, Cardioid Subs & Alignment](./02-venue-prediction-and-sub-alignment-in-wss.md)** | `WebSpeakerSim` | Direct `.wss-project.json` file saving (`Cmd/Ctrl + S`), aiming L/R mains at `4 kHz`, filling near-field center gaps with stage-lip front fills, designing a `63 Hz` quarter-wave Cardioid Subwoofer Stack (`CSA`), auto-aligning groups at Virtual Mics, and sculpting DSP Group EQ (`Freq`/`Gain`/`Shift+Q`). |
| **03** | **[PA Time Alignment, Sub/Top Crossover & Virtual EQ](./03-pa-time-alignment-and-eq-in-wsm.md)** | `WebSoundMeter` | Locking propagation delay to unwrap phase, reading coherence (`γ²`) and `Impulse (ETC dB)` reflections, aligning Sub + Top phase through an `LR24` crossover, combining `3+` mics in an N-input `Power Average`, and dialing offline Virtual EQ. |
| **04** | **[Predict-to-Measure Field Verification](./04-predict-to-measure-field-verification.md)** | `WebSpeakerSim` → `WebSoundMeter` | Exporting predicted `.FRD` targets from `WebSpeakerSim`, overlaying and `200 Hz–2 kHz` normalizing them on site in `WebSoundMeter`, computing a smoothed `dB Difference (A / B)` error curve, and diagnosing rigging vs. room acoustics. |
| **05** | **[Live Show SPL Compliance & Feedback Ring-Out](./05-live-show-spl-compliance-and-feedback.md)** | `WebSoundMeter` | Ringing out wedges and mains with narrowband frequency + ISO 31-band GEQ callouts and one-click `Notch EQ`, locking out the hardware generator in `🎚 Show` mode, tracking `LAeq15m` / `LC−LA` limits, and exporting UTC CSV logs. |
| **06** | **[Custom Multi-Zone Venues, End-Fire Subs & Delay Rings](./06-custom-venue-endfire-subs-and-delay-ring.md)** | `WebSpeakerSim` | Sizing editable Venue Grid Bounds, building trapezoidal raked seating and overhanging balconies from scratch, comparing End-Fire vs. Electronic Delay Arc subwoofers, and time-aligning a `26 m` festival delay tower ring with the `Shift + Drag` acoustic ruler. |
| **07** | **[Offline PWA Setup, Troubleshooting & FOH Glossary](./07-troubleshooting-pwa-and-glossary.md)** | `WebSoundMeter` & `WebSpeakerSim` | Installing the offline PWAs, browser/OS requirements (`COOP`/`COEP` & `SharedArrayBuffer`), solving low coherence or clock drift in the field, and a concise glossary of FOH measurement & prediction terms. |

---

## Panel-by-Panel UI Reference Manuals

- **[WebSoundMeter Reference Guide](../../apps/WebSoundMeter/docs/user-guide.md)** — Every topbar control, plot type, measurement setting, math operation, and keyboard shortcut (`http://localhost:5173`).
- **[WebSpeakerSim Reference Guide](../../apps/WebSpeakerSim/docs/user-guide.md)** — 3D venue coordinates, colormaps, CAD viewport gestures, entity inspectors, importers, and keyboard shortcuts (`http://localhost:5174`).
