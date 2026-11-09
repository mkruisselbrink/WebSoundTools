# 05. Persistence & State Management Architecture

`WebSoundMeter` uses a **three-tier client-side persistence architecture** so users can share views via URL, navigate layout/plot changes with browser Back/Forward buttons, and reload the browser without losing their measurement configuration, virtual sources, captured traces, or microphone calibration curves.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Tier 1: URL Query State (src/ui/url-state.ts)                              │
│  • Shareable, bookmarkable, and integrated with browser History API        │
│  • Stores: layout (1–3 charts), plots, mode, preset (or hw), spl, src      │
├────────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Workspace Session (src/sources/workspace-session.ts - localStorage)│
│  • Synchronous zero-flicker hydration on startup                           │
│  • Stores: DSP measurement config, active calibration ID, generator config,│
│    and hardware routing (device ID, remembered device label, channels)     │
├────────────────────────────────────────────────────────────────────────────┤
│ Tier 3: Source & Calibration Library (src/sources/session-storage.ts - IDB)│
│  • Asynchronous structured storage for arbitrary-size arrays & libraries   │
│  • Stores: Stored Traces (Float32Arrays), Virtual EQ Sources, Math Union   │
│    Sources, and Saved Microphone Calibration Curves (.cal/.txt/.frd)       │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Tier 1: URL Query State (`src/ui/url-state.ts`)

Top-level viewport and mode selections are encoded in compact URL query parameters:

```
/?layout=2&plots=magnitude,phase&preset=room-modes&spl=A-Fast&src=eq:a1b2c3
```

### 1.1 Supported Query Parameters

| Parameter | Example Values | Default (Omitted when matching default) | Description |
| :--- | :--- | :--- | :--- |
| `layout` | `1`, `2`, `3` | `2` | Number of stacked chart panels (`ChartLayoutCount`). |
| `plots` | `magnitude,phase,impulse` | `magnitude,phase,impulse` | Comma-separated `PlotType` per chart slot (`rta`, `magnitude`, `phase`, `coherence`, `impulse`, `step`, `group-delay`, `crest-factor`). |
| `mode` | `aligned`, `raw` | `aligned` | Display alignment mode (`aligned` vs. `raw`). |
| `preset` | `flat-delayed`, `room-modes`, `sub-top-misaligned`, `comb-filtering`, `noisy-crowd`, **`hw`** | `flat-delayed` | Active Demo Simulator preset, or `hw` when in **Hardware Audio Interface** mode. |
| `spl` | `A-Fast`, `C-Slow`, `Z-Leq` | `A-Fast` | Active broadband SPL meter weighting (`A`/`C`/`Z`) and integration (`Fast`/`Slow`/`Impulse`/`Leq`). |
| `src` | `live`, `stored:<id>`, `eq:<id>`, `union:<id>` | `live` | Currently selected source in the right-hand inspector drawer. |

### 1.2 History API Integration (`pushState` vs. `replaceState`)
- **Major navigation actions (`history.pushState`)**:
  - Changing the chart layout count (`1`, `2`, `3`)
  - Changing a chart slot's plot type (e.g., switching Chart 2 from `Phase` to `Impulse / ETC`)
  - Switching the input preset or toggling between Demo Simulator and Hardware Audio (`preset=hw`)
  - Pressing Browser **Back / Forward** fires `window.onpopstate`, which restores the layout, plot types, alignment mode, SPL weighting, selected source, and simulator/hardware mode without reloading the page.
- **High-frequency / secondary selections (`history.replaceState`)**:
  - Selecting a different source in the sidebar (`src=...`), toggling `mode`, or cycling the `spl` weighting updates the URL in-place via `replaceState` so the URL stays current without cluttering the Back button history stack.
- **Clean Default URLs**:
  - Any parameter matching its default value is omitted by `serializeUrlState()` so the default initial workspace keeps a clean `/` URL.

---

## 2. Tier 2: Workspace Session (`src/sources/workspace-session.ts`)

Detailed DSP analyzer settings, generator parameters, and hardware audio routing are stored in `localStorage` under `web-sound-meter:workspace:v1`.

### 2.1 Why `localStorage`?
`localStorage.getItem()` is **synchronous**. When `<wsm-app-shell>` initializes, it reads `loadWorkspaceSession()` before the first Lit render and before sending the `init` message to the DSP Web Worker. This guarantees:
1. The DSP worker boots immediately with the user's saved `fftSize`, `windowType`, `averagingType`, `fifoDepth`, `octaveSmoothing`, `estimator`, `delayMs`, `gainDb`, `inputFilter`, `lpfCutoffHz`, and `invertPolarity`.
2. There is zero visual flicker or double-initialization of FFT buffers on startup.

### 2.2 Schema (`WorkspaceSessionSnapshot`)
```ts
export interface WorkspaceSessionSnapshot {
  readonly version: 1;
  readonly layoutPreset: LayoutPreset;
  readonly chartPlotTypes: PlotType[];
  readonly audioInputMode: InputSourceMode;
  readonly simulatorPreset: SimulatorPresetId;
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly selectedSourceId: string;
  readonly liveSlots: LiveMeasurementSlotConfig[];
  readonly genConfig: Pick<
    SignalGeneratorConfig,
    'enabled' | 'type' | 'levelDbFs' | 'sineFrequencyHz'
  >;
  readonly hardwareRouting: {
    readonly selectedDeviceId: string;
    readonly selectedDeviceLabel: string;
    readonly generatorOutputChannel: number;
  };
}
```

### 2.3 Safety Rules & Hardware Audio Reload Flow
1. **Signal Generator Muted on Boot (`genConfig.enabled = false`)**:
   - Even if the signal generator was active before reloading, `enabled` is never auto-restored as `true` on cold boot to prevent unexpected loud pink noise or sine tones from playing through a connected PA system upon opening a tab. Generator type, level (`levelDb`), and sine frequency (`sineFrequencyHz`) are preserved.
2. **Hardware Audio Mode Starts Paused on Reload**:
   - Modern browsers block `AudioContext.resume()` and `navigator.mediaDevices.getUserMedia()` until a user gesture occurs, and hide device labels until permission is granted.
   - When reloading with `?preset=hw`:
     - The app stays in **Hardware Audio** mode (`audioInputMode = 'hardware'`) and starts **Paused (`isPaused = true`)** rather than falling back to the Demo Simulator.
     - The top-bar device dropdown displays the remembered `lastDeviceLabel` (e.g., ` Scarlett 2i2 USB (Paused — click Resume)`) alongside the saved `measurementChannel`, `referenceChannel`, and `generatorOutputChannel`.
     - Clicking **Resume** (or pressing `Space`) provides the required browser user gesture, enumerates devices, opens the raw multi-channel `getUserMedia` stream on the saved `selectedDeviceId`, and resumes live measurement seamlessly.

---

## 3. Tier 3: Source & Calibration Library (`src/sources/session-storage.ts`)

User-created domain objects and multi-kilobyte binary arrays are persisted asynchronously in **IndexedDB** (`web-sound-meter-db`, schema version `2`) across four object stores:

| Object Store | Key | Contents |
| :--- | :--- | :--- |
| `stored-traces` | `id` | Captured `StoredSource` traces, converting `Float32Array` frequency and impulse buffers to compact number arrays alongside trace color, notes, gain/delay offsets, and broadband levels. |
| `eq-sources` | `id` | Virtual Parametric EQ (`EqualizerSourceConfig`) definitions: name, color, visibility, target source ID, and parametric biquad band parameters (`BiquadBandConfig[]`). |
| `union-sources` | `id` | Math Union (`UnionSourceConfig`) definitions: name, color, visibility, combination mode (`vector-avg`, `power-avg`, `rms-avg`, `subtract`, `min`, `max`), and input source IDs. |
| `calibration-curves` | `id` | Uploaded microphone calibration files (`SavedCalibrationCurve`): filename (`name`), upload timestamp (`uploadedAt`), and parsed `{ frequencyHz, magnitudeDb, phaseDeg }[]` points. |

### 3.1 Reactive Source Graph Re-Evaluation on Startup
When `SessionStorage.loadAll()` completes on startup:
1. `SourceStore` populates all `StoredSource`, `EqualizerSourceConfig`, and `UnionSourceConfig` items and IMMEDIATELY runs `recomputeVirtualSources()` so any Virtual EQ or Math Union referencing stored traces renders on the chart before the first live DSP frame even arrives.
2. For each slot in `liveSlots`, if `slot.activeCalibrationId` matches a curve in `calibration-curves`, the curve is automatically loaded into that slot's `MeasurementPipeline` in the DSP Worker.

---

## 4. Offline Application Cache & PWA Installability (`src/pwa/`)

In addition to persisting user data, `WebSoundMeter` caches its entire application shell and worker/worklet bundles via a **Service Worker (`src/pwa/sw-core.ts` & `vite.config.ts`)** and exposes a **Web App Manifest (`public/manifest.webmanifest`)**:

1. **Build-Time Asset Precaching (`wsmOfflineSwPlugin` in `vite.config.ts`)**:
   - During `vite build`, the plugin collects all emitted Rollup chunks (`index.html`, main UI bundle, `dsp.worker.js`, `capture-worklet.js`, `manifest.webmanifest`, and app icons), computes a deterministic content hash (`wsm-precache-<hash>`), and emits `dist/sw.js`.
   - On activation, outdated `wsm-precache-*` caches are automatically pruned.
2. **Offline Navigation & Parameterized URL Support**:
   - Navigation requests (`request.mode === 'navigate'`) use **Network-First with offline fallback to cached `/index.html`**. Reloading any bookmarkable URL with query parameters (e.g., `/?layout=tf-dual&preset=sub-top-misaligned`) works 100% offline.
3. **Cross-Origin Isolation (`COOP`/`COEP`) Header Preservation**:
   - `withCrossOriginIsolationHeaders()` ensures every response served from the Service Worker includes `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so `SharedArrayBuffer` (used by `MultiChannelRingBuffer`) continues to work when launched offline.

