# Tutorial 05: Live Show SPL Compliance & Feedback Ring-Out (`WebSoundMeter`)

Once system tuning is complete and doors are about to open, **WebSoundMeter** (`http://localhost:5173`) switches from a dual-FFT alignment analyzer into a concert-safe **Show Mode (`🎚 Show`)**—muting and hiding the hardware Signal Generator, running multi-stage narrowband **Feedback Watch**, and logging statutory **`LAeq` / `LCeq` / `Peak`** compliance with `IndexedDB` crash checkpoints.

---

## 1. Switching Safely Into `🎚 Show` Mode

1. Click **`🎚 Show`** next to the **WebSoundMeter** title in the top-left corner:
   - **Hardware Generator Safety Interlock:** Whenever **`INPUT`** is connected to a physical hardware audio interface, entering **`🎚 Show`** immediately forces **`GEN`** off and hides the generator toolbar so pink noise can never fire mid-show. *(When practicing in `Built-in Demo Simulator` mode, the generator and per-slot `Sim Rig` selectors remain visible so you can test feedback and SPL alerts without hardware.)*
   - **Concert Layout:** The center stack switches to **`Live Show 2x (RTA + SPL History)`** (or choose **`Live Show 3x`** to add live program Transfer Function Magnitude fed from a console matrix reference).

---

## 2. Ringing Out Monitors & Vocal Mics Before Doors

Acoustic feedback begins as a high-$Q$, persistent narrowband sinusoid before turning into a loud howl. Rather than flagging every sustained guitar or synth note, **WebSoundMeter** runs a **5-stage discriminator** (prominence above local spectral median, sub-bin parabolic frequency stability, temporal persistence, amplitude kurtosis, and harmonic overtone rejection) to isolate runaway feedback rings:

1. **Patching for Ring-Out:**
   - **FOH / Room Mic:** Keep your calibrated measurement mic on `In Ch 1` (`FB Watch: FOH Normal`).
   - **Monitor World / Cue Wedge:** Click **`+ Mic`** in **`Live Mics & SPL Watch`**, assign `In Ch 2` to your console `Solo/Cue` bus or stage mic, and set **`FB Watch`** to **`Monitor / Wedge Sensitive`** for fast wedge ring-out.
   - *(Practicing without hardware? Set **`SIM RIG`** to **`6. Live Show Feedback Ring (2.5 kHz & 630 Hz)`**.)*
2. **Reading RTA Callout Flags vs. the Feedback Ring Log:**
   - On the **`Spectrum (RTA)`** chart, each active ring displays a floating callout flag showing exact center frequency + nearest **ISO 31-band GEQ** slider (`◆ 2.48 kHz (ISO 2.5 kHz)`) on line 1, and prominence (`+33.3dB`), estimated `Q`, musical note (`D#7`), and mic name on line 2.
   - In the **`Feedback Ring Log`** card on the right, each row adds severity badges (`◆` runaway feedback, `▲` persistent ring, `●` latched hold) and fine **cents offset** (`D#7 (-6c)`, `D#5 (+21c)`) to distinguish out-of-key cavity resonances from musical pitch centers.
3. **One-Click Surgical Notch (`Notch EQ`):**
   - Click **`Notch EQ`** next to any ring in **`Feedback Ring Log`** to insert a narrowband peaking cut (`Q = 8..24`) into an auto-created `Feedback Notch (<Mic Name>)` Virtual EQ source. Clicking **`Notch EQ`** again on the same ring deepens the notch by `-3.0 dB` per click (down to `-18 dB`).

![Show Topbar in LIMIT State, RTA Feedback Callout Flags & Ring Log Notch EQ](./images/t05-02-show-limit-and-ring-log.png)

---

## 3. Monitoring Venue SPL Limits (`LAeq15m`, `LC−LA` & Peak)

Municipal ordinances and festival sound limits typically enforce **time-integrated equivalent continuous level** (`LAeq,15m` or `LAeq,60m`), often paired with a low-frequency `dBC` or `LZpeak` ceiling:

1. In the **`Show Limits & Log`** card at the bottom right:
   - **`Compliance Alert Metric`:** Select the enforced metric (`LAeq,15m (15-Minute Equivalent)` default, `LAeq,60m`, `LAeq,5m`, `LAeq,1m`, `LCeq,1m`, `LAF`, or `LZpeak`).
   - **`Warn Threshold (dB)` & `Limit Threshold (dB)`:** Defaults are `98 dB` / `102 dB`. Set **`Warn`** `3–4 dB` below your venue ceiling (for example, `94 dB` Warn / `98 dB` Limit) so you get an early heads-up while you still have average bank remaining.
2. **Reading the Topbar Show Strip at a Glance:**
   - **`LAeq1m`:** Your **1-minute "speedometer"**—when `LAeq1m` exceeds the limit, `LAeq15m` will climb steadily; pull the master/VCA back `1–2 dB` early.
   - **`LAeq15m` (`95.6 / 98`):** Your rolling **15-minute legal average** vs. the configured limit.
   - **`LC−LA` (`+11.8 dB`):** Live 1-minute C-minus-A sub-to-mid balance (`+10` to `+15 dB` is typical modern rock/pop; `+18 dB+` indicates heavy sub energy dominating headroom).
   - **Status Badges:** **`● OK`** (green), **`▲ WARN`** (amber + dashed chart guide), and **`◆ LIMIT`** (red + solid chart guide).

![Live Show 15-Minute Concert SPL History Crossing Warning Guide](./images/t05-01-show-spl-compliance-warn.png)

3. **`SPL / Leq History` Timeline Controls:**
   - **Time Span:** `1 min`, `5 min` (`4 Hz` high-resolution buffer), `15 min`, `60 min`, or `4 hours` (`1 Hz` 4-hour ring buffer).
   - **Trace Mode:** `Compliance (LAeq15m + LAeq1m + Pk)`, `dBA (Fast + LAeq1m)`, `dBA vs dBC (Leq1m)`, or `Multi-Mic (LAeq1m per Mic)` to compare FOH against Front Barrier or Nearest Neighbor simultaneously.

---

## 4. Crash Checkpoints (`30-Min` Window) & UTC CSV Export

- **Automatic `IndexedDB` Checkpoints:** Every `10 seconds` during active capture, **WebSoundMeter** saves all live slots' `1 Hz` energy ring buffers to `IndexedDB` (`spl-show-logs`). If the browser reloads mid-set, checkpoints **less than `30 minutes` old** restore automatically into both the `15m/60m/4h` and `1m/5m` timelines. (Checkpoints older than `30 minutes` expire automatically; click **`Reset Log`** before the first act to clear manually.)
- **Downloading the Official CSV Report:** At curfew, click **`CSV ⬇`** in **`Show Limits & Log`** to download `websoundmeter-spl-log-<YYYY-MM-DDTHH-mm-ss-sssZ>.csv` in chronological long format—one row per active microphone slot per second (`timestamp_iso, slot_id, laf_db, lcf_db, laeq_1m_db, lceq_1m_db, laeq_5m_db, laeq_15m_db, laeq_60m_db, lpeak_db`).

---

*Return to the [FOH Tutorial Index](./README.md).*
