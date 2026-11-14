// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  buildServiceWorkerScript,
  computeShortHash,
  fohPwaPlugin,
} from './vite-pwa-plugin.js';

describe('vite-pwa-plugin', () => {
  it('computes deterministic hashes and generates isolated SW scripts', () => {
    const h1 = computeShortHash(['assets/a.js', 'assets/b.css']);
    const h2 = computeShortHash(['assets/a.js', 'assets/b.css']);
    const h3 = computeShortHash(['assets/a.js', 'assets/c.css']);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(10);

    const script = buildServiceWorkerScript('wsm-precache-', 'wsm-precache-v2-abc', [
      './',
      './index.html',
    ]);
    expect(script).toContain('const CACHE_PREFIX = "wsm-precache-";');
    expect(script).toContain('Cross-Origin-Embedder-Policy');

    const plugin = fohPwaPlugin({ cachePrefix: 'wsm-precache-', cacheVersion: 'v2' });
    expect(plugin.name).toBe('foh-offline-sw-plugin');
  });
});
