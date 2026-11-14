/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
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

/**
 * Pure Service Worker caching and Cross-Origin Isolation (`COOP`/`COEP`) core (`src/pwa/sw-core.ts`).
 *
 * Ensures that:
 *  1. All application shell, DSP Worker, AudioWorklet, and icon assets are precached on install
 *     and updated in CacheStorage when online (Network-First with Offline Cache Fallback).
 *  2. Query-qualified module URLs (such as Vite's `?worker&url` vs. `?worker_file&type=module`)
 *     are keyed by their full URL including search parameters so wrapper modules and worker scripts
 *     never collide in CacheStorage.
 *  3. Navigation requests (including URL query states like `/?layout=3&plots=magnitude,phase`)
 *     fall back cleanly to cached `/index.html` when offline.
 *  4. Responses always carry `Cross-Origin-Opener-Policy: same-origin` and
 *     `Cross-Origin-Embedder-Policy: require-corp` so `SharedArrayBuffer` works offline.
 */

export const CACHE_PREFIX = 'wsm-precache-';

export function withCrossOriginIsolationHeaders(response: Response): Response {
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

export async function installPrecache(
  cacheStorage: Pick<CacheStorage, 'open'>,
  cacheName: string,
  urls: readonly string[]
): Promise<void> {
  const cache = await cacheStorage.open(cacheName);
  if (urls.length > 0) {
    await cache.addAll([...urls]);
  }
}

export async function cleanupOldCaches(
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete'>,
  activeCacheName: string,
  prefix: string = CACHE_PREFIX
): Promise<string[]> {
  const keys = await cacheStorage.keys();
  const deleted: string[] = [];
  for (const key of keys) {
    if (key.startsWith(prefix) && key !== activeCacheName) {
      await cacheStorage.delete(key);
      deleted.push(key);
    }
  }
  return deleted;
}

export function shouldInterceptRequest(request: Request, scopeOrigin: string): boolean {
  if (request.method !== 'GET') {
    return false;
  }
  const url = new URL(request.url);
  if (url.origin !== scopeOrigin) {
    return false;
  }
  // Ignore Vite HMR client/ping endpoints in dev mode
  if (url.pathname.startsWith('/@vite') || url.searchParams.has('html-proxy')) {
    return false;
  }
  return true;
}

export async function handleServiceWorkerFetch(
  request: Request,
  cacheStorage: Pick<CacheStorage, 'open'>,
  cacheName: string,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const cache = await cacheStorage.open(cacheName);
  const acceptHeader = request.headers.get('accept') ?? '';
  const isNavigation =
    request.mode === 'navigate' || acceptHeader.includes('text/html');

  if (isNavigation) {
    try {
      const networkResponse = await fetchImpl(request);
      if (networkResponse && networkResponse.ok) {
        await cache.put('/index.html', networkResponse.clone());
        return withCrossOriginIsolationHeaders(networkResponse);
      }
    } catch {
      // Offline — fall through to cached index.html
    }

    const cachedHtml =
      (await cache.match('/index.html')) ??
      (await cache.match('./index.html')) ??
      (await cache.match('/')) ??
      (await cache.match(request));

    if (cachedHtml) {
      return withCrossOriginIsolationHeaders(cachedHtml);
    }

    return new Response('Offline and application shell not cached.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Network-First with Offline Cache Fallback (keyed by full request URL including query string)
  try {
    const networkResponse = await fetchImpl(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      return withCrossOriginIsolationHeaders(networkResponse);
    }
  } catch {
    // Offline — fall through to cache
  }

  const cachedAsset = await cache.match(request);
  if (cachedAsset) {
    return withCrossOriginIsolationHeaders(cachedAsset);
  }

  return new Response('Offline and asset not in cache.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
