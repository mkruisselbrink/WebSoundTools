// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 7 WebSpeakerSim user-guide screenshots (`apps/WebSpeakerSim/docs/images/01..07*.png`)
 * plus the Predict-to-Measure `.FRD` export screenshot (`docs/images/01-wss-export-predicted-frd.png`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRetinaPage, sleep } from './generate-screenshots.mjs';

export async function captureWssGuideScenes({ browser, wssUrl, repoRoot, tmpDir }) {
  const wssOutDir = path.join(repoRoot, 'apps/WebSpeakerSim/docs/images');
  const rootImagesDir = path.join(repoRoot, 'docs/images');
  fs.mkdirSync(wssOutDir, { recursive: true });
  fs.mkdirSync(rootImagesDir, { recursive: true });

  console.log('Capturing WebSpeakerSim guide & cross-app export screenshots...');

  // 01..05 — Live Club venue workflow
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wssUrl, { waitUntil: 'networkidle' });
    await sleep(1100);

    // 01: Workspace Overview (Main L selected)
    await page.getByTestId('tree-ps-ps-main-l').click();
    await sleep(400);
    await page.screenshot({ path: path.join(wssOutDir, '01-workspace-overview.png') });

    // 02: 4 kHz Single Band with Front Fill muted highlighting front-row center gap
    const fillRow = page.getByTestId('tree-ps-ps-fill-l');
    await fillRow.locator('button').click();
    await page.getByTestId('band-select').selectOption('hz-4000');
    await page.getByTestId('tree-ps-ps-main-l').click();
    await sleep(700);
    await page.screenshot({ path: path.join(wssOutDir, '02-mains-4khz-gap.png') });

    // 03: Unmute Front Fill, Broadband Pink dBA, Auto ±6 dB, 2 dB contours, SPL Histogram tab
    await fillRow.locator('button').click();
    await page.getByTestId('band-select').selectOption('pink-A');
    await page.getByTestId('colormap-range-select').selectOption('auto-12');
    await page.getByTestId('isoline-select').selectOption('2');
    await page.locator('wss-chart-panel').getByRole('button', { name: /Histogram/i }).click();
    await sleep(900);
    await page.screenshot({
      path: path.join(wssOutDir, '03-frontfills-coverage-histogram.png'),
    });

    // Reset scale/contours/tab for sub-array comparison
    await page.getByTestId('colormap-range-select').selectOption('auto-36');
    await page.getByTestId('isoline-select').selectOption('3');
    await page.locator('wss-chart-panel').getByRole('button', { name: /Magnitude/i }).click();
    await page.getByTestId('band-select').selectOption('hz-63');
    await page.getByTestId('tree-sa-sa-center-cardioid').click();

    // 04: Omnidirectional Broadside Sub Array @ 63 Hz
    await page.getByTestId('sa-mode-select').selectOption('broadside');
    await sleep(800);
    await page.screenshot({ path: path.join(wssOutDir, '04-subs-broadside-63hz.png') });

    // 05: Cardioid Stack (CSA) @ 63 Hz with quarter-wave spacing
    await page.getByTestId('sa-mode-select').selectOption('cardioid-csa');
    await page.getByTestId('btn-sa-quarter-wave').click();
    await sleep(800);
    await page.screenshot({ path: path.join(wssOutDir, '05-subs-cardioid-63hz.png') });

    await context.close();
  }

  // 06 & 07 — Raked Auditorium & Balcony Auto Time-Alignment + Spec Builder Modal
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wssUrl, { waitUntil: 'networkidle' });
    await sleep(900);

    await page.getByTestId('preset-select').selectOption('theater-raked-balcony');
    await sleep(1000);
    await page.getByTestId('tree-mic-mic-balcony').click();
    await page.locator('wss-chart-panel').getByRole('button', { name: /Phase/i }).click();
    await sleep(400);
    await page.getByTestId('align-ref-select').selectOption('grp-proscenium');
    await page.getByTestId('align-target-select').selectOption('grp-balcony-fills');
    await page.getByTestId('btn-apply-alignment').click();
    await sleep(800);
    await page.screenshot({ path: path.join(wssOutDir, '06-virtual-mic-time-alignment.png') });

    // 07: Speaker Library Datasheet Spec Builder Modal
    await page.getByTestId('btn-speaker-library').click();
    await sleep(250);
    await page.getByTestId('tab-spec-builder').click();
    await sleep(300);
    await page.screenshot({
      path: path.join(wssOutDir, '07-speaker-library-spec-builder.png'),
    });

    await context.close();
  }

  // Cross-App 01 — Export Predicted .FRD from FOH Mix Position
  const exportedFrdPath = path.join(tmpDir, 'foh-mix-position-predicted.frd');
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wssUrl, { waitUntil: 'networkidle' });
    await sleep(1000);

    await page.getByTestId('tree-mic-mic-foh').click();
    await sleep(350);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('btn-export-mic-frd').click(),
    ]);
    await download.saveAs(exportedFrdPath);
    await sleep(300);
    await page.screenshot({
      path: path.join(rootImagesDir, '01-wss-export-predicted-frd.png'),
    });

    await context.close();
  }

  return { exportedFrdPath };
}

