# 05. Persistence, Undo/Redo & State Management

## 1. Reactive `ProjectStore` & Undo/Redo Stack (`src/model/project-store.ts`)

All mutable project state lives in a single normalized `ProjectScene` object managed by `ProjectStore`:
- **Audience Surfaces (`AudienceSurface[]`):** Floor, raked seating, balcony, and stage rejection zones (`xStart`, `xEnd`, `widthStart`, `widthEnd`, `yOffset`, `zStart`, `zEnd`, `earHeight`, `role: 'audience' | 'stage'`).
- **DSP Groups (`DspGroup[]`):** Named processing channels (e.g., *Main L/R*, *Front Fills*, *Sub Array*, *Delay Ring*) holding `gainDb`, `mute`, `invertPolarity`, `delayMs`, `highPass`, `lowPass`, and `eqBands`.
- **Point Sources (`PointSourceInstance[]`):** Speaker model reference (`speakerId`), pose (`x, y, z, azimuthDeg, tiltDeg, rollDeg`), optional `mirrorLeftRight` flag (automatically spawning a symmetric twin at `-y, -azimuthDeg`), `dspGroupId`, and per-box trim (`trimGainDb`, `trimDelayMs`, `invertPolarity`, `muted`).
- **Subwoofer Arrays (`SubArrayInstance[]`):** Parameterized array descriptor (`mode: 'broadside' | 'cardioid-csa' | 'end-fire' | 'delay-arc'`, box count, center pose, spacing, arc angle, tuning frequency, `speakerId`, `dspGroupId`) that deterministically expands into constituent radiator elements.
- **Virtual Microphones (`VirtualMicInstance[]`):** Probe coordinate `(x, y, z)`, label, trace color, and visibility flag.
- **Environment & Simulation Settings (`EnvironmentConfig`):** Temperature ($^\circ\text{C}$), relative humidity (%), pressure ($\text{kPa}$), ground reflection toggle + reflection factor $R_g$, active display band/weighting, and colormap SPL range.

### 1.1 Command Coalescing for Drag Operations
Continuous slider or CAD drag interactions pass a `transactionKey` (e.g., `'drag-source-main-L'`). `ProjectStore` updates live simulation state immediately on every pointer move while coalescing consecutive mutations sharing the same `transactionKey` within a gesture into a single **Undo / Redo** history snapshot (`Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`).

---

## 2. Three-Tier Persistence Architecture

| Tier | Module | Backing Store | Scope & Behavior |
| :--- | :--- | :--- | :--- |
| **Tier 1** | `src/model/url-state.ts` | Browser URL (`?preset=...&band=...&view=...`) | Instant shareable links for built-in presets, active frequency/weighting mode, and viewport split layout, with `popstate` Back/Forward navigation. |
| **Tier 2** | `src/model/workspace-session.ts` | `localStorage` (`wss.workspace.v1`) | Debounced synchronous autosave of the active `ProjectScene` and UI panel layout so refreshing or reopening the browser restores exact work-in-progress state. |
| **Tier 3** | `src/model/session-storage.ts` | `IndexedDB` (`web-speaker-sim-db`, v1) | Structured object stores for **Saved Venue Projects** (`projects`) and **Custom / Imported Loudspeakers** (`speakers`, including imported `.gll`/`.clf`/`.frd` binary `Float32Array` balloons), plus `.wss-project.json` file export/import. |

---

## 3. Offline PWA & Service Worker (`src/pwa/`)

Live-sound system preparation frequently takes place in arenas, basements, or festival fields without reliable network connectivity:
- `vite.config.ts` emits a deterministic build-hashed `sw.js` precaching `index.html`, `manifest.webmanifest`, icons, and all compiled JS/Worker chunks.
- Every cached response preserves `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers so `SharedArrayBuffer` (when used for zero-copy grid transfer) remains enabled even when launched 100% offline from the OS dock or home screen.

