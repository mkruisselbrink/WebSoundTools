// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regenerates all Retina (2x DPR, 1440×900 + targeted UI crops) documentation and tutorial
 * screenshots across `docs/images/`, `docs/tutorials/images/`, `apps/WebSoundMeter/docs/images/`,
 * and `apps/WebSpeakerSim/docs/images/`.
 *
 * Executed directly via Node 26 native TypeScript:
 *   npm run docs:screenshots
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { syncPwaManifestScreenshots } from './pwa-manifest-screenshots.ts';
import { captureTutorialScenes } from './tutorial-scenes.ts';
import { captureWsmGuideScenes } from './wsm-guide-scenes.ts';
import { captureWssGuideScenes } from './wss-guide-scenes.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const WSM_PORT = Number(process.env.WSM_SCREENSHOT_PORT || 5373);
const WSS_PORT = Number(process.env.WSS_SCREENSHOT_PORT || 5374);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetinaSession {
  readonly context: BrowserContext;
  readonly page: Page;
}

export async function createRetinaPage(browser: Browser): Promise<RetinaSession> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(4500);
  const page = await context.newPage();
  return { context, page };
}

export async function createTouchRetinaPage(
  browser: Browser,
  width: number,
  height: number
): Promise<RetinaSession> {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: width < 680,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(4500);
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => ({
          released: false,
          release: async () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      },
    });
  });
  return { context, page };
}

function startPreviewServer(
  appFolder: 'WebSoundMeter' | 'WebSpeakerSim',
  port: number
): Promise<ChildProcess> {
  const viteBin = path.join(REPO_ROOT, 'node_modules/.bin/vite');
  const proc = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(REPO_ROOT, 'apps', appFolder),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return new Promise((resolve, reject) => {
    let stderrBuf = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Timed out starting ${appFolder} preview on port ${port}: ${stderrBuf}`));
    }, 15000);

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(String(port))) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`${appFolder} preview exited early (${code}): ${stderrBuf}`));
      }
    });
  });
}

function cleanGeneratedPngDirs(repoRoot: string): void {
  const dirs = [
    path.join(repoRoot, 'docs/images'),
    path.join(repoRoot, 'docs/tutorials/images'),
    path.join(repoRoot, 'apps/WebSoundMeter/docs/images'),
    path.join(repoRoot, 'apps/WebSpeakerSim/docs/images'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.png')) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  }
}

async function main(): Promise<void> {
  cleanGeneratedPngDirs(REPO_ROOT);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-screenshots-'));
  console.log('Starting Vite preview servers for WebSoundMeter & WebSpeakerSim...');
  const wsmServer = await startPreviewServer('WebSoundMeter', WSM_PORT);
  const wssServer = await startPreviewServer('WebSpeakerSim', WSS_PORT);

  const wsmUrl = `http://localhost:${WSM_PORT}`;
  const wssUrl = `http://localhost:${WSS_PORT}`;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });

    const { exportedFrdPath } = await captureWssGuideScenes({
      browser,
      wssUrl,
      repoRoot: REPO_ROOT,
      tmpDir,
    });

    await captureWsmGuideScenes({
      browser,
      wsmUrl,
      repoRoot: REPO_ROOT,
      exportedFrdPath,
    });

    await captureTutorialScenes({
      browser,
      wsmUrl,
      wssUrl,
      repoRoot: REPO_ROOT,
      exportedFrdPath,
    });

    await syncPwaManifestScreenshots(browser, REPO_ROOT);

    console.log('Successfully generated all Retina documentation & tutorial screenshots.');
  } finally {
    if (browser) {
      await browser.close();
    }
    wsmServer.kill('SIGTERM');
    wssServer.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

