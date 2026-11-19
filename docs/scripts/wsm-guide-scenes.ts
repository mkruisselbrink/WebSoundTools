// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 5 WebSoundMeter user-guide screenshots (`apps/WebSoundMeter/docs/images/01..05*.png`)
 * plus the Predict-to-Measure `.FRD` import & overlay screenshot (`docs/images/02-wsm-import-and-compare-frd.png`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { WsmPageDriver } from '../../apps/WebSoundMeter/tests/e2e/wsm-page-driver.ts';
import { createRetinaPage, sleep } from './generate-screenshots.ts';

export interface CaptureWsmGuideParams {
  readonly browser: Browser;
  readonly wsmUrl: string;
  readonly repoRoot: string;
  readonly exportedFrdPath: string;
}

export async function captureWsmGuideScenes({
  browser,
  wsmUrl,
  repoRoot,
  exportedFrdPath,
}: CaptureWsmGuideParams): Promise<void> {
  const wsmOutDir = path.join(repoRoot, 'apps/WebSoundMeter/docs/images');
  const rootImagesDir = path.join(repoRoot, 'docs/images');
  fs.mkdirSync(wsmOutDir, { recursive: true });
  fs.mkdirSync(rootImagesDir, { recursive: true });

  console.log('Capturing WebSoundMeter guide & cross-app import screenshots...');

  // 01..04 — Tuning Mode Alignment, Capture, Virtual EQ, and Multi-Mic Spatial Average
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();
    await sleep(700);

    // 01: Tuning Workspace Overview (unaligned 8.50 ms delay visible in impulse & wrapped phase)
    await page.screenshot({ path: path.join(wsmOutDir, '01-tuning-workspace-overview.png') });

    // 02: Lock Delay (8.50 ms) + Capture Stored Trace ("FOH Center Baseline")
    await wsm.applyAutoDelay();
    await sleep(800);
    await wsm.captureStoredTrace('FOH Center Baseline');
    await sleep(350);
    await page.screenshot({ path: path.join(wsmOutDir, '02-delay-alignment-and-capture.png') });

    // 03: Switch to Transfer Function 2x, Add Virtual EQ, Auto-Match Room + LR24 HPF @ 80 Hz
    await wsm.selectLayout('tf-dual');
    await wsm.addVirtualEq({ autoFlatten: true, hpfTopology: 'linkwitz-riley-24' });
    await sleep(600);
    await page.screenshot({ path: path.join(wsmOutDir, '03-virtual-eq-and-crossovers.png') });

    // 04: Add 2nd Live Mic ("House Left Mid", Comb Filtering) + Math Union (Power Average)
    await wsm.addLiveMeasurement('House Left Mid');
    await wsm.selectLiveSlotPreset('comb-filtering');
    await sleep(800);
    await wsm.applyAutoDelay();
    await sleep(500);

    await wsm.addMathUnion({
      operation: 'power-avg',
      sourceBPattern: /House Left/i,
    });
    await sleep(600);
    await page.screenshot({ path: path.join(wsmOutDir, '04-multi-mic-spatial-average.png') });

    await context.close();
  }

  // 05 — Live Show Mode SPL History & Feedback Callout Flags
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.setMode('show');
    await wsm.addShowLiveMic();
    await wsm.selectShowSlotPreset(0, 'feedback-ring-demo');
    await wsm.selectShowSlotPreset(1, 'comb-filtering');
    await sleep(2200);
    await page.screenshot({ path: path.join(wsmOutDir, '05-live-show-spl-and-feedback.png') });

    await context.close();
  }

  // Cross-App 02 — Import Predicted .FRD & Compare Against Live FOH Measurement
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('tf-dual');
    await wsm.applyAutoDelay();
    await sleep(650);
    await wsm.importFrdFile(exportedFrdPath);
    await sleep(650);
    await page.screenshot({
      path: path.join(rootImagesDir, '02-wsm-import-and-compare-frd.png'),
    });

    await context.close();
  }
}

