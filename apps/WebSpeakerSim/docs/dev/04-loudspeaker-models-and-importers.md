# 04. Loudspeaker Models, Spec Builder & File Importers

## 1. Unified `SpeakerDefinition` Data Model (`src/library/speaker-schema.ts`)

Regardless of whether a loudspeaker comes from the built-in library, the interactive **Datasheet Spec Builder**, or an imported `.gll`, `.clf`, or `.frd` file, the physics engine consumes a uniform `SpeakerDefinition` representation:

```text
SpeakerDefinition
 ├── id, name, manufacturer, category ('point-source' | 'subwoofer')
 ├── dimensionsMeters: { width, height, depth } & acousticCenterOffset: { x, y, z }
 ├── nominalDispersionDeg: { horizontal, vertical }
 ├── passbandHz: { low3dB, high3dB }
 ├── sensitivity1W1mDbSpl: number
 ├── maxContinuousSpl1mDb: number      # Broadband continuous thermal/excursion limit @ 1 m
 ├── defaultDspPreset?: SourceDspConfig
 └── balloon: DirectivityBalloon
      ├── frequenciesHz: Float32Array  # [F] nominal 1/3-oct or 1/12-oct centers (e.g. 20 Hz .. 20 kHz)
      ├── symmetry: 'axial' | 'quadrant' | 'mirror-horizontal' | 'none'
      ├── polarAnglesDeg: Float32Array     # [P] off-axis angles β ∈ [0°, 180°] (e.g. 5° step → 37 points)
      ├── meridianAnglesDeg: Float32Array  # [M] roll angles γ ∈ [0°, 360°) (e.g. 10° step → 36 planes)
      ├── onAxisMagDb: Float32Array        # [F] relative on-axis frequency response (dB)
      ├── onAxisPhaseRad: Float32Array     # [F] on-axis phase response (radians)
      ├── attenuationDb: Float32Array      # [F * M * P] off-axis directional attenuation ≤ 0 dB (or ±dB)
      └── offAxisPhaseRad?: Float32Array   # Optional [F * M * P] off-axis excess phase
```

### 1.1 Memory Footprint & Fast Spherical Interpolation
For a standard 24-band (`1/3`-octave `25 Hz – 20 kHz`), `10°` meridian $\times$ `5°` polar full-sphere grid (`24 × 36 × 37 = 31,968` floats), `attenuationDb` occupies just **125 KB** per speaker model (`~34 KB` with quadrant symmetry), fitting comfortably in CPU L2 cache during worker grid evaluation!

At any query direction $(\beta, \gamma)$ and frequency $f$:
1. Symmetrize $(\beta, \gamma)$ according to `balloon.symmetry`.
2. Bilinearly interpolate `attenuationDb` across the bounding $(\gamma_0, \gamma_1) \times (\beta_0, \beta_1)$ cell (and log-linearly across frequency bins when evaluating arbitrary virtual-mic frequencies).
3. Combine with `onAxisMagDb` and `onAxisPhaseRad` to return complex directional factor $D(\beta, \gamma, f) = 10^{(L_{\text{on}}(f) + \Delta L(\beta,\gamma,f))/20} \, e^{j \phi(\beta,\gamma,f)}$.

---

## 2. Analytical Parametric Models & Datasheet Spec Builder (`spec-builder.ts`)

To make the application immediately productive out of the box—and allow modeling any enclosure from its published spec sheet—`spec-builder.ts` synthesizes physically grounded 3D balloons from cabinet parameters:

1. **Low-Frequency Baffle / Piston Transition:**
   - Below cabinet baffle diffraction frequency $f_{\text{baffle}} = c / (\pi W_{\text{eff}})$, radiation transitions smoothly toward omnidirectional ($0\text{ dB}$ rear loss for sealed/reflex boxes, or intrinsic cardioid dipole/gradient pattern if specified).
   - Above $f_{\text{baffle}}$, circular/elliptical piston directivity $2 J_1(k a \sin\beta) / (k a \sin\beta)$ governs mid-bass narrowing.
2. **High-Frequency Constant-Directivity Horn Ellipsoid:**
   - Above horn control frequency $f_{\text{horn}}$, off-axis attenuation follows a smooth super-elliptical Gaussian horn law calibrated so the **exact $-6\text{ dB}$ beamwidth** equals `nominalDispersionDeg.horizontal` in the $\gamma = 0^\circ / 180^\circ$ plane and `nominalDispersionDeg.vertical` in the $\gamma = \pm 90^\circ$ plane:
     $$\Delta L_{\text{horn}}(\alpha_H, \alpha_V) = -6.0 \left[ \left(\frac{\alpha_H}{\Theta_H / 2}\right)^2 + \left(\frac{\alpha_V}{\Theta_V / 2}\right)^2 \right]^p$$
   - Supports asymmetric vertical horns (e.g., $+20^\circ$ up / $-40^\circ$ down) as well as symmetric horns (e.g., $90^\circ \times 60^\circ$, $90^\circ \times 40^\circ$, $60^\circ \times 40^\circ$).
3. **Passband Minimum-Phase Response:**
   - Synthesizes realistic high-pass (e.g., 4th-order reflex roll-off at `low3dB`) and high-frequency roll-off (`high3dB`) magnitude **and phase** so subwoofer-to-top crossover summation reflects real acoustic phase rotation!

---

## 3. Built-in Loudspeaker Library (`builtin-speakers.ts`)

Ships with calibrated generic active PA enclosures ready for simulation:
- **Point-Source Tops:**
  - `Compact 8" 2-Way Active Top` (`90° × 70°`, `65 Hz – 20 kHz`, `125 dB Max SPL`)
  - `Standard 10" 2-Way Active Top` (`90° × 60°`, `58 Hz – 20 kHz`, `128 dB Max SPL`)
  - `High-Output 12" 2-Way Active Top` (`90° × 45°`, `50 Hz – 20 kHz`, `132 dB Max SPL`)
  - `Long-Throw 15" 2-Way Active Top` (`60° × 40°`, `45 Hz – 20 kHz`, `135 dB Max SPL`)
- **Subwoofers:**
  - `Compact 15" Bass-Reflex Sub` (`40 Hz – 120 Hz`, `131 dB Max SPL`)
  - `Touring 18" Bass-Reflex Sub` (`35 Hz – 120 Hz`, `135 dB Max SPL`)
  - `High-SPL Dual-18" Bass-Reflex Sub` (`30 Hz – 110 Hz`, `140 dB Max SPL`)

---

## 4. Client-Side File Importers (`src/library/importers/`)

All file imports run 100% locally in the browser and persist imported `SpeakerDefinition` entries into `IndexedDB`—noproprietary manufacturer files are bundled in the repository.

### 4.1 Binary `.gll` Importer (`gll-importer.ts` & `gll/*`)
- Ported from the clean-room `EASE_GLL` parser in [`cwBudde/gll-tools`](https://github.com/cwBudde/gll-tools) (Copyright (c) Christian-W. Budde, MIT License — see [`src/library/importers/gll/LICENSE.gll-tools.md`](../../src/library/importers/gll/LICENSE.gll-tools.md)).
- **`gll-binary-reader.ts`:** Little-endian `GllByteReader`, block-bounded `ObjectLSCBuffer` iterator, AFMG 8-sample group `BitCompression` delta decompressor (`decompressBitArray`), and Web Streams `DecompressionStream('deflate')` zlib inflator.
- **`gll-spectrum-parser.ts`:** Decodes both `CLogSpectrumLP` (`v0`) and `TransferFunctionLsPs` (`v1`) `ComplexSequence` records, maps GLL balloon symmetry codes (`Axial`, `Quarter`, `Vertical`, `Horizontal`, `None`) and North/South pole-deduplicated meridian indices, and performs complex-pressure bilinear interpolation mapped from GLL's meridian frame (`0° = +Z` top, `90° = +Y` right) into `WebSpeakerSim`'s local cabinet frame (`0° = +y_L` left, `90° = +z_L` top).
- **`gll-container-parser.ts` & `gll-speaker-builder.ts`:** Parses `EASE_GLL` v3–v6 `Header` $\rightarrow$ `GenSystem` $\rightarrow$ `Database` (`BoxTypes`, `CaseGeometry` bounding-box dimensions, `BoxInputConfig` source-to-filter links, `SourceDefinitions` with `BalloonData` + `OnAxisSpectrum`, and `FilterGroups` with `LogSpectrum` & `IIR` crossovers evaluated via `@foh/dsp`), coherently summing multi-way driver placements (`LF` + `HF` with geometric offset phase) into ready-to-simulate `SpeakerDefinition` models.

### 4.2 Polar Text `.clf` & `.frd` / CSV Importers (`clf-importer.ts`, `frd-importer.ts`)
- **`.clf` Tab-Delimited Text:** Parses metadata headers (`<CABINET>`, `<SENSITIVITY>`, `<MAXSPL>`, `<SYMMETRY>`) and horizontal/vertical/spherical band attenuation tables.
- **`.frd` / CSV:** Imports single on-axis magnitude/phase `.frd` files (paired with parametric dispersion) or multi-angle polar `.frd` sets (`0 deg` .. `180 deg`) interpolated onto the 3D `DirectivityBalloon` grid.

