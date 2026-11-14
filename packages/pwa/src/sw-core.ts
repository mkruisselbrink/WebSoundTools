// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure Service Worker caching and Cross-Origin Isolation (`COOP`/`COEP`) core (`@foh/pwa/sw`).
 *
 * Ensures Network-First navigation & query-qualified module caching with offline CacheStorage
 * fallback and `SharedArrayBuffer`-compatible `COOP`/`COEP` response headers.
 */

export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export function buildCacheName(prefix: string, versionHash: string): string {
  return `${prefix}${versionHash}`;
}

export function selectObsoleteCaches(
  existingCacheNames: readonly string[],
  activeCacheName: string,
  prefix: string
): string[] {
  return existingCacheNames.filter(
    (name) => name.startsWith(prefix) && name !== activeCacheName
  );
}

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
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) {
    headers.set(k, v);
  }

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
  prefix: string
): Promise<string[]> {
  const keys = await cacheStorage.keys();
  const obsolete = selectObsoleteCaches(keys, activeCacheName, prefix);
  for (const key of obsolete) {
    await cacheStorage.delete(key);
  }
  return obsolete;
}

export function shouldInterceptSameOriginGet(
  method: string,
  requestUrl: string,
  selfOrigin: string
): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  try {
    const parsed = new URL(requestUrl);
    if (parsed.origin !== selfOrigin) return false;
    if (parsed.pathname.startsWith('/@vite') || parsed.searchParams.has('html-proxy')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function shouldInterceptRequest(request: Request, scopeOrigin: string): boolean {
  return shouldInterceptSameOriginGet(request.method, request.url, scopeOrigin);
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

  // Network-First with Offline Cache Fallback keyed by full URL (including search params)
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
