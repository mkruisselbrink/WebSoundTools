// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { CROSS_ORIGIN_ISOLATION_HEADERS, fohPwaPlugin } from '@foh/pwa/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    fohPwaPlugin({
      cachePrefix: 'wss-precache-',
      cacheVersion: 'v2',
      staticPaths: [
        '/index.html',
        '/manifest.webmanifest',
        '/icons/icon.svg',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/screenshots/01-plan-and-section-spl-prediction.png',
        '/screenshots/02-cardioid-subwoofer-array-63hz.png',
        '/screenshots/03-virtual-mic-alignment-and-library.png',
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
    name: 'web-speaker-sim',
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
  },
});
