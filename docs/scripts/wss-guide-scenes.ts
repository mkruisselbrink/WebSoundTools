// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 7 WebSpeakerSim user-guide screenshots (`apps/WebSpeakerSim/docs/images/01..07*.png`)
 * plus the Predict-to-Measure `.FRD` export screenshot (`docs/images/01-wss-export-predicted-frd.png`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { WssPageDriver } from '../../apps/WebSpeakerSim/tests/e2e/wss-page-driver.ts';
import { createRetinaPage, sleep } from './generate-screenshots.ts';

export interface CaptureWssGuideParams {
  readonly browser: Browser;
  readonly wssUrl: string;
  readonly repoRoot: string;
  readonly tmpDir: string;
}

export async function captureWssGuideScenes({
  browser,
  wssUrl,
  repoRoot,
  tmpDir,
}: CaptureWssGuideParams): Promise<{ readonly exportedFrdPath: string }> {
  const wssOutDir = path.join(repoRoot, 'apps/WebSpeakerSim/docs/images');
  const rootImagesDir = path.join(repoRoot, 'docs/images');
  fs.mkdirSync(wssOutDir, { recursive: true });
  fs.mkdirSync(rootImagesDir, { recursive: true });

  console.log('Capturing WebSpeakerSim guide & cross-app export screenshots...');

  // 01..05 — Live Club venue workflow
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);
    await sleep(400);

    // 01: Workspace Overview (Main L selected)
    await wss.selectPointSource('ps-main-l');
    await sleep(300);
    await page.screenshot({ path: path.join(wssOutDir, '01-workspace-overview.png') });

    // 02: 4 kHz Single Band with Front Fill muted highlighting front-row center gap
    await wss.togglePointSourceMute('ps-fill-l');
    await wss.selectBand('hz-4000');
    await wss.selectPointSource('ps-main-l');
    await sleep(600);
    await page.screenshot({ path: path.join(wssOutDir, '02-mains-4khz-gap.png') });

    // 03: Unmute Front Fill, Broadband Pink dBA, Auto ±6 dB, 2 dB contours, SPL Histogram tab
    await wss.togglePointSourceMute('ps-fill-l');
    await wss.selectBand('pink-A');
    await wss.setColormapRange('auto-12');
    await wss.setIsolineStep(2);
    await wss.selectChartTab('histogram');
    await sleep(800);
    await page.screenshot({
      path: path.join(wssOutDir, '03-frontfills-coverage-histogram.png'),
    });

    // Reset scale/contours/tab for sub-array comparison
    await wss.setColormapRange('auto-36');
    await wss.setIsolineStep(3);
    await wss.selectChartTab('magnitude');
    await wss.selectBand('hz-63');
    await wss.selectSubArray('sa-center-cardioid');

    // 04: Omnidirectional Broadside Sub Array @ 63 Hz
    await wss.setSubArrayMode('broadside');
    await sleep(700);
    await page.screenshot({ path: path.join(wssOutDir, '04-subs-broadside-63hz.png') });

    // 05: Cardioid Stack (CSA) @ 63 Hz with quarter-wave spacing
    await wss.setSubArrayMode('cardioid-csa');
    await wss.applyQuarterWaveSpacing();
    await sleep(700);
    await page.screenshot({ path: path.join(wssOutDir, '05-subs-cardioid-63hz.png') });

    await context.close();
  }

  // 06 & 07 — Raked Auditorium & Balcony Auto Time-Alignment + Spec Builder Modal
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectVenuePreset('theater-raked-balcony');
    await wss.selectVirtualMic('mic-balcony');
    await wss.selectChartTab('phase');
    await wss.applyAutoTimeAlignment({
      referenceGroupId: 'grp-proscenium',
      targetGroupId: 'grp-balcony-fills',
    });
    await sleep(700);
    await page.screenshot({ path: path.join(wssOutDir, '06-virtual-mic-time-alignment.png') });

    // 07: Speaker Library Datasheet Spec Builder Modal
    await wss.openSpeakerLibraryModal();
    await page.getByTestId('tab-spec-builder').click();
    await sleep(250);
    await page.screenshot({
      path: path.join(wssOutDir, '07-speaker-library-spec-builder.png'),
    });

    await context.close();
  }

  // Cross-App 01 — Export Predicted .FRD from FOH Mix Position
  const exportedFrdPath = path.join(tmpDir, 'foh-mix-position-predicted.frd');
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectVirtualMic('mic-foh');
    await sleep(250);
    await wss.exportVirtualMicFrd(exportedFrdPath);
    await sleep(250);
    await page.screenshot({
      path: path.join(rootImagesDir, '01-wss-export-predicted-frd.png'),
    });

    await context.close();
  }

  return { exportedFrdPath };
}

