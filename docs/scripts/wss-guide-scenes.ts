// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 9 WebSpeakerSim reference screenshots (`apps/WebSpeakerSim/docs/images/01..09*.png`)
 * plus the Predict-to-Measure `.FRD` export crop (`docs/images/01-wss-export-predicted-frd.png`).
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

const SAMPLE_CLF_TEXT = [
  '<CABINET> Touring 90x40 Constant-Directivity Horn',
  '<MANUFACTURER> Studio Acoustic Labs',
  '<SENSITIVITY> 99 100 100',
  '<MAXSPL> 134',
  '<FREQ> 500 2000 8000',
  '<HORIZONTAL>',
  '0 0 0 0',
  '45 -6 -6 -7',
  '90 -18 -20 -22',
  '<VERTICAL>',
  '0 0 0 0',
  '20 -6 -6 -7',
  '90 -20 -22 -24',
  '<END>',
].join('\n');

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

  console.log('Capturing WebSpeakerSim reference & cross-app export screenshots...');

  // 01..05 — Live Club venue workflow
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);
    await sleep(450);

    // 01: Workspace Overview (Main L selected)
    await wss.selectPointSource('ps-main-l');
    await sleep(300);
    await page.screenshot({ path: path.join(wssOutDir, '01-workspace-overview.png') });

    // 02: 4 kHz Single Band with Front Fill muted, Contours Off + Stepped ON so center gap pops cleanly
    await wss.togglePointSourceMute('ps-fill-l');
    await wss.selectBand('hz-4000');
    await wss.setIsolineStep(0);
    await wss.toggleSteppedColormap();
    await wss.selectPointSource('ps-main-l');
    await sleep(650);
    const metrics4kMuted = await wss.byTestId('coverage-metrics').textContent();
    console.log('  [WSS 4 kHz Mains Only]:', metrics4kMuted?.trim());
    await page.screenshot({ path: path.join(wssOutDir, '02-mains-4khz-gap.png') });

    // Log 4 kHz with Front Fill unmuted for like-with-like tutorial comparison
    await wss.togglePointSourceMute('ps-fill-l');
    await sleep(650);
    const metrics4kWithFills = await wss.byTestId('coverage-metrics').textContent();
    console.log('  [WSS 4 kHz Mains + Front Fills]:', metrics4kWithFills?.trim());

    // 03: Broadband Pink dBA, Auto ±6 dB, 2 dB contours, smooth gradient, SPL Histogram tab
    await wss.toggleSteppedColormap();
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

  // 06..09 — Raked Auditorium Alignment, Cropped Spec Builder, Zone/Environment Inspectors, and Import Modal
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
    await wss.dismissToast();
    await sleep(650);
    await page.screenshot({ path: path.join(wssOutDir, '06-virtual-mic-time-alignment.png') });

    // 08: Cropped Right Dock + Side Section showing Raked Balcony Zone & Editable Venue Grid Bounds
    await wss.selectEnvironment();
    await sleep(300);
    await page.screenshot({
      path: path.join(wssOutDir, '08-zone-and-environment-inspectors.png'),
      clip: { x: 480, y: 66, width: 960, height: 834 },
    });

    // 07: Cropped Speaker Library Datasheet Spec Builder Modal
    await wss.openSpeakerLibraryModal();
    await wss.byTestId('tab-spec-builder').click();
    await sleep(250);
    await wss.byTestId('speaker-library-modal').screenshot({
      path: path.join(wssOutDir, '07-speaker-library-spec-builder.png'),
    });

    // 09: Cropped Speaker Library Import Tab (.gll / .clf / .frd) with imported polar speaker
    await wss.byTestId('tab-import-file').click();
    await wss.byTestId('speaker-file-input').setInputFiles({
      name: 'touring-90x40.clf',
      mimeType: 'text/plain',
      buffer: Buffer.from(SAMPLE_CLF_TEXT, 'utf8'),
    });
    await sleep(300);
    await wss.byTestId('speaker-library-modal').screenshot({
      path: path.join(wssOutDir, '09-projects-and-speaker-import.png'),
    });

    await context.close();
  }

  // Cross-App 01 — Cropped Virtual Mic Predicted Level & Export .FRD + Magnitude Plot
  const exportedFrdPath = path.join(tmpDir, 'foh-mix-position-predicted.frd');
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectVirtualMic('mic-foh');
    // Export direct-field loudspeaker target (Ground Bounce off) so field comparison isolates venue boundary loading cleanly
    await wss.byTestId('btn-ground-bounce').click();
    await sleep(350);
    await wss.exportVirtualMicFrd(exportedFrdPath);
    await wss.dismissToast();
    await sleep(250);
    await page.screenshot({
      path: path.join(rootImagesDir, '01-wss-export-predicted-frd.png'),
      clip: { x: 420, y: 290, width: 1020, height: 610 },
    });

    await context.close();
  }

  return { exportedFrdPath };
}
