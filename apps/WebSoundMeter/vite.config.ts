// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { CROSS_ORIGIN_ISOLATION_HEADERS, fohPwaPlugin } from '@foh/pwa/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    fohPwaPlugin({
      cachePrefix: 'wsm-precache-',
      cacheVersion: 'v3',
      staticPaths: [
        '/index.html',
        '/manifest.webmanifest',
        '/icons/icon.svg',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/screenshots/01-pa-tuning-and-transfer-function.png',
        '/screenshots/02-virtual-eq-and-spatial-average.png',
        '/screenshots/03-live-show-spl-and-feedback.png',
        '/screenshots/04-mobile-live-show-deck.png',
      ],
    }),
  ],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
  preview: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
  worker: {
    format: 'es',
  },
  test: {
    name: 'web-sound-meter',
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
  },
});
