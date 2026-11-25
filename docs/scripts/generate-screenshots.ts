// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Regenerates all Retina (2x DPR) documentation and tutorial screenshots directly from
 * `<!-- screenshot ... -->` YAML metadata blocks embedded in Markdown files across
 * `docs/tutorials/*.md`, `apps/WebSoundMeter/docs/user-guide.md`, and
 * `apps/WebSpeakerSim/docs/user-guide.md`, then downscales clean PWA manifest carousels.
 *
 * Executed directly via Node 26 native TypeScript:
 *   npm run docs:screenshots
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { syncPwaManifestScreenshots } from './pwa-manifest-screenshots.ts';
import { parseAllMarkdownScreenshotSpecs } from './screenshot-spec.ts';
import { createSceneCapturer } from './session-helpers.ts';
import { TUTORIAL_SCENE_IDS, captureTutorialScenes } from './tutorial-scenes.ts';
import { WSM_GUIDE_SCENE_IDS, captureWsmGuideScenes } from './wsm-guide-scenes.ts';
import { WSS_GUIDE_SCENE_IDS, captureWssGuideScenes } from './wss-guide-scenes.ts';

export const ALL_REGISTERED_SCENE_IDS: ReadonlySet<string> = new Set([
  ...WSS_GUIDE_SCENE_IDS,
  ...WSM_GUIDE_SCENE_IDS,
  ...TUTORIAL_SCENE_IDS,
]);

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const WSM_PORT = Number(process.env.WSM_SCREENSHOT_PORT || 5373);
const WSS_PORT = Number(process.env.WSS_SCREENSHOT_PORT || 5374);

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
      reject(
        new Error(
          `Timed out starting ${appFolder} preview on port ${port}: ${stderrBuf}`
        )
      );
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

export async function runScreenshotGeneration(): Promise<void> {
  const specs = parseAllMarkdownScreenshotSpecs(REPO_ROOT);
  const specScenes = new Set(specs.map((s) => s.scene));
  for (const s of specScenes) {
    if (!ALL_REGISTERED_SCENE_IDS.has(s)) {
      throw new Error(`Unknown scene "${s}" in Markdown <!-- screenshot --> spec`);
    }
  }
  for (const reg of ALL_REGISTERED_SCENE_IDS) {
    if (!specScenes.has(reg)) {
      throw new Error(`Registered scene "${reg}" has no Markdown <!-- screenshot --> spec`);
    }
  }
  console.log(`Parsed and verified ${specs.length} Markdown <!-- screenshot --> specs.`);
  const capturer = createSceneCapturer(specs);

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
      tmpDir,
      capturer,
    });

    await captureWsmGuideScenes({
      browser,
      wsmUrl,
      exportedFrdPath,
      capturer,
    });

    await captureTutorialScenes({
      browser,
      wsmUrl,
      wssUrl,
      exportedFrdPath,
      capturer,
    });

    capturer.assertAllCaptured();
    await syncPwaManifestScreenshots(browser, REPO_ROOT);

    console.log(
      `Successfully generated all ${specs.length} Retina documentation & tutorial screenshots.`
    );
  } finally {
    if (browser) {
      await browser.close();
    }
    wsmServer.kill('SIGTERM');
    wssServer.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  runScreenshotGeneration().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
