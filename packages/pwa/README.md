# `@foh/pwa`

Offline Progressive Web App infrastructure shared across `WebSoundTools` applications.

## Entrypoints

- `@foh/pwa/client` (`src/register-sw.ts`, `src/wco.ts`): Safe `registerOfflineServiceWorker()` browser registration helper and `observeWindowControlsOverlay()` desktop PWA titlebar geometry observer with injectable containers for unit tests.
- `@foh/pwa/sw` (`src/sw-core.ts`): Pure Network-First navigation and query-URL asset caching policy + `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp` response header injection (`SharedArrayBuffer` support offline).
- `@foh/pwa/vite` (`src/vite-pwa-plugin.ts`): `fohPwaPlugin({ cachePrefix, cacheVersion, staticPaths })` Vite plugin serving `/sw.js` in dev/preview and emitting a content-hashed `sw.js` bundle asset during `vite build`.
