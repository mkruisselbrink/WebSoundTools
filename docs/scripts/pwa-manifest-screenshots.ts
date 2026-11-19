// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Downscales selected Retina (2880×1800) documentation screenshots into crisp 1440×900 PNGs
 * under `apps/<app>/public/screenshots/` for Web App Manifest Richer Install UI carousels.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';

export interface ManifestScreenshotSource {
  readonly sourceRelPath: string;
  readonly destFileName: string;
}

export const WSM_MANIFEST_SCREENSHOTS: readonly ManifestScreenshotSource[] = [
  {
    sourceRelPath: 'apps/WebSoundMeter/docs/images/01-tuning-workspace-overview.png',
    destFileName: '01-pa-tuning-and-transfer-function.png',
  },
  {
    sourceRelPath: 'apps/WebSoundMeter/docs/images/03-virtual-eq-and-crossovers.png',
    destFileName: '02-virtual-eq-and-spatial-average.png',
  },
  {
    sourceRelPath: 'apps/WebSoundMeter/docs/images/05-live-show-spl-and-feedback.png',
    destFileName: '03-live-show-spl-and-feedback.png',
  },
];

export const WSS_MANIFEST_SCREENSHOTS: readonly ManifestScreenshotSource[] = [
  {
    sourceRelPath: 'apps/WebSpeakerSim/docs/images/01-workspace-overview.png',
    destFileName: '01-plan-and-section-spl-prediction.png',
  },
  {
    sourceRelPath: 'apps/WebSpeakerSim/docs/images/05-subs-cardioid-63hz.png',
    destFileName: '02-cardioid-subwoofer-array-63hz.png',
  },
  {
    sourceRelPath: 'apps/WebSpeakerSim/docs/images/06-virtual-mic-time-alignment.png',
    destFileName: '03-virtual-mic-alignment-and-library.png',
  },
];

const TARGET_WIDTH = 1440;
const TARGET_HEIGHT = 900;

async function writeDownscaledGroup(
  browser: Browser,
  repoRoot: string,
  outRelDir: string,
  entries: readonly ManifestScreenshotSource[]
): Promise<void> {
  const outDir = path.join(repoRoot, outRelDir);
  fs.mkdirSync(outDir, { recursive: true });
  for (const existing of fs.readdirSync(outDir)) {
    if (existing.endsWith('.png')) {
      fs.unlinkSync(path.join(outDir, existing));
    }
  }

  const context = await browser.newContext({
    viewport: { width: TARGET_WIDTH, height: TARGET_HEIGHT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    for (const entry of entries) {
      const srcPath = path.join(repoRoot, entry.sourceRelPath);
      const b64 = fs.readFileSync(srcPath).toString('base64');
      const outB64 = await page.evaluate(
        async ({ dataUrl, w, h }) => {
          const img = new Image();
          img.decoding = 'sync';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to decode source PNG'));
            img.src = dataUrl;
          });
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        {
          dataUrl: 'data:image/png;base64,' + b64,
          w: TARGET_WIDTH,
          h: TARGET_HEIGHT,
        }
      );
      fs.writeFileSync(path.join(outDir, entry.destFileName), Buffer.from(outB64, 'base64'));
    }
  } finally {
    await context.close();
  }
}

export async function syncPwaManifestScreenshots(
  browser: Browser,
  repoRoot: string
): Promise<void> {
  await writeDownscaledGroup(
    browser,
    repoRoot,
    'apps/WebSoundMeter/public/screenshots',
    WSM_MANIFEST_SCREENSHOTS
  );
  await writeDownscaledGroup(
    browser,
    repoRoot,
    'apps/WebSpeakerSim/public/screenshots',
    WSS_MANIFEST_SCREENSHOTS
  );
}
