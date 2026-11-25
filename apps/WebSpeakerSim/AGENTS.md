# AGENTS.md — `WebSpeakerSim` (`apps/WebSpeakerSim`)

Operational rules and architectural invariants for coding agents modifying `WebSpeakerSim`. Also read the root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide rules.

## Commands

- **Dev server (with `COOP`/`COEP` headers on port `5174`):** `npm run dev:wss` (from root) or `npm run dev` (in `apps/WebSpeakerSim`)
- **Typecheck:** `npm --workspace web-speaker-sim run typecheck`
- **Unit & integration tests:** `npx vitest run --project web-speaker-sim`
- **Playwright E2E tests (port `5174`):** `npm --workspace web-speaker-sim run test:e2e`

## Coordinate System & Acoustic Physics Invariants

- **Right-Handed Metric Venue Coordinates (`meters`):**
  - **`+X` (Throw):** Stage (`X = 0 m`) toward audience / FOH (`-X` is upstage).
  - **`+Y` (Lateral):** Stage Left (`+Y`, top of Plan View); Stage Right is `-Y` (bottom of Plan View); centerline is `Y = 0 m`.
  - **`+Z` (Elevation):** Floor (`Z = 0 m`) upward toward ceiling.
  - **Euler Aiming Sign Conventions:** Negative `tiltDeg` (`-10°`) tilts a flown enclosure downward toward the floor. On a Stage-Left (`+Y`) cabinet, negative `azimuthDeg` (`-12°`) toes inward toward centerline (`Y = 0 m`). Mirror L/R pairs invert `y` and `azimuthDeg`.
- **Dedicated Simulation Worker (`src/physics/sim.worker.ts`):**
  - Pure TypeScript + `@foh/dsp` + `@foh/acoustics` over contiguous `Float32Array` buffers (zero DOM / Lit imports).
  - Analytical DSP frequency-response evaluation defaults to `DSP_REFERENCE_SAMPLE_RATE_HZ = 192000` so high-frequency EQ and crossovers suffer zero bilinear Nyquist cramping near `16–20 kHz`.

## Browser Persistence Invariants (Do Not Rename)

Renaming any of these constants will break saved venue projects, imported `.gll`/`.clf`/`.frd` speaker libraries, or crash recovery:

- **`localStorage` Workspace Key:** `'wss.workspace.v1'` (`src/model/workspace-session.ts`)
- **`IndexedDB` Database:** `IDB_DATABASE_NAME = 'web-speaker-sim-db'`, `IDB_DATABASE_VERSION = 1` (`src/model/session-storage.ts`, `fallbackMode: 'memory'`)
  - `'projects'` — Named saved venue scenes & colormap configs (`SavedProjectRecord`)
  - `'speakers'` — Custom spec-built & imported `.gll` / `.clf` / `.frd` loudspeaker definitions (`SpeakerDefinition`)
- **Portable Project Bundle Format:** `format: 'wss-project-v1'` (`.wss-project.json`, bundling scene + colormap + custom speakers via `src/model/session-storage.ts` and `src/model/project-io.ts`)
- **Service Worker Cache Prefix:** `'wss-precache-'`, version `'v1'` (`vite.config.ts`)

## Viewport, Chart & UI Guardrails

- **Dual-Canvas Viewports (`src/viewport/`):** `<wss-viewport-panel>` uses `@foh/canvas`'s `DualCanvasController` (`gl-heatmap-renderer.ts` for WebGL2 SPL LUTs & isoline contours + `canvas-cad-painter.ts` coordinating `cad-grid-ruler.ts`, `cad-zone-painter.ts`, and `cad-entity-painter.ts` with shared `occupiedPills` label collision avoidance and `drawColormapLegendBar`).
- **Virtual Mic Charts & On-Chart EQ (`src/charts/wss-chart-adapter.ts`):** Maps `VirtualMicResponse[]`, `PlanGridResult` audience histograms, and selected `DspGroup` EQ bands into `<foh-chart-panel>`. When a `DspGroup` is selected on the `Magnitude` tab, `InteractiveEqOverlay` anchors `referenceZeroDbY` to the passband mean SPL so 0 dB filter handles sit directly over the acoustic SPL traces (`txKey` coalesces pointer drags into a single Undo step).
- **Predict-to-Measure `.FRD` Export:** `virtual-mic-inspector.ts` exports predicted complex transfer functions (`FreqHz\tMagDb\tPhaseDeg`) via `@foh/acoustics`'s `serializeFrdCurve`, directly importable into `WebSoundMeter`.
- **Test Layout & Selectors:** Co-locate unit tests alongside source files (`src/**/*.test.ts`). Keep `tests/integration/` and `tests/e2e/speaker-sim.spec.ts` intact, and preserve all `data-testid` attributes.
- **SPDX Header:** Start every `.ts` file in `apps/WebSpeakerSim/` with:
  ```ts
  // Copyright (C) 2026 WebSpeakerSim Contributors
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```
  *(Files in `src/library/importers/gll/` also carry `// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)` and `LICENSE.gll-tools.md`.)*

## Acoustic Solver, Subwoofer Array & Alignment Invariants

- **3D Orientation, L/R Mirroring & Householder Image-Source Reflection (`src/physics/`):**
  - `buildOrientationMatrix()` computes $R = R_z(\text{azimuth}) \cdot R_y(-\text{tilt}) \cdot R_x(\text{roll})$ where negative `tiltDeg` aims downward (`-Z`) and spherical balloon lookup angles (`polarDeg` $\in [0^\circ, 180^\circ]$, `meridianDeg` $\in [0^\circ, 360^\circ)$: `0° = +y_L` left, `90° = +z_L` top, `180° = -y_L` right, `270° = -z_L` bottom) are projected via $R^T(\mathbf{r} - \mathbf{s})$ with `MIN_PROPAGATION_DISTANCE_M = 0.25 m`.
  - When `ps.mirrorLeftRight === true` and `|ps.position.y| > 1e-3`, `expandSceneRadiators()` mirrors the twin (`${ps.id}:mirror`) across `Y = 0` by negating **`y`**, **`azimuthDeg`**, and **`rollDeg`** while keeping **`x`**, **`z`**, and **`tiltDeg`** unchanged (suppressing the twin when `|y| <= 1e-3` to prevent `+6 dB` self-stacking; only the primary cabinet draws a draggable CAD aim handle).
  - `reflectPoseAcrossPlane()` must apply the Householder reflection $M = I - 2\mathbf{n}\mathbf{n}^T$ to **both** the source position $\mathbf{s}'$ and every column of the basis matrix $R' = M R$ so floor reflections sample the cabinet's bottom lobe rather than its top lobe.
- **Precomputed Radiator Tables & Zero-Backlog Progressive Worker Coalescing (`src/physics/summation-solver.ts`, `src/physics/sim-controller.ts`):**
  - `precomputeRadiatorTables()` pre-evaluates complex on-axis drive and linear off-axis directivity gain once per radiator per band outside the `(row, col)` receptor loop (`Float64Array` complex accumulators prevent precision loss across multi-band sums).
  - `SimulationController` allows at most one `EVALUATE_SCENE` request in flight (`inFlight`), coalescing intermediate edits into `pendingQuality`. Interactive drags evaluate a `'coarse'` grid (`~46 × 46`) immediately and schedule a `95 ms` trailing `'fine'` grid (`~96 × 96`).
  - Send custom/imported speaker 3D balloons to `sim.worker.ts` only via `UPSERT_SPEAKERS` when `changeKind === 'speakers'`—never embed `SpeakerDefinition` balloon arrays inside `EVALUATE_SCENE`.
- **Audience Surface Mask (`CELL_MASK_AUDIENCE`) & `-120 dB` Sentinel (`src/physics/coverage-stats.ts`):**
  - When multiple enabled audience zones overlap at `(x, y)` (e.g. balcony overhanging orchestra), `resolvePlanPointSurface()` picks the highest-elevation (`z >= highestAudienceZ`) audience surface and prioritizes `'audience'` (`CELL_MASK_AUDIENCE = 1`) over `'stage'` (`CELL_MASK_STAGE = 2`) over background (`0`).
  - Any coverage statistic, SPL histogram (`computeAudienceSplHistogram`), or auto-scale range resolver (`resolveEffectiveSplRange`) must filter strictly by `surfaceMask[i] === CELL_MASK_AUDIENCE && splDb[i] > -110` (ignoring background cells and the `-120 dB` silence sentinel).
- **Virtual Mic Earliest-Arrival Phase Sync & Conjugate-Phasor Group Delay (`src/physics/virtual-mic-solver.ts`):**
  - `evaluateCompiledDspAtFrequency()` already includes electronic delay phase $e^{-j 2\pi f \cdot \text{delaySeconds}}$. When phase-syncing Virtual Mic responses to earliest arrival `refSec`, apply `relFlightPhase = -2 * Math.PI * freq * (path.flightSec - refSec)`—never subtract `refSec` from `totalArrivalSec`, which double-counts electronic delay phase! Compute group delay via unit-phasor conjugate product $\operatorname{atan2}(\operatorname{Im}(H_k H_{k-1}^*), \operatorname{Re}(H_k H_{k-1}^*))$ to avoid $\pm 180^\circ$ branch-cut spikes.
- **Subwoofer Array Synthesis & Inter-Group Alignment (`src/physics/sub-array-designer.ts`, `src/physics/group-alignment.ts`):**
  - In `'cardioid-csa'` mode, rear cabinets at $-d/2$ are physically rotated $180^\circ$ (`azimuthDeg + 180`), polarity-inverted, and delayed by $d / c$ (`Set λ/4` updates both `spacingM` and `cardioidDepthOffsetM`). When `boxCount % 3 === 0`, synthesize 3-box CSA triplets (1 rear inverted box at `0 dB` + 2 front boxes at `-4.5 dB` trim each); otherwise synthesize 2-box front/rear pairs (`-1.0 dB` rear trim).
  - In `computeGroupAlignmentPreview()`, always subtract `targetGroup.dsp.delayMs` from each target radiator's total electronic delay (`Math.max(0, r.dspChain.delaySeconds * 1000 - tgtBaseDelayMs)`) so re-running **Apply Delay & Polarity** computes an idempotent absolute group delay rather than accumulating delays.

## Importer, Viewport & URL State Guardrails

- **Loudspeaker Importers, GLL Meridian Mapping & `Float32Array` Serialization (`src/library/importers/`):**
  - `gll/` (`gll-binary-reader.ts`, `gll-spectrum-parser.ts`, `gll-container-parser.ts`, `gll-speaker-builder.ts`) decodes structured `EASE_GLL` v3–v6 containers (`BoxTypes`, `CaseGeometry`, `BoxInputConfig`, `SourceDefinitions`, 8-sample `BitCompression` delta spectra, `FilterGroups`) with a `32 MB` `DecompressionStream('deflate')` cap and metadata-based parametric fallback. Preserve the GLL-to-WSS meridian mapping `gllMer = (wssMer + 270) % 360` and North/South pole-deduplicated `gllResponseIndex()` so horizontal and vertical horn planes never swap.
  - `parseClfText()` reconstructs quadrant-symmetric 3D balloons from 2D H/V tables, `buildSpeakerFromFrdText()` normalizes on-axis passband peaks to `0 dB`, and `DatasheetSpecInput` uses `low3dBHz` / `high3dBHz` mapped to `lowCutHz` / `highCutHz`.
  - `serializeSpeakerToJson()` / `deserializeSpeakerFromJson()` (`format: 'wss-speaker-v1'`) must explicitly convert all `DirectivityBalloon` `Float32Array` fields to/from plain JS `number[]` arrays (`JSON.stringify` on raw `Float32Array` produces `{ "0": ... }` objects and breaks IndexedDB hydration).
- **Viewport Direct Store Subscription, Plan-Anchored Colormap & `occupiedPills` (`src/viewport/`):**
  - `<wss-viewport-panel>` and `<wss-chart-panel>` must maintain a direct `this.store.subscribe(...)` listener (in addition to `.revision`) so colormap, contour, and selection mutations trigger `requestRepaint()` immediately even when `.store` and `.snapshot` object references do not change.
  - Both Plan and Section viewports resolve `effectiveRange = resolveEffectiveSplRange(store.colormap, snapshot?.planGrid?.stats)` against **`planGrid.stats`** (rounded to `0.5 dB` anchors to prevent coarse-to-fine color flicker) so colors match across views. Direct edits to `minSplDb`/`maxSplDb` without an explicit `rangeMode` automatically switch `rangeMode` to `'manual'`.
  - In `gl-heatmap-renderer.ts`, keep `gl.NEAREST` (`UNPACK_ALIGNMENT = 1`) + manual 4-texel `sampleSplBilinear()` in GLSL for `R32F` textures (`OES_texture_float_linear` is optional), `u_stepped` quantization, and luminance-adaptive `fwidth` contour ink.
  - In `canvas-cad-painter.ts`, pass the shared `occupiedPills` array through `drawSlicePlaneOrGroundLine()` and `drawVirtualMics()` so Virtual Mic badges and the `Section Y = ...` pill never overlap or clip off viewport borders.
- **URL `?preset=` vs. `localStorage` Reload Precedence (`src/ui/app-shell.ts`):**
  - Track `isSceneModified = true` whenever the user mutates the scene (or when hydrating from `localStorage`), and omit `presetId` in `syncUrlBar()` (`presetId: this.isSceneModified ? undefined : this.activePresetId`). Keeping `?preset=` in the URL after scene edits causes browser reloads to re-initialize a fresh preset and overwrite the user's `localStorage` autosave.

