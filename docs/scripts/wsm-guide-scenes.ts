// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 6 WebSoundMeter reference screenshots (`apps/WebSoundMeter/docs/images/01..06*.png`)
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

  console.log('Capturing WebSoundMeter reference & cross-app import screenshots...');

  // 01..04 & 06 — Tuning Mode Alignment, Capture, Virtual EQ, N-Input Spatial Average & Advanced Settings
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();
    await sleep(750);

    // 01: Tuning Workspace Overview (unaligned 8.50 ms delay + live dBFS meters)
    await page.screenshot({ path: path.join(wsmOutDir, '01-tuning-workspace-overview.png') });

    // 06: Cropped Right Inspector showing expanded Advanced Settings (FFT, Window, Smoothing, Estimator, Filter)
    await wsm.toggleAdvancedMeasurementSettings();
    await sleep(250);
    await page.screenshot({
      path: path.join(wsmOutDir, '06-advanced-measurement-settings.png'),
      clip: { x: 1096, y: 52, width: 344, height: 848 },
    });
    await wsm.toggleAdvancedMeasurementSettings();

    // 02: Lock Delay (8.50 ms) + Capture Stored Trace ("FOH Center Baseline")
    await wsm.applyAutoDelay();
    await sleep(800);
    await wsm.captureStoredTrace('FOH Center Baseline');
    await sleep(350);
    await page.screenshot({ path: path.join(wsmOutDir, '02-delay-alignment-and-capture.png') });

    // 03: Switch to Transfer Function 2x, Add Virtual EQ + target-aware Auto-Match Room (no steep HPF clipping bottom)
    await wsm.selectLayout('tf-dual');
    await wsm.addVirtualEq({ autoFlatten: true });
    await sleep(650);
    await page.screenshot({ path: path.join(wsmOutDir, '03-virtual-eq-and-crossovers.png') });

    // 04: Hide Virtual EQ clutter, add 2nd & 3rd Live Mics, and combine all 3 in N-input Power Average checklist
    await wsm.setSourceVisibilityByName('Virtual EQ #1', false);
    await wsm.addLiveMeasurement('House Left Mid');
    await wsm.selectLiveSlotPreset('comb-filtering');
    await sleep(700);
    await wsm.applyAutoDelay();

    await wsm.addLiveMeasurement('Balcony Lip');
    await wsm.selectLiveSlotPreset('flat-delayed');
    await sleep(700);
    await wsm.applyAutoDelay();
    await sleep(450);

    await wsm.addMathUnion({
      operation: 'power-avg',
      sourcePatterns: [/Live Measurement/i, /House Left Mid/i, /Balcony Lip/i],
    });
    await sleep(600);
    await page.screenshot({ path: path.join(wsmOutDir, '04-multi-mic-spatial-average.png') });

    await context.close();
  }

  // 05 — Live Show Mode (Hardware Mode: Generator safety hidden + Seeded 15m SPL History + Feedback Callouts)
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface('usb-4ch-interface', 'Focusrite Scarlett 4i4 USB (4ch)', {
      withFeedbackRings: true,
    });
    await wsm.installSeededShowSplHistory({
      slotIds: ['live-measurement'],
      baseSplDbA: 94.8,
    });
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await sleep(450);
    await wsm.setMode('show');
    await wsm.setShowSplThresholds(95, 98);
    await sleep(2200);
    await page.screenshot({ path: path.join(wsmOutDir, '05-live-show-spl-and-feedback.png') });

    await context.close();
  }

  // Cross-App 02 — Import Predicted .FRD & Compare Against Smoothed Live FOH Measurement
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('tf-dual');
    await wsm.setOctaveSmoothing('1/3');
    await wsm.applyAutoDelay();
    await sleep(700);
    await wsm.importFrdFile(exportedFrdPath);
    await sleep(650);
    await page.screenshot({
      path: path.join(rootImagesDir, '02-wsm-import-and-compare-frd.png'),
    });

    await context.close();
  }
}
