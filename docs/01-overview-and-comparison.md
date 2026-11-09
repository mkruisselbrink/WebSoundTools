# 01. Product Overview & Feature Comparison

## 1. What `WebSoundMeter` Is

`WebSoundMeter` is a browser-based, dual-channel electro-acoustic measurement, PA alignment, and live mixing RTA/SPL analysis application built with **TypeScript**, **Lit 3**, **Web Audio (`AudioWorklet`)**, **Web Workers**, and **WebGL2 / 2D Canvas**.

Inspired by **Open Sound Meter (`osm/`)** and **Rational Acoustics Smaart**, `WebSoundMeter` runs entirely in the browser with zero native dependencies and includes both **raw multi-channel hardware audio interface routing** and a **Built-in Simulated Acoustic Rig** for hardware-free demonstration, training, and automated testing.

---

## 2. Core Architectural Concepts

### 2.1 Unified `SourceData` & Interchangeable Sources
Following Open Sound Meter's `Abstract::Data` / `Abstract::Source` architecture, every data producer in `WebSoundMeter` outputs a uniform `SourceData` structure backed by contiguous `Float32Array` buffers (`src/sources/source-data.ts`):

```
SourceData
 ├── frequencyDomain: FrequencyDomainData
 │    ├── frequency   (Hz per bin)
 │    ├── module      (Linear amplitude |M(f)| → RTA / Spectrum)
 │    ├── magnitude   (Linear transfer function |H(f)| → Magnitude dB)
 │    ├── phaseReal   (cos(φ) unit phase component → Phase / Group Delay)
 │    ├── phaseImag   (sin(φ) unit phase component → Phase / Group Delay)
 │    ├── coherence   (γ²(f) in [0, 1] → Coherence plot & trace alpha weighting)
 │    ├── peakSquared (Per-bin peak hold |M(f)|² → RTA Peak & Crest Factor)
 │    └── meanSquared (Per-bin RMS |M(f)|² → Crest Factor)
 ├── timeDomain: TimeDomainData
 │    ├── timeMs      (ms, centered around 0 ms)
 │    ├── impulse     (Deconvolved impulse response h(t) %)
 │    └── step        (Cumulative step response %)
 └── levels: BroadbandLevels
      ├── levelsDb[Weighting: Z|A|C][Integration: Fast|Slow|Impulse|Leq]
      ├── peaksDb[Weighting: Z|A|C]
      ├── referenceRmsDb
      └── referencePeakDb
```

Because every chart reads `SourceData`, the sidebar (`src/sources/source-store.ts`) treats all of the following as interchangeable visual traces:
1. **Live Measurement**: Dual-channel ($M / R$) analyzer running in a dedicated DSP Web Worker (`src/dsp/dsp.worker.ts`).
2. **Stored Traces (`StoredSource`)**: Frozen snapshots of any source's `SourceData`, complete with user notes, gain offset ($\text{dB}$), delay offset ($\text{ms}$), JSON import/export, and IndexedDB persistence.
3. **Virtual Parametric EQ (`EqualizerSource`)**: Applies a cascade of up to 8 parametric biquad filters (`peaking`, `lowshelf`, `highshelf`, `lowpass`, `highpass`, `notch`, `allpass`) to any live or stored source's transfer function, predicting the resulting Magnitude and Phase response in real time.
4. **Math Union (`UnionSource`)**: Combines multiple sources in real time using Vector Average, Power Average, RMS Average, Subtract ($A - B$), Minimum, or Maximum.

---

## 3. Feature Matrix (`WebSoundMeter` vs. OSM & Smaart)

| Capability | Open Sound Meter (`osm/`) | Smaart Suite | `WebSoundMeter` (Current Implementation) |
| :--- | :---: | :---: | :--- |
| **Single-Channel RTA / Spectrum** | Line, Octave Bars, Peak, Crest | Line, Bars, Spectrograph | Line + Peak Hold + Crest Factor Plot |
| **Dual-Channel Transfer Function (Mag + Phase)** | $\|M\|/\|R\|$ + Complex Phase | $H_1 = \langle G_{rm}\rangle / \langle G_{rr}\rangle$ | Selectable **$H_1$ Cross-Spectral** or **OSM $\|M\|/\|R\|$** |
| **Coherence ($\gamma^2$) & Alpha Weighting** | Rolling window + Shader Alpha | Rolling window + Blanking/Alpha | Rolling window + WebGL2/Canvas Coherence Alpha |
| **Impulse Response / Deconvolution & Step** | IFFT of $M/R$ + Step | Live IR + Full IR Mode | Regularized IFFT Deconvolution + Step + Group Delay |
| **Auto Delay Finder** | $2^{16}$ Deconvolution peak | Cross-correlation + Tracker | Deconvolution peak + sub-sample parabolic interpolation |
| **Averaging Modes** | Off, FIFO, 4th-order Bessel LPF | FIFO, EMA, Infinite | Off, FIFO Ring Buffer, 4th-order Bessel LPF (`0.25`/`0.5`/`1`/`2 Hz`), Infinite |
| **Fractional-Octave Smoothing** | On RTA bars | 1/1 to 1/48 oct on all traces | $O(1)$ prefix-sum smoothing (`off`, `1/1`, `1/3`, `1/6`, `1/12`, `1/24`, `1/48` oct) |
| **Virtual Sources** | `Union`, `Equalizer`, `Filter`, `Windowing` | Trace Math & Offsets | **Virtual Parametric EQ** (draggable nodes + table) & **Math Union** |
| **Signal Generator** | Pink, White, Brown, Sweep, Burst | Pink, P-Noise, Sweep | Pink Noise (Voss-McCartney), White Noise, Sine, Log Sweep |
| **SPL / Leq Metering** | A/C/Z, Fast/Slow/Impulse/Leq | Full SPL Logger | IEC 61672 A/C/Z Weighting + Fast, Slow, Impulse, $L_{\text{eq}}$ & Peak |
| **Mic Calibration (`.cal` / `.txt` / `.frd`)** | Mag + Phase interpolation | Mag + Phase + SPL | Log-frequency Mag/Phase interpolation + Saved Calibration Library |
| **State & Session Persistence** | Local file / autosave | Session files | **3-Tier Persistence**: URL Query/History + `localStorage` + `IndexedDB` + JSON Export/Import |
| **Built-in Simulated Acoustic Rig** | No | No | **5 Interactive PA/Room Presets** (Hardware-free Demo & Test Rig) |

---

## 4. Licensing

`WebSoundMeter` is licensed under the **GNU General Public License v3.0 (GPLv3)** (matching Open Sound Meter's license). All DSP modules in `src/dsp/` are implemented in clean, self-contained TypeScript over `Float32Array` buffers from standard acoustic and signal-processing equations (Cooley–Tukey Radix-2 FFT/IFFT, RBJ Audio EQ Cookbook biquads, IEC 61672 weighting filters, and Bendat & Piersol cross-spectral transfer function estimators).
