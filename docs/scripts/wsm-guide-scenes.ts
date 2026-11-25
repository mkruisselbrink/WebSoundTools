// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 8 WebSoundMeter reference screenshots (`apps/WebSoundMeter/docs/images/01..08*.png`)
 * plus the Predict-to-Measure `.FRD` import & overlay scene (`docs/images/02-wsm-import-and-compare-frd.png`)
 * using Markdown-defined `[data-doc-region]` crops and deterministic DSP frame gates.
 */

import type { Browser } from '@playwright/test';
import { WsmPageDriver } from '../../apps/WebSoundMeter/tests/e2e/wsm-page-driver.ts';
import {
  createRetinaPage,
  createTouchRetinaPage,
  type SceneCapturer,
} from './session-helpers.ts';

export const WSM_GUIDE_SCENE_IDS = [
  'wsm-guide-01-tuning-overview',
  'wsm-guide-02-delay-and-capture',
  'wsm-guide-03-virtual-eq-crossovers',
  'wsm-guide-04-multi-mic-spatial-avg',
  'wsm-guide-05-live-show-spl-feedback',
  'wsm-guide-06-advanced-meas-settings',
  'wsm-guide-07-mobile-show-handheld',
  'wsm-guide-08-tablet-portrait-show',
  't04-wsm-import-and-compare-frd',
] as const;

export interface CaptureWsmGuideParams {
  readonly browser: Browser;
  readonly wsmUrl: string;
  readonly exportedFrdPath: string;
  readonly capturer: SceneCapturer;
}

export async function captureWsmGuideScenes({
  browser,
  wsmUrl,
  exportedFrdPath,
  capturer,
}: CaptureWsmGuideParams): Promise<void> {
  console.log('Capturing WebSoundMeter reference & cross-app import screenshots...');

  // 01..04 & 06 — Tuning Mode Alignment, Capture, Virtual EQ, Spatial Average & Advanced Settings
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();
    await wsm.waitForFrames(10);

    await capturer.capture('wsm-guide-01-tuning-overview', page);

    await wsm.toggleAdvancedMeasurementSettings();
    await wsm.waitForUiSettled();
    await capturer.capture('wsm-guide-06-advanced-meas-settings', page);
    await wsm.toggleAdvancedMeasurementSettings();

    await wsm.applyAutoDelay();
    await wsm.waitForFrames(12);
    await wsm.captureStoredTrace('FOH Center Baseline');
    await wsm.waitForUiSettled();
    await capturer.capture('wsm-guide-02-delay-and-capture', page);

    await wsm.selectLayout('tf-dual');
    await wsm.addVirtualEq({ autoFlatten: true });
    await wsm.waitForFrames(8);
    await capturer.capture('wsm-guide-03-virtual-eq-crossovers', page);

    await wsm.setSourceVisibilityByName('Virtual EQ #1', false);
    await wsm.addLiveMeasurement('House Left Mid');
    await wsm.selectLiveSlotPreset('comb-filtering');
    await wsm.waitForFrames(10);
    await wsm.applyAutoDelay();

    await wsm.addLiveMeasurement('Balcony Lip');
    await wsm.selectLiveSlotPreset('flat-delayed');
    await wsm.waitForFrames(10);
    await wsm.applyAutoDelay();
    await wsm.waitForFrames(6);

    await wsm.addMathUnion({
      operation: 'power-avg',
      sourcePatterns: [/Live Measurement/i, /House Left Mid/i, /Balcony Lip/i],
    });
    await wsm.waitForFrames(8);
    await capturer.capture('wsm-guide-04-multi-mic-spatial-avg', page);

    await context.close();
  }

  // 05 — Desktop Live Show Mode (Hardware Mode: Generator safety hidden + Seeded 15m SPL + Feedback Callouts)
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface(
      'usb-4ch-interface',
      'Focusrite Scarlett 4i4 USB (4ch)',
      { withFeedbackRings: true }
    );
    await wsm.installSeededShowSplHistory({
      slotIds: ['live-measurement'],
      baseSplDbA: 94.8,
    });
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await wsm.setMode('show');
    await wsm.setShowSplThresholds(95, 98);
    await wsm.waitForFeedbackRing(1);
    await wsm.waitForFrames(10);
    await capturer.capture('wsm-guide-05-live-show-spl-feedback', page);

    await context.close();
  }

  // 07 — Handheld Phone Live Show Deck (390×844 @ 2x DPR)
  {
    const { context, page } = await createTouchRetinaPage(browser, 390, 844);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface(
      'usb-4ch-interface',
      'Focusrite Scarlett 4i4 USB (4ch)',
      { withFeedbackRings: true }
    );
    await wsm.installSeededShowSplHistory({
      slotIds: ['live-measurement'],
      baseSplDbA: 94.8,
    });
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await wsm.setMode('show');
    await wsm.app.getByTestId('mobile-tab-mics').click();
    await wsm.setShowSplThresholds(95, 98);
    await wsm.app.getByTestId('mobile-tab-rta').click();
    await wsm.waitForFeedbackRing(1);
    await wsm.waitForFrames(8);
    await capturer.capture('wsm-guide-07-mobile-show-handheld', page);

    await context.close();
  }

  // 08 — Tablet Portrait Live Show Split-Deck (820×1180 @ 2x DPR)
  {
    const { context, page } = await createTouchRetinaPage(browser, 820, 1180);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface(
      'usb-4ch-interface',
      'Focusrite Scarlett 4i4 USB (4ch)',
      { withFeedbackRings: true }
    );
    await wsm.installSeededShowSplHistory({
      slotIds: ['live-measurement'],
      baseSplDbA: 94.8,
    });
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await wsm.setMode('show');
    await wsm.setShowSplThresholds(95, 98);
    await wsm.waitForFeedbackRing(1);
    await wsm.waitForFrames(8);
    await capturer.capture('wsm-guide-08-tablet-portrait-show', page);

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
    await wsm.waitForFrames(10);
    await wsm.importFrdFile(exportedFrdPath);
    await wsm.waitForFrames(6);
    await capturer.capture('t04-wsm-import-and-compare-frd', page);

    await context.close();
  }
}
