# `@foh/acoustics`

Physical acoustics, ISO/IEC standards, musical pitch mapping, and `.FRD` / `.CAL` frequency response interchange for WebSoundTools.

## Modules

- **`atmosphere.ts`** — ISO 9613-1:1993 atmospheric absorption (`computeAirAbsorptionDbPerMeter`, `computeAirAbsorptionTable`), speed of sound (`computeSpeedOfSoundMpS`), and wavelength / period / flight-delay conversions.
- **`weighting.ts`** — IEC 61672-1 `A`, `C`, and `Z` weighting curves in both analytical relative dB form (`computeFrequencyWeightingDb`) and bilinear-prewarped digital IIR biquad cascades (`createWeightingBiquadCoeffs`).
- **`iso-bands.ts`** — ISO 266 nominal 1/1-octave (`ISO_OCTAVE_BANDS_HZ`), 1/3-octave (`ISO_THIRD_OCTAVE_BANDS_HZ`), and 31-band graphic EQ (`ISO_31_BAND_FREQUENCIES_HZ`) grids, `createLogFrequencyGrid`, and `aggregateFractionalOctaveBands`.
- **`pitch-notes.ts`** — `formatIsoBandLabel`, `findNearestIso31Band`, and `frequencyToMusicalNote`.
- **`frd-curve.ts`** — Unified `.FRD` / `.CAL` / `.CSV` parser (`parseCalibrationFile`, `parseFrdCurveText`), serializer (`serializeFrdText`), and phase-unwrap-aware log-frequency interpolators (`interpolateCalibrationCurve`, `interpolateFrdCurveLogFreq`) powering direct Predict-to-Measure trace exchange between WebSpeakerSim and WebSoundMeter.
