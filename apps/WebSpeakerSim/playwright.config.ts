// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

function resolveE2eServer(
  defaultPort: number,
  fallbackPort: number,
  appTag: string
): { readonly port: number; readonly reuseExistingServer: boolean } {
  if (process.env.CI) {
    return { port: defaultPort, reuseExistingServer: false };
  }
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `fetch('http://localhost:${defaultPort}/').then(r=>r.text()).then(t=>process.stdout.write(t.includes('${appTag}')?'match':'other')).catch(()=>process.stdout.write('free'))`,
    ],
    { encoding: 'utf8', timeout: 1000 }
  );
  if ((probe.stdout || '').trim() === 'other') {
    return { port: fallbackPort, reuseExistingServer: false };
  }
  return { port: defaultPort, reuseExistingServer: true };
}

const { port, reuseExistingServer } = resolveE2eServer(
  5174,
  5274,
  'web-speaker-sim-app'
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    actionTimeout: 6000,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `"${process.execPath}" ../../node_modules/.bin/vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer,
    timeout: 30000,
  },
});
