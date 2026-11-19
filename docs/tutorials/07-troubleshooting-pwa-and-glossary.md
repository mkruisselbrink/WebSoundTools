# Tutorial 07: Offline PWA Setup, Troubleshooting & FOH Glossary

Live venues rarely have reliable Wi-Fi at Front of House. Both **WebSoundMeter** and **WebSpeakerSim** are offline-capable Progressive Web Apps (PWAs) that run 100% locally in your browser with zero cloud accounts or server processing.

---

## 1. Browser Requirements & Installing Offline PWAs

### Recommended Browsers & Operating Systems
- **Best Real-Time Multi-Channel Support:** **Google Chrome**, **Microsoft Edge**, or **Brave** (`v120+`) on **macOS** or **Windows 11**. Chromium browsers expose multi-channel USB/Thunderbolt/Dante audio interfaces (`up to 64 channels` via `AudioWorklet` + `ChannelSplitterNode`) and support one-click desktop PWA installation.
- **Firefox & Safari Notes:** Both run **WebSpeakerSim** (WebGL2 + Web Workers) and 2-channel **WebSoundMeter** measurements cleanly. On multi-channel (`4+ ch`) USB interfaces, Safari and some Firefox builds downmix or cap `getUserMedia` to stereo `Ch 1–2`; use Chrome or Edge when running `3+` simultaneous hardware mics.

### Installing for 100% Offline Show Use
1. Open the hosted app URL (or build and preview locally via `npm run build && npx vite preview --port 5173` inside `apps/WebSoundMeter` or `apps/WebSpeakerSim`).
2. Wait two seconds on first load for the Service Worker (`sw.js`) to precache all application code, workers, and audio worklets.
3. Click the **Install App** icon in the right side of the browser address bar (*Install WebSoundMeter* / *Install WebSpeakerSim*). The app now launches directly from your macOS Dock or Windows Start Menu inside a dedicated standalone window—even with Wi-Fi turned off at the venue.

### Cross-Origin Isolation (`SharedArrayBuffer` vs. `MessagePort` Fallback)
- When served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers (configured automatically in `vite.config.ts` and preserved offline by `@foh/pwa`'s Service Worker), **WebSoundMeter** streams audio from the `AudioWorklet` thread to the DSP Worker over a zero-copy lock-free `SharedArrayBuffer` ring buffer.
- If hosted on a static file server that omits `COOP`/`COEP` headers, **WebSoundMeter** automatically falls back to batched `1024`-sample `MessagePort` transfers—every chart, transfer function, and SPL meter continues to work without error.

---

## 2. Field Troubleshooting FAQ

### "I selected my USB audio interface, why is everything silent / Paused?"
- After reloading a browser tab in **Hardware** mode, browsers block `AudioContext` startup until you click **`Resume`** (or press **`Space`**).
- On **macOS**, check **System Settings → Privacy & Security → Microphone** and ensure your browser is switched **ON**.

### "Why is Coherence (`γ²`) low (`< 30%`) across the entire spectrum?"
Check these four common culprits in order:
1. **Uncompensated long propagation delay:** At `4096`-point FFT (`~85 ms` window @ `48 kHz`), if your mic is `25 m` (`73 ms`) away and **`Ref Delay`** is `0 ms`, almost none of the `85 ms` measurement window overlaps the reference frame. Click **`Find & Apply Delay`** (`D`) (or switch **`FFT Size`** to `8192` / `16384` for `30 m+` arena throws).
2. **Silent or wrong Reference channel:** Check the **`Ref R`** bar under **`Preamp Headroom (dBFS)`**. If `Ref R` reads `— dB`, verify **`Ref`** in the topbar matches the physical input jack receiving your loopback cable (e.g., `In Ch 2`), and check **`Out`** on the generator (`Out Ch 1+2`).
3. **OS Voice Isolation enabled:** An orange mic icon in the macOS menu bar set to *Voice Isolation* strips pink noise as "background noise." Switch it to **`Standard`**.
4. **Severe clipping:** If **`Meas M`** or **`Ref R`** shows red **`CLIP`**, non-linear ADC distortion collapses `γ²`; turn down the interface preamp gain.

### "Why does my Phase trace drift slowly at `10–20 kHz`?"
You are measuring with **two separate hardware clocks** (for example, a USB microphone on **`Ref: Internal Gen`** while playing pink noise out of a laptop headphone jack). A `50 ppm` clock mismatch shifts arrival time by `50 µs` per second (`~360°` every `20 seconds` at `1 kHz`, and `10×` faster at `10 kHz`). Use a **2-channel audio interface with a physical TRS loopback cable** so ADC and DAC share a single crystal clock.

### "Why didn't loading my `.cal` file change the topbar `dBA` SPL number?"
By design: serial-numbered `.cal` files correct frequency-domain **Transfer Function** and **RTA** bins (where `1–2 dB` HF capsule resonances matter visually), while the `IEC 61672` broadband SPL meter runs directly on time-domain pressure calibrated at `1 kHz` via **`Input Gain (dB)`**.

### "Why did Show Mode's SPL history start empty when I opened my laptop the next day?"
`IndexedDB` show checkpoints intentionally expire after **`30 minutes`** of inactivity so yesterday's concert never contaminates today's `LAeq15m` / `LAeq60m` averages. During an active set, `10-second` checkpoints protect against accidental page reloads or brief browser restarts.

---

## 3. FOH Acoustics & Measurement Glossary

| Term | Meaning in `WebSoundTools` |
| :--- | :--- |
| **`dBFS`** | *Decibels relative to Full Scale* (`0 dBFS` = digital ADC/DAC clipping). Used on `Meas M` / `Ref R` preamp headroom meters and generator output level. |
| **`dB SPL` (`dBA` / `dBC` / `dBZ`)** | Sound Pressure Level relative to `20 µPa`. `A`-weighting rolls off low bass below `500 Hz` (human mid-level ear sensitivity); `C`-weighting stays flat down to `~31.5 Hz` (sub-bass energy); `Z`-weighting is flat unweighted (`20 Hz – 20 kHz`). |
| **`H1` Transfer Function** | Cross-spectral estimator $H_1(f) = \langle G_{RM}(f) \rangle / \langle G_{RR}(f) \rangle$. Rejects uncorrelated crowd/room noise arriving at the measurement mic `M`. |
| **Coherence (`γ²`)** | $\gamma^2(f) = \lvert G_{RM}(f) \rvert^2 / (G_{RR}(f) G_{MM}(f)) \in [0, 1]$. Measures causal linearity between reference `R` and mic `M` at frequency `f`. |
| **`Impulse (ETC dB)`** | *Energy-Time Curve* ($20\log_{10}\lvert h(t) \rvert$). Plots impulse response magnitude in dB so early wall/floor reflections (`-10` to `-35 dB`) stand out clearly by arrival time (`ms`). |
| **Group Delay (`ms`)** | $\tau_g(f) = -\frac{1}{2\pi}\frac{d\phi}{df}$. Frequency-dependent transit time through crossovers, bass-reflex ports, and propagation paths. |
| **`LR24` (`Linkwitz-Riley 24 dB/oct`)** | Two cascaded `12 dB/oct` Butterworth filters (`-6.02 dB` at cutoff). High-pass (`+180°`) and low-pass (`-180°`) outputs are `0°` in phase at crossover and sum flat (`0 dB`) when time-aligned. |
| **`CSA` (`Cardioid Subwoofer Array`)** | Directional sub stack where rear-facing (`180°` rotated) cabinets are polarity-inverted (`Ø`) and delayed by `τ = d / c` (`λ / 4` spacing gives maximum `+6 dB` forward sum and deep rear stage cancellation at `f_tune`). |
| **End-Fire Sub Array** | Forward-facing longitudinal sub line spaced by `d` with progressive frontward delay $\tau_k = k \cdot d / c$, summing coherently along `+X` while canceling off-axis and upstage. |
| **`LAeq,T` (`LAeq1m` / `LAeq15m` / `LAeq60m`)** | Energy-equivalent continuous `A`-weighted sound level integrated over a sliding `1`-, `15`-, or `60`-minute window—the standard metric in concert noise ordinances. |
| **`LC−LA`** | Difference between `1`-minute `LCeq` and `LAeq` in dB; quantifies low-frequency sub-bass weight relative to midrange vocal/instrument energy. |

---

*Return to the [FOH Tutorial Index](./README.md).*

