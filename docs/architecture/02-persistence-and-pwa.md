# 02. Unified 3-Tier Persistence & Offline PWA Architecture

Both `WebSoundMeter` and `WebSpeakerSim` implement a unified **3-Tier Browser Persistence Model** powered by `@foh/state` alongside an **Offline Cross-Origin-Isolated PWA** powered by `@foh/pwa`. Everything runs locally in the user's browser with zero backend servers or cloud accounts required.

---

## 1. The 3-Tier State Persistence Model

| Tier | Backing Mechanism | Shared `@foh/state` Primitive | Purpose |
| :--- | :--- | :--- | :--- |
| **Tier 1: Ephemeral Shareable View State** | URL Query String (`?param=...`) + `history.replaceState` / `popstate` | `url-search-sync.ts` | Encodes lightweight view selections (layout mode, active plot types, preset ID, frequency band/weighting) directly in the URL bar for bookmarking, sharing, and Back/Forward navigation. |
| **Tier 2: Automatic Crash & Reload Recovery** | `window.localStorage` (debounced JSON snapshot) | `workspace-autosave.ts` | Automatically snapshots the active working session on change so reloading the browser tab—even offline at a venue—restores the exact workspace layout, routing, and scene configuration. |
| **Tier 3: Long-Term User Libraries & Logs** | `window.indexedDB` (multi-store object repository) | `idb-repository.ts` | Persists large binary/typed-array artifacts and multi-item user libraries across sessions: captured reference traces, virtual EQ/union sources, mic calibration curves, compliance logs, saved venue projects, and imported `.gll`/`.clf`/`.frd` loudspeaker models. |

### Undo/Redo & High-Rate Telemetry Separation (`ReactiveUndoStore`)

`@foh/state` provides `ReactiveUndoStore<TState>`, a 60-step immutable snapshot history store supporting `txKey` transaction coalescing (`350 ms` default window) so dragging a continuous Gain/Delay/EQ handle or 3D speaker coordinate records a single clean `Cmd/Ctrl + Z` step.

- In **`WebSpeakerSim`**, `ProjectStore` (`apps/WebSpeakerSim/src/model/project-store.ts`) extends `ReactiveUndoStore`, wrapping the authored `ProjectScene` and `ColormapConfig` while computed `PlanGridResult` / `VirtualMicResponse` buffers stay in `SimulationController`.
- In **`WebSoundMeter`**, `SourceStore` (`apps/WebSoundMeter/src/sources/source-store.ts`) composes `ReactiveUndoStore` **strictly around user-authored state** (`storedSources`, `eqSources`, `unionSources`, and user-editable live slot settings), keeping 25 FPS DSP Worker telemetry (`liveSourcesById`, `feedbackRingLog`, and `Float32Array` FFT bins) completely outside undo snapshots so live metering never allocates history entries.

---

## 2. Application Storage Schemas (Compatibility Contract)

All browser storage keys, IndexedDB database names, schema versions, and object store names are locked by unit tests so existing user data in deployed browsers is preserved across updates.

### `WebSoundMeter` (`apps/WebSoundMeter/src/sources/`)

- **Tier 1 URL Parameters (`src/ui/url-state.ts`):**
  - `mode` (`tuning` | `show`), `layout` (`single` | `dual` | `triple` | `quad` | `show-dual` | `show-triple`), `plots` (comma-separated `PlotType` list), `preset` (`SimulatorPresetId`), `gen` (`SignalWaveform`), `coh` (`0` | `1`).
- **Tier 2 `localStorage` Key (`src/sources/workspace-session.ts`):**
  - Key: `'web-sound-meter:workspace:v1'`
  - Stores active workspace mode/layout, plot selections, generator config, hardware routing preferences, live measurement slot configs, meter weighting/integration settings, and SPL alert thresholds.
- **Tier 3 `IndexedDB` Schema (`src/sources/session-storage.ts`):**
  - Database: `DB_NAME = 'web-sound-meter-db'`, `DB_VERSION = 3` (`fallbackMode: 'noop'`)
  - Object Stores (`keyPath: 'id'`):
    - `'stored-traces'` — Captured live traces and imported `.frd` reference traces (`SerializedSourceData`)
    - `'eq-sources'` — Virtual DSP & Parametric EQ sources (`EqualizerSourceConfig` with full `SourceDspConfig`)
    - `'union-sources'` — Multi-source Math / Union combinations (`UnionSourceConfig`)
    - `'calibration-curves'` — Imported `.cal` / `.frd` / `.txt` microphone calibration files (`StoredCalibrationFile`)
    - `'spl-show-logs'` — Rolling SPL / Leq show compliance checkpoints (`SplHistoryCheckpoint`)

### `WebSpeakerSim` (`apps/WebSpeakerSim/src/model/`)

- **Tier 1 URL Parameters (`src/model/url-state.ts`):**
  - `preset` (demo venue ID), `layout` (`split` | `plan` | `section` | `charts`), `band` (single frequency Hz or `broadband` / `sub`), `weighting` (`A` | `C` | `Z`), `shape` (`pink` | `music`).
- **Tier 2 `localStorage` Key (`src/model/workspace-session.ts`):**
  - Key: `'wss.workspace.v1'`
  - Stores `version: 1`, `activePresetId`, full `ProjectScene`, `ColormapConfig`, `layoutMode`, and `chartDrawerExpanded`.
- **Tier 3 `IndexedDB` Schema (`src/model/session-storage.ts`):**
  - Database: `IDB_DATABASE_NAME = 'web-speaker-sim-db'`, `IDB_DATABASE_VERSION = 1` (`fallbackMode: 'memory'`)
  - Object Stores (`keyPath: 'id'`):
    - `'projects'` — Named saved venue designs (`SavedProjectRecord`)
    - `'speakers'` — Custom Datasheet Spec Builder & imported `.gll` / `.clf` / `.frd` loudspeaker models (`SpeakerDefinition`)
- **Portable File Exchange:**
  - `.wss-project.json` (`format: 'wss-project-v1'`) bundles `scene`, `colormap`, and any referenced `customSpeakers` into a single self-contained JSON file.
  - Virtual Mic **Export Predicted `.FRD`** writes standard 3-column `FreqHz\tMagDb\tPhaseDeg` files via `@foh/acoustics` for direct import into `WebSoundMeter`'s `'stored-traces'` library.

---

## 3. Offline PWA & Cross-Origin Isolation (`@foh/pwa`)

High-channel-count lock-free audio capture in `WebSoundMeter` (`MultiChannelRingBuffer` over `SharedArrayBuffer`) and high-resolution timer accuracy require **Cross-Origin Isolation**:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`@foh/pwa` guarantees these headers in every execution mode—including **100% offline launches**:

1. **Dev & Preview Servers (`@foh/pwa/vite`):** `fohPwaPlugin` injects `CROSS_ORIGIN_ISOLATION_HEADERS` on Vite's `server` and `preview` responses.
2. **Build-Time Precache Synthesis (`fohPwaPlugin`):** During `vite build` (`writeBundle`), the plugin inspects every hashed JS/CSS/worker/worklet bundle emitted into `dist/` plus static public assets (`index.html`, `manifest.webmanifest`, app icons), computes a content SHA-256 build hash, and emits a self-contained `dist/sw.js` (`wsm-precache-v2-<hash>` / `wss-precache-v1-<hash>`).
3. **Runtime Network-First + Offline Header Synthesis (`@foh/pwa/sw`):**
   - On `install`, the Service Worker precaches all hashed build assets and calls `skipWaiting()`.
   - On `activate`, `selectObsoleteCaches()` purges stale caches matching the app's `cachePrefix` and claims clients.
   - On same-origin `GET` requests, the Service Worker attempts a network fetch (updating the cache on `200 OK`) and falls back to the precache when offline (`index.html` fallback for SPA navigation requests).
   - Every response served by the Service Worker is passed through `withCrossOriginIsolationHeaders()`, ensuring `window.crossOriginIsolated === true` even when opening the installed PWA completely offline in an arena or festival field without Wi-Fi.

