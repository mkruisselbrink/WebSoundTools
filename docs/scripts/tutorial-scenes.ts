// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 8 step-by-step FOH tutorial screenshots (`docs/tutorials/images/t01..t05*.png`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { WsmPageDriver } from '../../apps/WebSoundMeter/tests/e2e/wsm-page-driver.ts';
import { WssPageDriver } from '../../apps/WebSpeakerSim/tests/e2e/wss-page-driver.ts';
import { createRetinaPage, sleep } from './generate-screenshots.ts';

export interface CaptureTutorialParams {
  readonly browser: Browser;
  readonly wsmUrl: string;
  readonly wssUrl: string;
  readonly repoRoot: string;
  readonly exportedFrdPath: string;
}

const SAMPLE_MIC_CALIBRATION = [
  '* Measurement Mic Calibration — Serial #8412 (94.0 dB @ 1 kHz)',
  '20.0 -1.80 18.0',
  '31.5 -0.75 9.2',
  '63.0 -0.20 3.5',
  '125.0 -0.05 1.2',
  '250.0 0.00 0.4',
  '500.0 0.00 0.0',
  '1000.0 0.00 0.0',
  '2000.0 0.15 -0.8',
  '4000.0 0.45 -2.1',
  '8000.0 1.25 -5.4',
  '12000.0 1.85 -9.0',
  '16000.0 0.90 -14.2',
  '20000.0 -1.40 -21.0',
].join('\n');

export async function captureTutorialScenes({
  browser,
  wsmUrl,
  wssUrl,
  repoRoot,
  exportedFrdPath,
}: CaptureTutorialParams): Promise<void> {
  const outDir = path.join(repoRoot, 'docs/tutorials/images');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Capturing 8 step-by-step FOH tutorial screenshots...');

  // 1. Tutorial 01 — Hardware Routing & Mic Calibration Curve
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface();
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await sleep(550);
    await wsm.toggleAdvancedMeasurementSettings();
    await sleep(350);
    await page.screenshot({
      path: path.join(outDir, 't01-01-hardware-routing-and-generator.png'),
    });

    await wsm.uploadCalibrationText('M30-Serial-8412.cal', SAMPLE_MIC_CALIBRATION);
    await sleep(550);
    await page.screenshot({
      path: path.join(outDir, 't01-02-mic-calibration-loaded.png'),
    });

    await context.close();
  }

  // 2. Tutorial 02 — WebSpeakerSim DSP Group EQ Handles
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectFirstDspGroup();
    await wss.addEqBand();
    await sleep(600);
    await page.screenshot({
      path: path.join(outDir, 't02-01-wss-dsp-group-eq-handles.png'),
    });

    await context.close();
  }

  // 3. Tutorial 03 — Unaligned Phase Wrap, Sub+Top Crossover Notch & Coherence Masking Modes
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('pa-triple');
    await wsm.selectLiveSlotPreset('flat-delayed');
    await wsm.setReferenceDelayMs(0);
    await sleep(1000);
    await page.screenshot({
      path: path.join(outDir, 't03-01-unaligned-wrapped-phase.png'),
    });

    await wsm.selectLiveSlotPreset('sub-top-misaligned');
    await sleep(850);
    await wsm.applyAutoDelay();
    await sleep(1000);
    await page.screenshot({
      path: path.join(outDir, 't03-02-sub-top-crossover-notch.png'),
    });

    // Noisy Venue: Magnitude on Alpha Fade (>= 35%), Phase on Hard Cutoff (>= 50%), Panel 3 on Coherence
    await wsm.selectLiveSlotPreset('noisy-crowd');
    await sleep(850);
    await wsm.applyAutoDelay();
    await wsm.setChartCoherence(1, 'cutoff', 0.5);
    await wsm.setChartPlotType(2, 'coherence');
    await sleep(1100);
    await page.screenshot({
      path: path.join(outDir, 't03-03-noisy-venue-coherence-blanking.png'),
    });

    await context.close();
  }

  // 4. Tutorial 04 — Measured Minus Predicted dB Difference Curve
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('tf-dual');
    await wsm.selectLiveSlotPreset('pa-room-modes');
    await sleep(850);
    await wsm.applyAutoDelay();
    await sleep(750);
    await wsm.captureStoredTrace();
    await sleep(300);

    await wsm.importFrdFile(exportedFrdPath);
    await sleep(550);

    await wsm.addMathUnion({
      operation: 'diff-db',
      sourceAPattern: /^(?!.*predicted).*(Capture|Live)/i,
      sourceBPattern: /predicted|foh/i,
    });
    await sleep(750);
    await page.screenshot({
      path: path.join(outDir, 't04-01-measured-minus-predicted-diff.png'),
    });

    await context.close();
  }

  // 5. Tutorial 05 — Live Show Multi-Mic SPL Warning + Feedback Ring Log
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.setMode('show');
    await wsm.addShowLiveMic();
    await wsm.selectShowSlotPreset(0, 'feedback-ring-demo');
    await wsm.setShowSplThresholds(72, 84);
    await sleep(2200);
    await page.screenshot({
      path: path.join(outDir, 't05-01-show-spl-compliance-warn.png'),
    });

    await context.close();
  }
}

