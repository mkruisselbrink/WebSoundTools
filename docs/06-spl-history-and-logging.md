# 06. Live Show Mode & SPL / Rolling Leq History Design

> **Status**: Proposed Design Specification  
> **Related Modules**: `src/dsp/weighting-meters.ts`, `src/dsp/spl-history.ts` (new), `src/sources/source-data.ts`, `src/charts/plot-types.ts`, `src/charts/canvas-chart-painter.ts`, `src/ui/topbar/`

---

## 1. Overview: Tuning Mode vs. Live Show Mode

Acoustic analyzers are used in two distinct phases of a live production:
1. **System Tuning (Setup)**: Before doors open, the engineer uses pink noise/sweeps, aligns subwoofers and delay fills (`Find & Apply Delay`), captures reference traces (`StoredSource`), averages spatial microphone positions (`Math Union`), and shapes corrective filters (`Virtual Parametric EQ`).
2. **Live Show Monitoring**: Once the audience is in the venue and the performance begins, priorities shift to:
   - **Preventing accidental Signal Generator activation** over the live PA.
   - **Monitoring broadband SPL exposure and low-end balance over time** ($L_{\text{AF}}$, $L_{\text{AS}}$, $L_{\text{Aeq,1m}}$, $L_{\text{Aeq,15m}}$, $L_{\text{Ceq,1m}} - L_{\text{Aeq,1m}}$, and True Peak) against venue or municipal limits.
   - **Catching acoustic feedback and narrowband ringing** across FOH and stage monitor microphones (detailed in [`docs/07-feedback-detection-design.md`](./07-feedback-detection-design.md)).

### 1.1 Top-Level `[ 🛠 Tuning | 🎚 Show ]` Workspace Mode Toggle

`WebSoundMeter` introduces a top-level workspace mode (`WorkspaceMode = 'tuning' | 'show'`), accessible via a segmented toggle in the Topbar and encoded in the URL query state (`?mode=show`).

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║ LIVE SHOW MODE                                                               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ WebSoundMeter [ 🛠 Tuning | 🎚 Show ] │ [In: Dante ▾][Pause] │               ║
║   [SPL: 96.4 dBA Fast │ LAeq15m: 94.8 / 98.0 dB │ LC-LA: +14.2 dB │ Pk: 109] ║
╠══════════════════════════════════════════════════╦═══════════════════════════╣
║ [Plot: Spectrum (RTA) ▾] [1/3 Oct ▾] [✓ FB Watch]║ LIVE MICS & SPL WATCH     ║
║               🔴 2.48 kHz (ISO 2.5k)             ║  ● FOH Mic      94.8 Aeq15║
║                  +15.8 dB | Wedge L              ║    FB Watch: [FOH Norm ▾] ║
║                       │                          ║  ● Stage Wedge  99.2 Aeq15║
║            ▄  █  ▆  ▄ █  ▃  ▂     ▂  ▄  ▆        ║    FB Watch: [Monitor ▾]  ║
╠══════════════════════════════════════════════════╬═══════════════════════════╣
║ [Plot: SPL History ▾] [Window: 60m ▾] [LAeq15+A] ║ FEEDBACK RING LOG [Clear] ║
║ 102 dB  - - - - - - - - - - - - - - - (Limit)    ║  🔴 2.48 kHz (ISO 2.5k)   ║
║  98 dB - - - - - - - - - - - - - - - -(Warn)     ║     D#7 • +15.8dB • Wedge ║
║        _.-~-._          _.-~-._                  ║     21:14:08  [Notch EQ]  ║
║  85 dB        ~-._.._.-~       ~-._              ║  🟡 632 Hz (ISO 630 Hz)   ║
║       -60m        -40m        -20m         0m    ║     D#5 • +10.2dB • FOH   ║
║                                                  ╠═══════════════════════════╣
║                                                  ║ SHOW LIMITS & LOG [CSV ⬇] ║
║                                                  ║  Warn: [98 dB] Lim: [102] ║
╚══════════════════════════════════════════════════╩═══════════════════════════╝
```

Switching to **`Show` mode** applies four coordinated UI changes while keeping the same underlying `SourceStore` and multi-slot DSP pipelines running continuously:
1. **Signal Generator Safety Interlock**: Hides the Signal Generator toolbar group from the Topbar and immediately forces `generatorConfig.enabled = false` if it was active, eliminating any risk of accidental noise injection during a performance.
2. **Expanded Topbar SPL Compliance Bar**: Uses the reclaimed Topbar width to display simultaneous **`Fast/Slow`**, **`LAeq,1m`**, **`LAeq,15m` (with limit headroom)**, **`LCeq,1m − LAeq,1m` (sub-to-mid balance)**, and **`Peak`** readouts with green/amber/red threshold styling.
3. **Show-Oriented Default Chart Stack**: Defaults the chart stack to **Spectrum (RTA) with Feedback Watch** on top and **SPL / $L_{\text{eq}}$ History** on the bottom (while preserving each chart's separate `Tuning` vs. `Show` plot-type memory in `WorkspaceSessionSnapshot`).
4. **Zero-Scroll Show Monitor Sidebar**: Replaces the setup-focused source list and alignment controls (`Ref Delay`, `Virtual EQ` bands, `Math Union`) with three live-show cards:
   - **Live Mics & SPL Watch**: Per-slot live SPL / $L_{\text{Aeq,15m}}$ badge and Feedback Watch mode selector (`Off`, `FOH Normal`, `Monitor Sensitive`, `Custom`).
   - **Feedback Ring Log**: Chronological feed of active and latched rings across all live slots with one-click `[Notch EQ]` and `[Clear]` actions.
   - **Show Limits & Log Export**: Configurable Warning/Limit dB thresholds, elapsed show timer, `[Reset Show Log]`, and `[Export CSV]`.

> **Non-Exclusive Access**: Even when in `Tuning` mode, `'spl-history'` remains selectable in any `<chart-panel>` Plot Type dropdown and `Feedback Watch` can be toggled on any `rta` or `magnitude` chart.

---

## 2. DSP & Mathematical Specification (`src/dsp/spl-history.ts`)

### 2.1 Sliding-Window Equivalent Continuous Sound Level ($L_{\text{eq},T}$)

In `src/dsp/weighting-meters.ts`, `SingleCurveMeter` filters incoming gain-calibrated measurement samples through IEC 61672-1 `A`, `C`, and `Z` biquad cascades and computes instantaneous squared pressure $y_w^2[n]$ for each weighting $w \in \{\text{A}, \text{C}, \text{Z}\}$.

While cumulative $L_{\text{eq}}$ averages $y_w^2[n]$ from $n = 0$ to $\infty$, live show compliance (e.g., 98 dBA $L_{\text{eq},15\text{m}}$ or 102 dBA $L_{\text{eq},60\text{m}}$) requires a **sliding time window** of duration $T$:

$$L_{\text{eq},T}^{(w)}(t) = 10 \log_{10}\!\left(\frac{1}{K_T} \sum_{i=0}^{K_T - 1} E_w[t - i]\right) + \text{SPL}_{\text{offset}}$$

where $E_w[k] = \frac{1}{F_s} \sum_{n \in \text{sec } k} y_w^2[n]$ is the mean-square linear energy integrated over 1-second epoch $k$, and $K_T \in \{60, 300, 900, 3600\}$ is the window length in seconds (`1m`, `5m`, `15m`, `60m`).

### 2.2 Dual-Resolution 4-Hour Ring Buffer Architecture

To provide both **high-resolution short-term strip charts** (`1 min` / `5 min` views) and **4-hour full-show logging** (`15 min` / `60 min` / `240 min` views) with minimal memory overhead, `SplHistoryTracker` maintains two fixed-size ring buffers per Live Measurement slot:

| Tier | Sample Rate | Capacity | Horizon | Stored Channels | Memory per Slot |
| :--- | :---: | :---: | :---: | :--- | :---: |
| **Tier A (Short-Term High-Res)** | **4 Hz** (`250 ms` epochs) | `1,200` samples | **5 minutes** | `fastDbA`, `fastDbC`, `slowDbA`, `leq1mDbA`, `peakDbZ` (`5 × Float32Array(1200)`) | `24.0 KB` |
| **Tier B (Long-Horizon Show Log)** | **1 Hz** (`1,000 ms` epochs) | `14,400` samples | **4 hours** (`240 min`) |Linear energy `energyA`, `energyC`, `energyZ` (`3 × Float64Array(14400)`) + dB traces `shortTermDbA`, `shortTermDbC`, `leq1mDbA`, `leq15mDbA`, `peakDb` (`5 × Float32Array(14400)`) | `633.6 KB` |

- **$O(1)$ Sliding-Window Energy Sums**:
  - For each weighting $w \in \{\text{A}, \text{C}, \text{Z}\}$, `SplHistoryTracker` maintains running `Float64` sums `sum60s`, `sum300s`, `sum900s`, and `sum3600s`.
  - When a new 1-second epoch $E_w[\text{head}]$ is committed:
    $$\text{sum}_{K} \leftarrow \text{sum}_{K} + E_w[\text{head}] - E_w[(\text{head} - K) \bmod 14400]$$
  - Every `1,024` seconds, the running sums are recomputed from the `Float64Array` ring buffer to eliminate floating-point accumulation drift.
- **Low-Frequency Spectral Balance ($L_{\text{Ceq}} - L_{\text{Aeq}}$)**:
  - Computed directly from the 1-minute sliding windows:
    $$\Delta_{C-A} = L_{\text{Ceq,1m}} - L_{\text{Aeq,1m}}$$
  - Gives the FOH engineer an immediate numerical indicator of subwoofer/low-end energy relative to midrange vocal energy.

---

## 3. Data Structures (`src/dsp/spl-history.ts` & `src/sources/source-data.ts`)

```ts
export type SplHistoryWindowSec = 60 | 300 | 900 | 3600 | 14400;

export type SplHistoryTraceMode =
  | 'dba-fast-leq1m'    // LAF (translucent) + LAeq,1m (solid)
  | 'dba-dbc-leq1m'     // LAeq,1m (cyan) + LCeq,1m (amber)
  | 'compliance-15m'    // LAeq,15m (solid) + LAeq,1m (dashed) + Peak (dots)
  | 'multi-slot';       // Compares the selected metric across all visible Live Measurement slots

export interface RollingLeqSnapshot {
  readonly leq1m: Record<WeightingCurve, number>;
  readonly leq5m: Record<WeightingCurve, number>;
  readonly leq15m: Record<WeightingCurve, number>;
  readonly leq60m: Record<WeightingCurve, number>;
  readonly cMinusALeq1mDb: number;
}

export interface SplAlertThresholds {
  readonly enabled: boolean;
  readonly metric: 'LAeq15m' | 'LAeq1m' | 'LAF' | 'LCeq1m' | 'LZpeak';
  readonly warningDb: number; // default 98.0 dB
  readonly limitDb: number;   // default 102.0 dB
}

export interface SplHistoryData {
  /** Number of populated points in the exported view window */
  readonly length: number;
  /** Resolution of this snapshot in seconds (0.25 for <=5m windows, 1.0 for >=15m windows) */
  readonly stepSec: number;
  /** Relative time offsets in seconds (negative up to 0 = now, e.g. -900 .. 0) */
  readonly timeSec: Float32Array;
  /** Short-term Fast/Slow A-weighted trace (dB) */
  readonly shortTermDbA: Float32Array;
  /** Short-term Fast/Slow C-weighted trace (dB) */
  readonly shortTermDbC: Float32Array;
  /** Sliding 1-minute LAeq trace (dB) */
  readonly leq1mDbA: Float32Array;
  /** Sliding 15-minute LAeq trace (dB) */
  readonly leq15mDbA: Float32Array;
  /** Per-epoch Peak trace (dB) */
  readonly peakDb: Float32Array;
}
```

### 3.1 Integration with `SourceData` & Worker Transport
- `BroadbandLevelsSnapshot` in `src/dsp/weighting-meters.ts` includes `rollingLeq: RollingLeqSnapshot`.
- `SourceData` in `src/sources/source-data.ts` includes `splHistory?: SplHistoryData`.
- Because the 25 Hz DSP worker loop (`src/dsp/dsp.worker.ts`) runs every `40 ms` while `SplHistoryTracker` steps at `250 ms` (4 Hz) and `1,000 ms` (1 Hz), the worker reuses the same `SplHistoryData` typed-array view between 250 ms epochs and downsamples to at most `1,800` display vertices when posting to the UI thread.

---

## 4. Charting & UI Specification

### 4.1 `'spl-history'` Plot Type in `<chart-panel>`
Adding `'spl-history'` to `PlotType` (`src/charts/plot-types.ts`) allows any `<chart-panel>` to render the time-series level chart:
- **Coordinate Mapping**:
  - Linear X-axis in relative time (`xUnit: 's'`, formatted as `-15m`, `-10m`, `-5m`, `0s` on major gridlines).
  - Linear Y-axis in `dB` (`defaultYMin: 50`, `defaultYMax: 115`, `yStep: 10`).
- **Chart Header Controls (`src/charts/chart-header-view.ts`)**:
  - **Time Span Dropdown**: `1 min (4 Hz)` | `5 min (4 Hz)` | `15 min` | `60 min` | `4 hours`
  - **Trace Mode Dropdown**: `dBA (Fast + Leq1m)` | `dBA vs dBC (Leq1m)` | `Compliance (Leq15m + Peak)` | `Multi-Mic Comparison`
  - **Threshold Guides Toggle**: `[✓ Limits (98 / 102 dB)]`
- **2D Canvas & WebGL2 Rendering (`src/charts/canvas-chart-painter.ts` & `gl-trace-renderer.ts`)**:
  - Uses `GlTraceRenderer` + `drawCanvasTrace` for the primary curves.
  - Draws shaded fill under the short-term `LAF` envelope and horizontal dashed amber (`warningDb`) and red (`limitDb`) threshold lines across the plot box.
- **Acoustic Cursor Readout (`computeCursorReadout`)**:
  - Hovering at any point on the timeline displays:
    - Relative time (`-12m 34s`) and wall-clock time (`21:18:42`)
    - Exact `LAF`, `LAeq,1m`, `LAeq,15m`, `LCeq,1m`, and `Peak` values at that second (or per-microphone values in `Multi-Mic Comparison` mode).

### 4.2 Crash-Resilient Show Log Persistence & CSV Export
1. **IndexedDB Checkpointing (`src/sources/session-storage.ts`)**:
   - Adds an `spl-show-logs` object store in `web-sound-meter-db` (schema version bumped to `v3` with non-destructive upgrade).
   - Every 10 seconds during unpaused measurement, the active 1 Hz energy ring buffer is saved per slot (`id: slotId`).
   - If the engineer accidentally refreshes the browser tab mid-show (and within 30 minutes of the last checkpoint), `SplHistoryTracker` hydrates the prior 1 Hz energy buckets so rolling $L_{\text{Aeq,15m}}$ and $L_{\text{Aeq,60m}}$ continue without losing show history.
   - An explicit **`[Reset Show Log]`** button clears both the in-memory ring buffers and the IndexedDB checkpoint.
2. **CSV Export**:
   - Generates a standard UTF-8 CSV file (`websoundmeter-spl-log-YYYY-MM-DD-HHmm.csv`) with columns:
     ```csv
     timestamp_iso,elapsed_sec,slot_id,slot_name,laf_db,lcf_db,laeq_1m_db,lceq_1m_db,laeq_15m_db,lpeak_db
     ```
