/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function computeShortHash(items: readonly string[]): string {
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

function buildServiceWorkerScript(cacheName: string, precacheUrls: readonly string[]): string {
  return `// Auto-generated WebSpeakerSim Offline Service Worker
const CACHE_PREFIX = 'wss-precache-';
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};

function withCrossOriginIsolationHeaders(response) {
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }
  const coop = response.headers.get('Cross-Origin-Opener-Policy');
  const coep = response.headers.get('Cross-Origin-Embedder-Policy');
  if (coop === 'same-origin' && coep === 'require-corp') {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
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

function wssOfflineSwPlugin(): Plugin {
  const devPrecache = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/icons/icon.svg',
  ];

  return {
    name: 'wss-offline-sw-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqUrl = (req as { url?: string }).url;
        if (reqUrl && reqUrl.split('?')[0] === '/sw.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          res.end(buildServiceWorkerScript('wss-precache-v1-dev', devPrecache));
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqUrl = (req as { url?: string }).url;
        if (reqUrl && reqUrl.split('?')[0] === '/sw.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          res.end(buildServiceWorkerScript('wss-precache-v1-dev', devPrecache));
          return;
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      const urls = new Set<string>([
        './',
        './index.html',
        './manifest.webmanifest',
        './icons/icon.svg',
      ]);

      const sortedFiles = Object.keys(bundle).sort();
      for (const fileName of sortedFiles) {
        if (fileName.endsWith('.map')) continue;
        urls.add(`./${fileName}`);
      }
      const cacheName = `wss-precache-v1-${computeShortHash(sortedFiles)}`;
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: buildServiceWorkerScript(cacheName, Array.from(urls)),
      });
    },
  };
}

export default defineConfig({
  plugins: [wssOfflineSwPlugin()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  worker: {
    format: 'es',
  },
  test: {
    name: 'web-speaker-sim',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
  },
});
