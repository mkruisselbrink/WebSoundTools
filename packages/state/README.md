# `@foh/state`

Headless reactive state, Undo/Redo transaction coalescing, and 3-tier browser persistence primitives (`0` UI dependencies).

## Exports

- `ReactiveUndoStore<T>`: Immutable-state pub-sub container with bounded (60-step default) Undo/Redo stacks and `txKey` time-window coalescing for continuous slider/canvas drags.
  - **25 FPS Rule:** Wrap only user-authored configuration state in `ReactiveUndoStore`; never store high-rate real-time telemetry buffers inside undo snapshots.
- `IdbRepository`: Multi-store `IndexedDB` CRUD wrapper with configurable `'memory'` or `'noop'` fallback for Node tests and restricted private-browsing contexts.
- `readStorageJson` / `writeStorageJson` / `removeStorageKey`: Exception-safe `localStorage` JSON snapshot helpers.
- `parseSearchParams` / `formatQueryString` / `syncBrowserQueryString`: Safe `URLSearchParams` & `history.replaceState` / `pushState` helpers.
