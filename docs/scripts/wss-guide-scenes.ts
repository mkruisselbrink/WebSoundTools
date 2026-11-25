// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 9 WebSpeakerSim reference screenshots (`apps/WebSpeakerSim/docs/images/01..09*.png`)
 * plus the Predict-to-Measure `.FRD` export scene (`docs/images/01-wss-export-predicted-frd.png`)
 * using Markdown-defined `[data-doc-region]` crops and zero `sleep()` timers.
 */

import path from 'node:path';
import type { Browser } from '@playwright/test';
import { WssPageDriver } from '../../apps/WebSpeakerSim/tests/e2e/wss-page-driver.ts';
import { createRetinaPage, type SceneCapturer } from './session-helpers.ts';

export const WSS_GUIDE_SCENE_IDS = [
  'wss-guide-01-workspace-overview',
  'wss-guide-02-mains-4khz-gap',
  'wss-guide-03-frontfills-histogram',
  'wss-guide-04-subs-broadside-63hz',
  'wss-guide-05-subs-cardioid-63hz',
  'wss-guide-06-virtual-mic-alignment',
  'wss-guide-07-speaker-spec-builder',
  'wss-guide-08-zone-and-env-inspectors',
  'wss-guide-09-speaker-file-import',
  't04-wss-export-predicted-frd',
] as const;

export interface CaptureWssGuideParams {
  readonly browser: Browser;
  readonly wssUrl: string;
  readonly tmpDir: string;
  readonly capturer: SceneCapturer;
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
  tmpDir,
  capturer,
}: CaptureWssGuideParams): Promise<{ readonly exportedFrdPath: string }> {
  console.log('Capturing WebSpeakerSim reference & cross-app export screenshots...');

  // 01..05 — Live Club venue workflow
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectPointSource('ps-main-l');
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-01-workspace-overview', page);

    await wss.togglePointSourceMute('ps-fill-l');
    await wss.selectBand('hz-4000');
    await wss.setIsolineStep(0);
    await wss.toggleSteppedColormap();
    await wss.selectPointSource('ps-main-l');
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-02-mains-4khz-gap', page);

    await wss.togglePointSourceMute('ps-fill-l');
    await wss.toggleSteppedColormap();
    await wss.selectBand('pink-A');
    await wss.setColormapRange('auto-12');
    await wss.setIsolineStep(2);
    await wss.selectChartTab('histogram');
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-03-frontfills-histogram', page);

    await wss.setColormapRange('auto-36');
    await wss.setIsolineStep(3);
    await wss.selectChartTab('magnitude');
    await wss.selectBand('hz-63');
    await wss.selectSubArray('sa-center-cardioid');
    await wss.setSubArrayMode('broadside');
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-04-subs-broadside-63hz', page);

    await wss.setSubArrayMode('cardioid-csa');
    await wss.applyQuarterWaveSpacing();
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-05-subs-cardioid-63hz', page);

    await context.close();
  }

  // 06..09 — Raked Auditorium Alignment, Zone/Environment Inspectors, Spec Builder & Import Modal
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
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-06-virtual-mic-alignment', page);

    await wss.selectEnvironment();
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-08-zone-and-env-inspectors', page);

    await wss.openSpeakerLibraryModal();
    await wss.byTestId('tab-spec-builder').click();
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-07-speaker-spec-builder', page);

    await wss.byTestId('tab-import-file').click();
    await wss.byTestId('speaker-file-input').setInputFiles({
      name: 'touring-90x40.clf',
      mimeType: 'text/plain',
      buffer: Buffer.from(SAMPLE_CLF_TEXT, 'utf8'),
    });
    await wss.waitForUiSettled();
    await capturer.capture('wss-guide-09-speaker-file-import', page);

    await context.close();
  }

  // Cross-App 01 — Virtual Mic Predicted Level & Export .FRD + Magnitude Plot
  const exportedFrdPath = path.join(tmpDir, 'foh-mix-position-predicted.frd');
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectVirtualMic('mic-foh');
    await wss.byTestId('btn-ground-bounce').click();
    await wss.waitForUiSettled();
    await wss.exportVirtualMicFrd(exportedFrdPath);
    await wss.dismissToast();
    await wss.waitForUiSettled();
    await capturer.capture('t04-wss-export-predicted-frd', page);

    await context.close();
  }

  return { exportedFrdPath };
}
