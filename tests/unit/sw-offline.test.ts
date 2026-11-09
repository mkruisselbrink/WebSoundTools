/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from 'vitest';
import { registerOfflineServiceWorker } from '../../src/pwa/register-sw.js';
import {
  cleanupOldCaches,
  handleServiceWorkerFetch,
  installPrecache,
  shouldInterceptRequest,
  withCrossOriginIsolationHeaders,
} from '../../src/pwa/sw-core.js';

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

describe('PWA Offline Service Worker Core & Registration', () => {
  it('injects COOP and COEP headers when missing and preserves them when present', async () => {
    const raw = new Response('hello', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
    const isolated = withCrossOriginIsolationHeaders(raw);
    expect(isolated.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(isolated.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(await isolated.text()).toBe('hello');

    // Already isolated response returns as-is
    const already = withCrossOriginIsolationHeaders(isolated);
    expect(already).toBe(isolated);
  });

  it('installs precache assets and cleans up outdated cache versions', async () => {
    const storage = new MockCacheStorage();
    await installPrecache(storage, 'wsm-precache-old', ['/index.html']);
    await installPrecache(storage, 'wsm-precache-v2', ['/index.html', '/assets/app.js']);
    await storage.open('unrelated-cache');

    const deleted = await cleanupOldCaches(storage, 'wsm-precache-v2');
    expect(deleted).toEqual(['wsm-precache-old']);
    expect(await storage.keys()).toEqual(['wsm-precache-v2', 'unrelated-cache']);
  });

  it('filters out non-GET, cross-origin, and Vite HMR requests', () => {
    const origin = 'https://soundmeter.example';
    expect(
      shouldInterceptRequest(
        new Request('https://soundmeter.example/assets/app.js', { method: 'GET' }),
        origin
      )
    ).toBe(true);
    expect(
      shouldInterceptRequest(
        new Request('https://soundmeter.example/api', { method: 'POST' }),
        origin
      )
    ).toBe(false);
    expect(
      shouldInterceptRequest(
        new Request('https://other.example/script.js', { method: 'GET' }),
        origin
      )
    ).toBe(false);
    expect(
      shouldInterceptRequest(
        new Request('https://soundmeter.example/@vite/client', { method: 'GET' }),
        origin
      )
    ).toBe(false);
  });

  it('serves cached /index.html with COOP/COEP headers for parameterized navigation URLs when offline', async () => {
    const storage = new MockCacheStorage();
    await installPrecache(storage, 'wsm-precache-v1', ['/index.html']);

    const offlineFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    const navReq = new Request(
      'https://soundmeter.example/?layout=3&plots=magnitude,phase,impulse&preset=room-modes',
      {
        headers: { Accept: 'text/html' },
      }
    );

    const res = await handleServiceWorkerFetch(
      navReq,
      storage,
      'wsm-precache-v1',
      offlineFetch
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(await res.text()).toBe('precached:/index.html');
  });

  it('serves static assets Network-First when online and falls back to precached/runtime cache when offline', async () => {
    const storage = new MockCacheStorage();
    await installPrecache(storage, 'wsm-precache-v1', ['/assets/precached.js']);

    const netFetch = vi.fn().mockImplementation(async (req: Request) => {
      return new Response(`network:${new URL(req.url).pathname}`, { status: 200 });
    });

    // 1. Online request fetches fresh asset from network and updates cache
    const onlineReq = new Request('https://soundmeter.example/assets/worker.js');
    const onlineRes = await handleServiceWorkerFetch(
      onlineReq,
      storage,
      'wsm-precache-v1',
      netFetch
    );
    expect(await onlineRes.text()).toBe('network:/assets/worker.js');
    expect(netFetch).toHaveBeenCalledTimes(1);

    // 2. Offline request falls back to runtime cache or precached asset
    const offlineFetch = vi.fn().mockRejectedValue(new Error('Offline'));
    const cachedRuntimeRes = await handleServiceWorkerFetch(
      onlineReq,
      storage,
      'wsm-precache-v1',
      offlineFetch
    );
    expect(await cachedRuntimeRes.text()).toBe('network:/assets/worker.js');

    const cachedPrecacheRes = await handleServiceWorkerFetch(
      new Request('https://soundmeter.example/assets/precached.js'),
      storage,
      'wsm-precache-v1',
      offlineFetch
    );
    expect(await cachedPrecacheRes.text()).toBe('precached:/assets/precached.js');
  });

  it('registers the Service Worker safely and handles unsupported environments', async () => {
    const registerSpy = vi.fn().mockResolvedValue({});
    expect(await registerOfflineServiceWorker({ register: registerSpy }, '/sw.js')).toBe(
      true
    );
    expect(registerSpy).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    expect(await registerOfflineServiceWorker(undefined)).toBe(false);
    const failingSpy = vi.fn().mockRejectedValue(new Error('SW blocked'));
    expect(await registerOfflineServiceWorker({ register: failingSpy })).toBe(false);
  });
});

