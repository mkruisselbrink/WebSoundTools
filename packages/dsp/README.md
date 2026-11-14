# `@foh/dsp`

Pure TypeScript signal-processing primitives for real-time acoustic analyzers and 3D loudspeaker prediction engines (zero DOM/UI dependencies; safe for Web Workers and AudioWorklets).

## Modules

- **`biquad.ts`** — RBJ Audio EQ Cookbook 2nd-order digital biquads (`lowpass`, `highpass`, `bandpass`, `notch`, `peaking`, `lowshelf`, `highshelf`, `allpass`), 1st-order bilinear sections (`designFirstOrderSection`), analytical complex transfer function evaluation at `DSP_REFERENCE_SAMPLE_RATE_HZ = 192000` (eliminating Nyquist cramping near 20 kHz), and stateful TDF-II `BiquadFilter` / `BiquadCascade` processors.
- **`crossovers.ts`** — Butterworth (12, 18, 24, 48 dB/oct) and Linkwitz-Riley (12, 24, 48 dB/oct) crossover section synthesis (`designCrossoverSections`).
- **`dsp-chain.ts`** — Complete `SourceDspConfig` & `ParametricEqBand` model (`compileDspChain`, `evaluateCompiledDspAtFrequency`) combining gain, polarity inversion, electronic delay $e^{-j\omega\tau}$, HPF/LPF crossovers, and parametric EQ bands.
- **`window-functions.ts`** — Rectangular, Hann, Hamming, Blackman, Blackman-Harris, and Flat Top spectral windows with coherent & energy gain normalization.
- **`fft.ts`** — In-place Cooley-Tukey `Radix2FFT` (`transformComplex` + packed dual-real-channel `transformDualReal`).
- **`octave-smoothing.ts`** — $O(N)$ prefix-sum fractional-octave magnitude & complex unit-phasor smoothing (`smoothMagnitudeOctave`, `smoothPhaseOctave`).
- **`group-delay.ts`** — Unwrap-free conjugate-phasor group delay computation (`computeBinGroupDelayMs`, `computeGroupDelayFromPhasorsMs`).
