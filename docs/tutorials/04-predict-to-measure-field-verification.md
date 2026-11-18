# Tutorial 04: Predict-to-Measure Field Verification (`WebSpeakerSim` $\rightarrow$ `WebSoundMeter`)

A venue prediction is only half the story until you hang the PA and verify that the physical rig matches your design. Because **WebSpeakerSim** and **WebSoundMeter** share the exact same `@foh/dsp` filter math and `@foh/acoustics` `.FRD` parser/interpolator, you can carry predicted Virtual Microphone responses straight onto the gig and compute a live **`Measured − Predicted`** error curve in seconds.

---

## Step 1: Export Predicted `.FRD` Target Curves from `WebSpeakerSim`

1. In **WebSpeakerSim** (`http://localhost:5174`), place Virtual Microphones at the exact physical coordinates where you plan to set your measurement mic stands in the venue—for example:
   - **`FOH Mix Position`** (`X = 14.0 m, Y = 0.0 m, Z = 1.65 m`)
   - **`Front Row Off-Axis`** (`X = 3.5 m, Y = 2.5 m, Z = 1.55 m`)
2. Select **`FOH Mix Position`** under **Virtual Mics** in the right-hand **Scene Tree**.
3. In the **Predicted Response @ Mic** card, click **`Export Predicted .FRD`** to download `FOH-Mix-Position.frd` (standard 3-column `Frequency_Hz  SPL_dB  Phase_Deg` format across `20 Hz – 20 kHz`).

![Exporting Predicted .FRD from a Virtual Mic in WebSpeakerSim](../images/01-wss-export-predicted-frd.png)

---

## Step 2: Import the `.FRD` into `WebSoundMeter` on Site

1. At the venue, place your physical measurement microphone at FOH (`X = 14.0 m`), wire your loopback ([Tutorial 01](./01-hardware-setup-and-mic-calibration.md)), and open **WebSoundMeter** (`http://localhost:5173`).
2. Click **`+ .FRD`** in the **Sources** header on the right and select `FOH-Mix-Position.frd`.
3. **Automatic `0 dB` SPL Normalization:**
   - **WebSpeakerSim** exports absolute predicted SPL (for example, `~104 dB SPL`), whereas a dual-FFT transfer function in **WebSoundMeter** centers around `0 dB` relative gain.
   - **WebSoundMeter** automatically normalizes high-SPL `.FRD` curves around their `100 Hz – 4 kHz` passband mean (`0 dB`) upon import so your predicted trace overlays cleanly onto your live `0 dB` transfer function!
   - Select the imported trace in **Stored Sources** anytime to fine-tune **`Gain Offset (dB)`** or **`Delay Offset (ms)`** so midband levels (`500 Hz – 2 kHz`) align to the tenth of a dB.

![Overlaying Imported Predicted .FRD Against Live FOH Measurement](../images/02-wsm-import-and-compare-frd.png)

---

## Step 3: Compute a Live `Measured − Predicted` Difference Curve (`+ Math`)

Rather than squinting at two overlapping traces to spot subtle deviations, let **WebSoundMeter** subtract the prediction from your live measurement:

1. Lock your live FOH measurement delay (`Find & Apply Delay` / `D`) and click **`Capture`** (`C`) to snapshot `FOH Measured` (or keep `Live Measurement` selected directly).
2. Click **`+ Math`** in **Sources** to add a **Math / Union** source.
3. In the **Union Inspector**:
   - Set **Math Operation** to **`dB Difference (A / B)`** (`diff-db`, which plots $L_{\text{Measured}}(f) - L_{\text{Predicted}}(f)$ in dB and $\phi_A - \phi_B$ in degrees).
   - Set **Source A** to your **Live / Captured FOH Measurement**.
   - Set **Source B** to your imported **`FOH-Predicted`** `.FRD` trace.

![Measured Minus Predicted dB Difference Trace Isolating Room Modes & Air Loss](./images/t04-01-measured-minus-predicted-diff.png)

---

## Step 4: How to Diagnose Differences Between Prediction & Reality

Wherever the **`Measured − Predicted`** trace sits near `0 dB`, your physical rig is performing just as modeled! When it deviates, check the frequency band to distinguish **rigging/wiring mistakes** from **normal room acoustics**:

| Deviation Signature | Likely Physical Cause | Action to Take |
| :--- | :--- | :--- |
| **Deep notch (`-10` to `-20 dB`) right at `80–100 Hz`** where prediction was smooth | Subwoofer or Main processor polarity button flipped, or wrong delay preset loaded in amp rack | Check processor polarity (`Ø`) & delay—**do not EQ!** |
| **`+4` to `+8 dB` broad rise below `160 Hz`** compared to free-field/half-space prediction | Side-wall / rear-wall boundary loading ("room gain") and modal buildup not modeled by direct-field + floor bounce | Apply gentle low-shelf / broad parametric cut in Virtual EQ (`+ EQ`) after checking multiple seats |
| **Entire shelf `-6 dB` down above `3 kHz`** at a specific seat | Cabinet vertical tilt angle hung steeper/flatter than the CAD sheet, or HF compression driver muted/blown | Check cabinet inclinometer / rigging pin angle first, then driver continuity (`Solo` box close-up) |
| **Smooth gentle droop above `8–12 kHz`** (`-2` to `-4 dB`) at `25 m+` FOH | Venue air is drier (`20–30% RH`) or warmer than modeled, or heavy stage velour/drapery absorption | Compensate gently with a gentle high-shelf (`Q = 0.7`) if needed at FOH without scorching the front rows |

---

## Step 5: Export Post-Tuning As-Built `.FRD` Archives

Once your PA is aligned and equalized:
1. Capture final post-EQ traces (`FOH Final`, `Balcony Final`, `Front Fill Final`).
2. Select each stored trace and click **`Export .FRD`** in the **Stored Source Inspector** to archive standard `.FRD` show files alongside your `.wss-project.json` venue design for the next tour stop in that room!

---

**Next Step $\rightarrow$** [Tutorial 05: Live Show SPL Compliance & Feedback Ring-Out](./05-live-show-spl-compliance-and-feedback.md)
