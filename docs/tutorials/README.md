# WebSoundTools — Step-by-Step FOH Tutorials

Each tutorial in this directory is a self-contained, illustrated Front-of-House walkthrough—starting from physical audio interface cabling and gain staging, through 3D room/PA prediction in **WebSpeakerSim**, on-site transfer-function alignment and multi-mic EQ in **WebSoundMeter**, Predict-to-Measure verification, and live-show SPL compliance & feedback control.

> **No hardware connected right now?** Every tutorial includes both **real-world hardware instructions** and matching **Built-in Demo Simulator** steps so you can practice the entire workflow at your desk or on a flight.

---

## Tutorial Series

| # | Tutorial | App(s) | What You Will Learn |
| :--- | :--- | :--- | :--- |
| **01** | **[Hardware Setup, Cabling & Mic Calibration](./01-hardware-setup-and-mic-calibration.md)** | `WebSoundMeter` | Choosing a measurement mic & USB audio interface, wiring a physical reference loopback (`2×2` and `4×4` diagrams), disabling OS voice processing, gain-staging without clipping, loading `.cal` files, and calibrating SPL (`94` / `114 dB`). |
| **02** | **[3D Venue Prediction, Cardioid Subs & Alignment](./02-venue-prediction-and-sub-alignment-in-wss.md)** | `WebSpeakerSim` | Modeling room bounds & audience zones, aiming L/R mains at `4 kHz`, filling near-field gaps, designing a `63 Hz` Cardioid Subwoofer Stack (`CSA`), auto-aligning groups at Virtual Mics, dragging DSP Group EQ handles, and exporting `.FRD` curves. |
| **03** | **[PA Time Alignment, Sub/Top Crossover & Virtual EQ](./03-pa-time-alignment-and-eq-in-wsm.md)** | `WebSoundMeter` | Locking propagation delay to unwrap phase, reading coherence ($\gamma^2$) in noisy/reverberant rooms, aligning Sub + Top phase through crossover, spatial averaging across multiple mics (`+ Math`), and sculpting offline Virtual EQ (`+ EQ`). |
| **04** | **[Predict-to-Measure Field Verification](./04-predict-to-measure-field-verification.md)** | `WebSpeakerSim` $\rightarrow$ `WebSoundMeter` | Taking predicted `.FRD` targets from `WebSpeakerSim` onto the gig in `WebSoundMeter`, computing a live `Measured − Predicted` dB difference trace, and diagnosing room gain, boundary reflections, and horn aiming errors. |
| **05** | **[Live Show SPL Compliance & Feedback Ring-Out](./05-live-show-spl-compliance-and-feedback.md)** | `WebSoundMeter` | Ringing out wedges/mains before doors with narrowband pitch + ISO 31-band GEQ callouts, locking out the signal generator in `🎚 Show` mode, tracking `LAeq15` / `LCeq − LAeq` regulatory limits, and exporting post-show CSV reports. |

---

## Reference Guides

- **[WebSoundMeter User Guide](../../apps/WebSoundMeter/docs/user-guide.md)** — UI tour, chart modes, source types, and keyboard shortcuts (`http://localhost:5173`).
- **[WebSpeakerSim User Guide](../../apps/WebSpeakerSim/docs/user-guide.md)** — UI tour, 3D room coordinates, colormaps, importers, and keyboard shortcuts (`http://localhost:5174`).
