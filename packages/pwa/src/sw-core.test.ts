// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  buildCacheName,
  cleanupOldCaches,
  handleServiceWorkerFetch,
  installPrecache,
  selectObsoleteCaches,
  shouldInterceptRequest,
  shouldInterceptSameOriginGet,
  withCrossOriginIsolationHeaders,
} from './sw-core.js';

class MockCache {
  private readonly store = new Map<string, Response>();

  async addAll(urls: string[]): Promise<void> {
    for (const url of urls) {
      const normalized = url.startsWith('.') ? url.slice(1) : url;
      this.store.set(
        normalized,
        new Response(`precached:${normalized}`, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      );
    }
  }

  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    const key =
      typeof req === 'string'
        ? req
        : req instanceof URL
          ? req.pathname + req.search
          : new URL(req.url).pathname + new URL(req.url).search;
    this.store.set(key, res);
  }

  async match(req: RequestInfo | URL): Promise<Response | undefined> {
    const key =
      typeof req === 'string'
        ? req
        : req instanceof URL
          ? req.pathname + req.search
          : new URL(req.url).pathname + new URL(req.url).search;
    const found = this.store.get(key);
    return found ? found.clone() : undefined;
  }
}

class MockCacheStorage {
  private readonly caches = new Map<string, MockCache>();

  async open(name: string): Promise<Cache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new MockCache();
      this.caches.set(name, c);
    }
    return c as unknown as Cache;
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

describe('sw-core', () => {
  it('injects COOP and COEP headers when missing and preserves them when present', async () => {
    const raw = new Response('hello', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
    const isolated = withCrossOriginIsolationHeaders(raw);
    expect(isolated.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(isolated.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(isolated.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(await isolated.text()).toBe('hello');
    expect(withCrossOriginIsolationHeaders(isolated)).toBe(isolated);
  });

  it('installs precache assets and prunes obsolete cache versions by prefix', async () => {
    const storage = new MockCacheStorage();
    const active = buildCacheName('foh-precache-', 'v2');
    await installPrecache(storage, 'foh-precache-old', ['/index.html']);
    await installPrecache(storage, active, ['/index.html', '/assets/app.js']);
    await storage.open('unrelated-cache');

    expect(
      selectObsoleteCaches(await storage.keys(), active, 'foh-precache-')
    ).toEqual(['foh-precache-old']);

    const deleted = await cleanupOldCaches(storage, active, 'foh-precache-');
    expect(deleted).toEqual(['foh-precache-old']);
    expect(await storage.keys()).toEqual([active, 'unrelated-cache']);
  });

  it('filters out non-GET, cross-origin, and Vite HMR requests', () => {
    const origin = 'https://soundtools.example';
    expect(
      shouldInterceptRequest(
        new Request('https://soundtools.example/assets/app.js', { method: 'GET' }),
        origin
      )
    ).toBe(true);
    expect(
      shouldInterceptSameOriginGet('POST', 'https://soundtools.example/api', origin)
    ).toBe(false);
    expect(
      shouldInterceptSameOriginGet('GET', 'https://other.example/script.js', origin)
    ).toBe(false);
    expect(
      shouldInterceptSameOriginGet('GET', 'https://soundtools.example/@vite/client', origin)
    ).toBe(false);
  });

  it('serves cached /index.html with COOP/COEP headers for parameterized navigation URLs when offline', async () => {
    const storage = new MockCacheStorage();
    await installPrecache(storage, 'foh-v1', ['/index.html']);

    const offlineFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    const navReq = new Request(
      'https://soundtools.example/?layout=3&plots=magnitude,phase',
      { headers: { Accept: 'text/html' } }
    );

    const res = await handleServiceWorkerFetch(navReq, storage, 'foh-v1', offlineFetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(await res.text()).toBe('precached:/index.html');
  });

  it('serves static assets Network-First when online and falls back to cache when offline', async () => {
    const storage = new MockCacheStorage();
    await installPrecache(storage, 'foh-v1', ['/assets/precached.js']);

    const netFetch = vi.fn().mockImplementation(async (req: Request) => {
      return new Response(`network:${new URL(req.url).pathname}`, { status: 200 });
    });

    const onlineReq = new Request('https://soundtools.example/assets/worker.js');
    const onlineRes = await handleServiceWorkerFetch(onlineReq, storage, 'foh-v1', netFetch);
    expect(await onlineRes.text()).toBe('network:/assets/worker.js');

    const offlineFetch = vi.fn().mockRejectedValue(new Error('Offline'));
    const cachedRuntimeRes = await handleServiceWorkerFetch(
      onlineReq,
      storage,
      'foh-v1',
      offlineFetch
    );
    expect(await cachedRuntimeRes.text()).toBe('network:/assets/worker.js');

    const cachedPrecacheRes = await handleServiceWorkerFetch(
      new Request('https://soundtools.example/assets/precached.js'),
      storage,
      'foh-v1',
      offlineFetch
    );
    expect(await cachedPrecacheRes.text()).toBe('precached:/assets/precached.js');
  });
});
