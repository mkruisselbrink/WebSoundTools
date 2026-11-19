// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regenerates all 22 Retina (2x DPR, 1440×900) documentation and tutorial screenshots
 * across `docs/images/`, `docs/tutorials/images/`, `apps/WebSoundMeter/docs/images/`,
 * and `apps/WebSpeakerSim/docs/images/`.
 *
 * Run from the workspace root via:
 *   npm run docs:screenshots
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { captureTutorialScenes } from './tutorial-scenes.mjs';
import { captureWsmGuideScenes } from './wsm-guide-scenes.mjs';
import { captureWssGuideScenes } from './wss-guide-scenes.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const WSM_PORT = Number(process.env.WSM_SCREENSHOT_PORT || 5373);
const WSS_PORT = Number(process.env.WSS_SCREENSHOT_PORT || 5374);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createRetinaPage(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  return { context, page };
}

function startPreviewServer(appFolder, port) {
  const viteBin = path.join(REPO_ROOT, 'node_modules/.bin/vite');
  const proc = spawn(viteBin, ['preview', '--port', String(port), '--strictPort'], {
    cwd: path.join(REPO_ROOT, 'apps', appFolder),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stderrBuf = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Timed out starting ${appFolder} preview on port ${port}: ${stderrBuf}`));
    }, 15000);

    proc.stdout.on('data', (chunk) => {
      if (String(chunk).includes(String(port))) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderrBuf += String(chunk);
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

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-screenshots-'));
  console.log('Starting Vite preview servers for WebSoundMeter & WebSpeakerSim...');
  const wsmServer = await startPreviewServer('WebSoundMeter', WSM_PORT);
  const wssServer = await startPreviewServer('WebSpeakerSim', WSS_PORT);

  const wsmUrl = `http://localhost:${WSM_PORT}`;
  const wssUrl = `http://localhost:${WSS_PORT}`;

  let browser;
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

    console.log('Successfully generated all 22 Retina documentation screenshots.');
  } finally {
    if (browser) {
      await browser.close();
    }
    wsmServer.kill('SIGTERM');
    wssServer.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

