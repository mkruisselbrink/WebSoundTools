# Tutorial 05: Live Show SPL Compliance & Feedback Ring-Out (`WebSoundMeter`)

Once system tuning is complete and doors are about to open, **WebSoundMeter** switches from a dual-FFT alignment analyzer into a concert-safe **Show Mode (`🎚 Show`)**—muting and locking out the hardware Signal Generator, activating multi-stage narrowband **Feedback Watch**, and logging statutory **`LAeq` / `LCeq` / `Peak`** sound-level compliance with crash-resilient `IndexedDB` checkpoints.

---

## 1. Switching Safely Into `🎚 Show` Mode

1. Click **`🎚 Show`** next to the **WebSoundMeter** title in the top-left corner:
   - **Generator Safety Interlock:** When connected to a hardware audio interface, switching to **`🎚 Show`** immediately mutes and hides the Signal Generator controls so nobody can accidentally fire pink noise into a live PA mid-concert.
   - **Concert Layout:** The center workspace switches to **`Live Show 2x (RTA + SPL History)`** (or choose **`Live Show 3x`** if you also want live program Transfer Function Magnitude running from a console matrix reference!).

![Show Mode Overview with Feedback Callouts & SPL History](../../apps/WebSoundMeter/docs/images/05-live-show-spl-and-feedback.png)

---

## 2. Step-by-Step: Ringing Out Monitors & Vocal Mics Before Doors

Acoustic feedback starts as a high-$Q$, persistent narrowband sinusoid long before it turns into a painful howl. Unlike basic peak-hold RTAs that cry wolf on every sustained electric guitar note or synth pad, **WebSoundMeter** runs a **multi-stage discriminator** (prominence above local spectral median, sub-bin parabolic frequency stability, temporal persistence, amplitude kurtosis, and harmonic overtone rejection) to isolate true runaway feedback rings:

1. **Patching for Monitor / Vocal Ring-Out:**
   - **FOH / Room Mic:** Leave your measurement microphone at FOH (`In Ch 1`) to catch vocal-to-main-PA rings.
   - **Monitor World / Cue Wedge:** Patch a console `Solo/Cue` bus or stage measurement mic into `In Ch 2` (`+ Mic` in the **`Live Mics & SPL Watch`** card) and set **Feedback Watch Mode** to **`Monitor Sensitive (Fast)`** for rapid wedge ring-out (`FOH Normal` uses slightly longer persistence during full-band music to avoid false positives).
   - *(Practicing without hardware? Select **`6. Live Show Feedback Ring (2.5 kHz & 630 Hz)`** in the **`Sim Rig`** dropdown inside **`Live Mics & SPL Watch`**!)*
2. **Reading the Live Callout Flags & Ring Log:**
   - On the **Spectrum (RTA)** chart, each active feedback ring receives a floating callout flag displaying:
     - **Exact Center Frequency (`Hz`)** (e.g., `2480 Hz` and `630 Hz`)
     - **Musical Note + Cents Offset** (e.g., `D#7 +21c`—helpful for telling whether a tone is a song's key root vs. an out-of-key cavity resonance!)
     - **Nearest ISO 31-Band Graphic EQ Slider** (e.g., `GEQ 2.5k` or `GEQ 630`—so you know immediately which physical or console GEQ fader to pull!)
3. **One-Click Surgical Notch Preview (`Notch EQ`):**
   - In the **`Feedback Ring Log`** card on the right, click **`Notch EQ`** next to any detected ring to automatically insert a high-$Q$ narrowband notch filter at that exact frequency and suggested attenuation depth into your Virtual EQ source.

---

## 3. Step-by-Step: Configuring Venue SPL Limits (`LAeq15`, `LC−LA` & Peak)

Municipal ordinances and festival sound limits almost never judge concerts by instantaneous meter bounces—they measure **time-integrated energy equivalent level** (`LAeq,15m` or `LAeq,60m`), often paired with a low-frequency `dBC` ceiling or `LZpeak` limit.

1. Locate the **`Show Limits & Log`** card at the bottom of the right-hand **Show Sidebar**:
   - **Compliance Alert Metric:** Choose the statutory metric enforced by your venue (`LAeq,15m`, `LAeq,60m`, `LAeq,5m`, `LAeq,1m`, `LCeq,1m`, `LAF`, or `LZpeak`).
   - **Warn Threshold (dB) & Limit Threshold (dB):** Enter your personal amber heads-up threshold (e.g., **`95 dB`**—giving yourself `3 dB` of mix headroom) and the hard venue ceiling (e.g., **`98 dB`**).
2. **Reading the Topbar Show Metrics Strip at a Glance:**
   - **`LAeq1m` (`1-minute rolling`):** Your **"speedometer"**—if `LAeq1m` is running at `100 dBA`, your `LAeq15m` *will* climb toward `100 dBA` over the next few songs; pull the master/VCA back `2 dB` now while you still have average bank left!
   - **`LAeq15m` (`95.4 / 98`):** Your **"odometer / legal average"** against the configured limit.
   - **`LC−LA` (`+14.2 dB`):** The live C-weighted minus A-weighted gap—a quick sub-heavy mix check (`+10` to `+15 dB` is typical modern rock/pop; `+18` to `+22 dB` indicates heavy sub energy dominating the room).
   - **Colorblind-Safe Status Badges & Threshold Lines:**
     - `● OK` (Green) $\rightarrow$ below Warning
     - `▲ WARN` (Amber + dashed chart guide) $\rightarrow$ between Warning and Limit
     - `◆ LIMIT` (Red + double-weight chart guide) $\rightarrow$ at or above Limit

![Live Show Multi-Mic Monitoring Showing Warning Threshold Guides & Ring Log](./images/t05-01-show-spl-compliance-warn.png)

3. **Exploring the `SPL / Leq History` Timeline:**
   - Use the **Time Span** dropdown in the bottom chart header (`1 min`, `5 min`, `15 min`, `60 min`, or `4 hours`) to zoom from song-by-song dynamics out to the entire headliner set.
   - Switch **Trace Mode** between **`dBA (Fast + Leq1m)`**, **`dBA vs dBC (Leq1m)`**, **`Compliance (Leq15m + Leq60m + Peak)`**, or **`Multi-Mic Comparison`** (comparing FOH vs. Front Barrier or Nearest Neighbor simultaneously!).

---

## 4. Crash-Resilient Checkpoints & Post-Show CSV Export

- **Automatic 10-Second `IndexedDB` Checkpoints:** Every 10 seconds during unpaused measurement, **WebSoundMeter** checkpoints all active microphones' `1 Hz` linear energy ring buffers into `IndexedDB` (`spl-show-logs`). If a browser tab accidentally reloads mid-set, rolling `LAeq15m` and `LAeq60m` pick right back up without losing prior songs! (Click **`Reset Log`** before the opening band's set to start a fresh show log.)
- **Downloading the Official CSV Report:** At curfew, click **`CSV ↓`** in **`Show Limits & Log`** to save `websoundmeter-spl-log-YYYY-MM-DD-HHmm.csv` containing second-by-second ISO timestamps, `LAF`, `LCF`, `LAeq1m`, `LCeq1m`, `LAeq5m`, `LAeq15m`, `LAeq60m`, and `LPeak` across every active microphone slot.

---

**Back to Overview $\rightarrow$** [All WebSoundTools Tutorials](./README.md)
