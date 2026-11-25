// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function computeShortHash(items) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const joined = items.join('|');
  for (let i = 0; i < joined.length; i++) {
    const ch = joined.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0').slice(0, 2);
}

export function buildServiceWorkerScript(cachePrefix, cacheName, precacheUrls) {
  return `// Auto-generated WebSoundTools Offline Service Worker
const CACHE_PREFIX = ${JSON.stringify(cachePrefix)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};

function withCrossOriginIsolationHeaders(response) {
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }
  const coop = response.headers.get('Cross-Origin-Opener-Policy');
  const coep = response.headers.get('Cross-Origin-Embedder-Policy');
  const corp = response.headers.get('Cross-Origin-Resource-Policy');
  if (
    coop === 'same-origin' &&
    coep === 'require-corp' &&
    corp === 'same-origin' &&
    !response.redirected
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/@vite') || url.searchParams.has('html-proxy')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const acceptHeader = request.headers.get('accept') || '';
      const isNavigation = request.mode === 'navigate' || acceptHeader.includes('text/html');

      if (isNavigation) {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            await cache.put('/index.html', networkResponse.clone());
            return withCrossOriginIsolationHeaders(networkResponse);
          }
        } catch {
          // Offline fallback
        }
        const cachedHtml =
          (await cache.match('/index.html')) ||
          (await cache.match('./index.html')) ||
          (await cache.match('/')) ||
          (await cache.match(request));
        if (cachedHtml) {
          return withCrossOriginIsolationHeaders(cachedHtml);
        }
        return new Response('Offline and application shell not cached.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          await cache.put(request, networkResponse.clone());
          return withCrossOriginIsolationHeaders(networkResponse);
        }
      } catch {
        // Offline fallback
      }

      const cachedAsset = await cache.match(request);
      if (cachedAsset) {
        return withCrossOriginIsolationHeaders(cachedAsset);
      }

      return new Response('Offline and asset not in cache.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })()
  );
});
`;
}

const DEFAULT_STATIC_PATHS = ['/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

export function fohPwaPlugin(options) {
  const { cachePrefix, cacheVersion = 'v1', staticPaths = DEFAULT_STATIC_PATHS } = options;
  const devPrecache = ['/', ...staticPaths];
  const devCacheName = `${cachePrefix}${cacheVersion}-dev`;

  function handleSwRequest(req, res, next) {
    const reqUrl = req && req.url;
    if (reqUrl && reqUrl.split('?')[0] === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.end(buildServiceWorkerScript(cachePrefix, devCacheName, devPrecache));
      return;
    }
    next();
  }

  return {
    name: 'foh-offline-sw-plugin',
    configureServer(server) {
      server.middlewares.use(handleSwRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleSwRequest);
    },
    generateBundle(_outputOptions, bundle) {
      const urls = new Set(['./']);
      for (const p of staticPaths) {
        urls.add(p.startsWith('/') ? `.${p}` : p);
      }

      const sortedFiles = Object.keys(bundle).sort();
      for (const fileName of sortedFiles) {
        if (fileName.endsWith('.map')) continue;
        urls.add(`./${fileName}`);
      }
      const cacheName = `${cachePrefix}${cacheVersion}-${computeShortHash(sortedFiles)}`;
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: buildServiceWorkerScript(cachePrefix, cacheName, Array.from(urls)),
      });
    },
  };
}
