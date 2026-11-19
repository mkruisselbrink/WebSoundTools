// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 5 WebSoundMeter user-guide screenshots (`apps/WebSoundMeter/docs/images/01..05*.png`)
 * plus the Predict-to-Measure `.FRD` import & overlay screenshot (`docs/images/02-wsm-import-and-compare-frd.png`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRetinaPage, sleep } from './generate-screenshots.mjs';

export async function captureWsmGuideScenes({ browser, wsmUrl, repoRoot, exportedFrdPath }) {
  const wsmOutDir = path.join(repoRoot, 'apps/WebSoundMeter/docs/images');
  const rootImagesDir = path.join(repoRoot, 'docs/images');
  fs.mkdirSync(wsmOutDir, { recursive: true });
  fs.mkdirSync(rootImagesDir, { recursive: true });

  console.log('Capturing WebSoundMeter guide & cross-app import screenshots...');

  // 01..04 — Tuning Mode Alignment, Capture, Virtual EQ, and Multi-Mic Spatial Average
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(1200);

    // 01: Tuning Workspace Overview (unaligned 8.50 ms delay visible in impulse & wrapped phase)
    await page.screenshot({ path: path.join(wsmOutDir, '01-tuning-workspace-overview.png') });

    // 02: Lock Delay (8.50 ms) + Capture Stored Trace ("FOH Center Baseline")
    await page.getByTestId('btn-apply-delay').click();
    await sleep(900);
    await page.getByTestId('btn-capture-trace').click();
    await sleep(300);
    const storedNameInput = page.getByLabel('Stored Trace Name');
    await storedNameInput.fill('FOH Center Baseline');
    await storedNameInput.dispatchEvent('change');
    await sleep(400);
    await page.screenshot({ path: path.join(wsmOutDir, '02-delay-alignment-and-capture.png') });

    // 03: Switch to Transfer Function 2x, Add Virtual EQ, Auto-Match Room + LR24 HPF @ 80 Hz
    await page.getByTestId('select-layout').selectOption('tf-dual');
    await sleep(300);
    await page.getByTestId('btn-add-eq').click();
    await sleep(300);
    await page.getByTestId('btn-auto-flatten-eq').click();
    await sleep(300);
    const eqInspector = page.getByTestId('inspector-eq-source');
    const hpfSelect = eqInspector.locator('select').nth(1);
    await hpfSelect.selectOption('linkwitz-riley-24');
    await sleep(600);
    await page.screenshot({ path: path.join(wsmOutDir, '03-virtual-eq-and-crossovers.png') });

    // 04: Add 2nd Live Mic ("House Left Mid", Floor Bounce Comb) + Math Union (Power Average)
    await page.getByTestId('btn-add-meas').click();
    await sleep(300);
    const slotName = page.getByTestId('input-live-slot-name');
    await slotName.fill('House Left Mid');
    await slotName.dispatchEvent('change');
    await page.getByTestId('select-live-slot-preset').selectOption('comb-filtering');
    await sleep(900);
    await page.getByTestId('btn-apply-delay').click();
    await sleep(600);

    await page.getByTestId('btn-add-union').click();
    await sleep(300);
    const unionCard = page.getByTestId('inspector-union-source');
    await unionCard.getByLabel('Union Math Operation').selectOption('power-avg');
    const srcBSelect = unionCard.getByLabel('Union Source B');
    const optsB = await srcBSelect.locator('option').evaluateAll((els) =>
      els.map((el) => ({ value: el.value, text: el.textContent?.trim() ?? '' }))
    );
    const houseLeftOpt = optsB.find((o) => /House Left/i.test(o.text));
    if (houseLeftOpt) {
      await srcBSelect.selectOption(houseLeftOpt.value);
    }
    await sleep(700);
    await page.screenshot({ path: path.join(wsmOutDir, '04-multi-mic-spatial-average.png') });

    await context.close();
  }

  // 05 — Live Show Mode SPL History & Feedback Callout Flags
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(900);

    await page.getByTestId('btn-mode-show').click();
    await sleep(400);
    await page.getByTestId('btn-show-add-meas').click();
    await sleep(300);
    const simPresets = page.locator('[data-testid^="select-show-sim-preset-"]');
    await simPresets.nth(0).selectOption('feedback-ring-demo');
    await simPresets.nth(1).selectOption('comb-filtering');
    await sleep(2200);
    await page.screenshot({ path: path.join(wsmOutDir, '05-live-show-spl-and-feedback.png') });

    await context.close();
  }

  // Cross-App 02 — Import Predicted .FRD & Compare Against Live FOH Measurement
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(900);

    await page.getByTestId('select-layout').selectOption('tf-dual');
    await page.getByTestId('btn-apply-delay').click();
    await sleep(700);
    await page.getByTestId('input-import-frd').setInputFiles(exportedFrdPath);
    await sleep(700);
    await page.screenshot({
      path: path.join(rootImagesDir, '02-wsm-import-and-compare-frd.png'),
    });

    await context.close();
  }
}

