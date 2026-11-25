// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 27 annotated step-by-step FOH tutorial screenshots across Tutorials 01–07
 * (`docs/tutorials/images/t01..t07*.png`) using Markdown-embedded `[data-doc-region]` crops,
 * Top-Layer SVG callouts, and deterministic DSP / worker readiness gates.
 */

import { expect, type Browser } from '@playwright/test';
import { WsmPageDriver } from '../../apps/WebSoundMeter/tests/e2e/wsm-page-driver.ts';
import { WssPageDriver } from '../../apps/WebSpeakerSim/tests/e2e/wss-page-driver.ts';
import {
  createRetinaPage,
  createTouchRetinaPage,
  type SceneCapturer,
} from './session-helpers.ts';

export const TUTORIAL_SCENE_IDS = [
  't01-01-hardware-routing',
  't01-02-mic-calibration-loaded',
  't01-03-io-popover-stop-release',
  't01-04-spl-calibrator-94db',
  't02-01-dsp-group-eq-handles',
  't02-02-club-mic-alignment',
  't02-03-csa-enclosure-schedule',
  't02-04-scene-file-save-popover',
  't02-05-main-aiming-and-heatmap',
  't03-01-unaligned-wrapped-phase',
  't03-02-sub-top-crossover-notch',
  't03-03-noisy-coherence-blanking',
  't03-04-impulse-etc-reflections',
  't03-05-aligned-phase-and-capture',
  't03-06-virtual-eq-room-match',
  't04-01-measured-minus-predicted',
  't04-02-stored-trace-offset',
  't05-01-show-spl-compliance-warn',
  't05-02-show-limit-and-ring-log',
  't05-03-handheld-phone-spl-trend',
  't05-04-handheld-phone-mics-cal',
  't05-05-mixer-input-watch-modal',
  't05-06-culprit-notch-eq-cheatsheet',
  't06-01-custom-raked-balcony-zones',
  't06-02-outdoor-endfire-delay-ring',
  't06-03-acoustic-ruler-delay-check',
  't06-04-venue-bounds-and-slice',
  't06-05-delay-ring-handoff-alignment',
  't07-01-hardware-resume-and-help',
] as const;

export interface CaptureTutorialParams {
  readonly browser: Browser;
  readonly wsmUrl: string;
  readonly wssUrl: string;
  readonly exportedFrdPath: string;
  readonly capturer: SceneCapturer;
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
  exportedFrdPath,
  capturer,
}: CaptureTutorialParams): Promise<void> {
  console.log('Capturing 27 annotated step-by-step FOH tutorial screenshots...');

  // 1. Tutorial 01 — Hardware Routing, IO Popover, Mic Calibration Upload & 94 dB SPL Calibrator
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface();
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await wsm.waitForFrames(6);
    await wsm.toggleGenerator();
    await wsm.waitForFrames(10);
    await wsm.applyAutoDelay();
    await wsm.waitForFrames(10);
    await capturer.capture('t01-01-hardware-routing', page);

    // t01-03: Open Audio Input & Reference Popover showing Loopback Ref, Auto-Release & Disconnect
    await wsm.byTestId('btn-io-popover').click();
    await expect(wsm.byTestId('select-ref-channel')).toBeVisible();
    await wsm.waitForUiSettled();
    await capturer.capture('t01-03-io-popover-stop-release', page);
    await wsm.byTestId('btn-io-popover').click();
    await wsm.waitForUiSettled();

    // t01-04: Open SPL Calibrator Popover (94 dB / 114 dB pistonphone match)
    await wsm.byTestId('btn-calibrate-spl').click();
    await expect(page.locator('[data-doc-region="cal-popover"]')).toBeVisible();
    await wsm.waitForUiSettled();
    await capturer.capture('t01-04-spl-calibrator-94db', page);
    await wsm.byTestId('btn-calibrate-spl').click();
    await wsm.waitForUiSettled();

    // t01-02: Mic Calibration Curve Uploaded & Selected in Advanced Settings
    await wsm.toggleAdvancedMeasurementSettings();
    await wsm.uploadCalibrationText('M30-Serial-8412.cal', SAMPLE_MIC_CALIBRATION);
    await wsm.waitForFrames(6);
    await wsm.app.locator('.sidebar').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await wsm.waitForUiSettled();
    await capturer.capture('t01-02-mic-calibration-loaded', page);

    await context.close();
  }

  // 2. Tutorial 02 — Scene File Save Popover, Main Aiming + Heatmap Popover, CSA Schedule, Mic Alignment & EQ Handles
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    // t02-04: Open Scene & Project File Popover (Cmd/Ctrl+S direct .json save, Open .json, Saved Projects)
    await wss.byTestId('btn-scene-popover').click();
    await expect(wss.byTestId('preset-select')).toBeVisible();
    await wss.waitForUiSettled();
    await capturer.capture('t02-04-scene-file-save-popover', page);
    await wss.byTestId('btn-scene-popover').click();
    await wss.waitForUiSettled();

    // t02-05: Main L Selected + SPL Heatmap & Contours Popover Open (Auto ±6 dB, 2 dB contours)
    await wss.selectPointSource('ps-main-l');
    await wss.setColormapRange('auto-12');
    await wss.setIsolineStep(2);
    await wss.byTestId('btn-heatmap-popover').click();
    await expect(wss.byTestId('colormap-range-select')).toBeVisible();
    await wss.waitForUiSettled();
    await capturer.capture('t02-05-main-aiming-and-heatmap', page);
    await wss.byTestId('btn-heatmap-popover').click();
    await wss.waitForUiSettled();

    // t02-03: CSA Subwoofer Array Designer + Generated Enclosure Schedule
    await wss.setColormapRange('auto-36');
    await wss.setIsolineStep(3);
    await wss.selectBand('hz-63');
    await wss.selectSubArray('sa-center-cardioid');
    await wss.setSubArrayMode('cardioid-csa');
    await wss.applyQuarterWaveSpacing();
    await wss.waitForUiSettled();
    await capturer.capture('t02-03-csa-enclosure-schedule', page);

    // t02-02: Live Club Virtual Mic Phase & Auto Time-Alignment
    await wss.selectBand('pink-A');
    await wss.setColormapRange('auto-21');
    await wss.selectVirtualMic('mic-foh');
    await wss.selectChartTab('phase');
    await wss.applyAutoTimeAlignment({
      referenceGroupId: 'grp-subs',
      targetGroupId: 'grp-mains',
    });
    await wss.dismissToast();
    await wss.waitForUiSettled();
    await capturer.capture('t02-02-club-mic-alignment', page);

    // t02-01: Chart + DSP Group Inspector with 3 interactive EQ handles
    await wss.selectChartTab('magnitude');
    await wss.selectFirstDspGroup();
    await wss.addEqBand();
    await wss.addEqBand();
    await wss.addEqBand();
    await wss.waitForUiSettled();
    await capturer.capture('t02-01-dsp-group-eq-handles', page);

    await context.close();
  }

  // 3. Tutorial 03 — Unaligned Phase, Locked Delay + Capture, Crossover Notch, Coherence, ETC & Virtual EQ Room Match
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('pa-triple');
    await wsm.selectLiveSlotPreset('flat-delayed');
    await wsm.setReferenceDelayMs(0);
    await wsm.waitForFrames(14);
    await capturer.capture('t03-01-unaligned-wrapped-phase', page);

    // t03-05: Locked Reference Delay (10.0 ms -> flat 0° phase + centered 0.0 ms impulse) + Captured Baseline
    await wsm.applyAutoDelay();
    await wsm.waitForFrames(14);
    await wsm.captureStoredTrace('FOH Flat Baseline');
    await wsm.app.locator('[data-testid^="source-item-live-"]').first().click();
    await wsm.waitForFrames(6);
    await capturer.capture('t03-05-aligned-phase-and-capture', page);

    // Hide baseline stored trace for remaining live diagnostics
    await wsm.setSourceVisibilityByName('FOH Flat Baseline', false);

    // t03-02: Sub + Top Misaligned (+5.0 ms sub delay -> deep 100 Hz notch + +5.0 ms sub arrival)
    await wsm.setOctaveSmoothing('off');
    await wsm.selectLiveSlotPreset('sub-top-misaligned');
    await wsm.waitForFrames(12);
    await wsm.applyAutoDelay();
    await wsm.waitForFrames(14);
    await capturer.capture('t03-02-sub-top-crossover-notch', page);
    await wsm.setOctaveSmoothing('1/12');

    // t03-03: Noisy Venue Coherence Blanking
    await wsm.selectLiveSlotPreset('noisy-crowd');
    await wsm.waitForFrames(12);
    await wsm.applyAutoDelay();
    await wsm.setChartCoherence(1, 'cutoff', 0.5);
    await wsm.setChartPlotType(2, 'coherence');
    await wsm.waitForFrames(16);
    await capturer.capture('t03-03-noisy-coherence-blanking', page);

    // t03-04: Impulse (Linear) vs. Impulse (ETC dB) Reflections
    await wsm.selectLayout('tf-dual');
    await wsm.selectLiveSlotPreset('comb-filtering');
    await wsm.waitForFrames(12);
    await wsm.applyAutoDelay();
    await wsm.setChartPlotType(0, 'impulse');
    await wsm.setChartPlotType(1, 'etc');
    await wsm.waitForFrames(12);
    await capturer.capture('t03-04-impulse-etc-reflections', page);

    // t03-06: Offline Virtual EQ Room Match + LR24 80 Hz HPF on Captured PA Room Modes Trace
    await wsm.selectLayout('tf-dual');
    await wsm.selectLiveSlotPreset('pa-room-modes');
    await wsm.waitForFrames(12);
    await wsm.applyAutoDelay();
    await wsm.waitForFrames(12);
    await wsm.captureStoredTrace('FOH Room Avg');
    await wsm.setSourceVisibilityByName('Live Measurement', false);
    await wsm.addVirtualEq({ hpfTopology: 'linkwitz-riley-24' });
    await wsm.app
      .locator('#wsm-eq-target-source')
      .selectOption({ label: 'FOH Room Avg' });
    await wsm.byTestId('btn-auto-flatten-eq').click();
    await wsm.waitForFrames(6);
    await capturer.capture('t03-06-virtual-eq-room-match', page);

    await context.close();
  }

  // 4. Tutorial 04 — Stored Predicted .FRD Offset Inspector & Measured Minus Predicted dB Difference
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('tf-dual');
    await wsm.setOctaveSmoothing('1/3');
    await wsm.selectLiveSlotPreset('pa-room-modes');
    await wsm.waitForFrames(12);
    await wsm.applyAutoDelay();
    await wsm.waitForFrames(12);
    await wsm.captureStoredTrace('FOH Measured');

    await wsm.importFrdFile(exportedFrdPath);
    await wsm.waitForUiSettled();

    // t04-02: Imported Stored Trace Inspector (passband auto-aligned + Gain/Delay offsets + Export .FRD)
    await wsm.setSourceVisibilityByName('Live Measurement', false);
    await wsm.waitForUiSettled();
    await capturer.capture('t04-02-stored-trace-offset', page);

    // t04-01: Measured Minus Predicted dB Difference Curve
    await wsm.addMathUnion({
      operation: 'diff-db',
      sourceAPattern: /FOH Measured/i,
      sourceBPattern: /foh-mix-position-predicted/i,
    });
    await wsm.waitForFrames(6);
    await capturer.capture('t04-01-measured-minus-predicted', page);

    await context.close();
  }

  // 5. Tutorial 05 — Show SPL Warning, Mixer Input Watch Modal, Culprit Ring Log & Notch EQ Cheat-Sheet
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installSeededShowSplHistory({
      slotIds: ['live-measurement'],
      baseSplDbA: 94.8,
    });
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.setMode('show');
    await wsm.selectShowSlotPreset(0, 'feedback-ring-demo');
    await wsm.setShowSplThresholds(94, 98);
    await wsm.waitForFeedbackRing(1);
    await wsm.waitForFrames(10);
    await capturer.capture('t05-01-show-spl-compliance-warn', page);

    // t05-05: Open Mixer Input Watch & Patch Presets Modal, enable culprit attribution & save patch preset
    await wsm.openMixerWatchModal('show');
    const mwEnable = wsm.byTestId('toggle-mixer-watch-enabled');
    if (!(await mwEnable.isChecked())) {
      await mwEnable.check();
    }
    const presetName = wsm.byTestId('input-mixer-preset-name');
    await presetName.fill('Headliner Stage Patch');
    await wsm.byTestId('btn-save-mixer-preset').click();
    await wsm.waitForFrames(14);
    await capturer.capture('t05-05-mixer-input-watch-modal', page);

    // Close modal & capture culprit attribution + ◆ LIMIT badge + Notch EQ
    await page.keyboard.press('Escape');
    await wsm.setShowSplThresholds(91, 94);
    await wsm.waitForFeedbackRing(1);
    await wsm.waitForFrames(12);
    await capturer.capture('t05-02-show-limit-and-ring-log', page);

    // Click Notch EQ on top culprit ring and switch to Tuning to inspect surgical console cheat-sheet
    await wsm.app.locator('.btn-notch-eq').first().click();
    await wsm.setMode('tuning');
    await wsm.selectLayout('single');
    await wsm.setChartPlotType(0, 'magnitude');
    await wsm.app.locator('[data-testid^="source-item-eq-"]').first().click();
    await wsm.waitForFrames(8);
    await capturer.capture('t05-06-culprit-notch-eq-cheatsheet', page);

    await context.close();
  }

  // 5b. Tutorial 05 Handheld Phone Walkthrough — SPL Trend Tab & Bottom-Sheet 94 dB Calibration
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
    await wsm.setShowSplThresholds(94, 98);

    await wsm.app.getByTestId('mobile-tab-history').click();
    await wsm.waitForFeedbackRing(1);
    await wsm.waitForFrames(8);
    await capturer.capture('t05-03-handheld-phone-spl-trend', page);

    await wsm.app.getByTestId('mobile-tab-mics').click();
    await wsm.waitForUiSettled();
    await wsm.app.getByTestId('btn-show-cal-live-measurement').click();
    await expect(page.locator('[data-doc-region="cal-popover"]')).toBeVisible();
    await wsm.waitForUiSettled();
    await capturer.capture('t05-04-handheld-phone-mics-cal', page);

    await context.close();
  }

  // 6. Tutorial 06 — Venue Bounds, Multi-Zone Balcony, Outdoor End-Fire, Acoustic Ruler & Delay-Ring Handoff
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    await wss.selectVenuePreset('theater-raked-balcony');
    await wss.dismissToast();
    await wss.selectEnvironment();
    await wss.waitForUiSettled();
    await capturer.capture('t06-04-venue-bounds-and-slice', page);

    await wss.selectSurface('surf-balcony');
    await wss.waitForUiSettled();
    await capturer.capture('t06-01-custom-raked-balcony-zones', page);

    await wss.selectVenuePreset('festival-endfire-delays');
    await wss.dismissToast();
    await wss.selectSubArray('sa-endfire-c');
    await wss.waitForUiSettled();
    await capturer.capture('t06-02-outdoor-endfire-delay-ring', page);

    await wss.setViewportLayout('plan');
    await wss.waitForUiSettled();
    await wss.dragAcousticRulerOnPlan({ x: 0.36, y: 0.4 }, { x: 0.52, y: 0.38 });
    await wss.waitForUiSettled();
    await capturer.capture('t06-03-acoustic-ruler-delay-check', page);
    await wss.releaseAcousticRuler();

    // t06-05: Delay Ring Handoff Virtual Mic Arrivals Stem Plot + Auto Time-Alignment
    await wss.setViewportLayout('split');
    await wss.selectVirtualMic('mic-rear');
    await wss.selectChartTab('arrivals');
    await wss.applyAutoTimeAlignment({
      referenceGroupId: 'grp-mains',
      targetGroupId: 'grp-delays',
    });
    await wss.dismissToast();
    await wss.waitForUiSettled();
    await capturer.capture('t06-05-delay-ring-handoff-alignment', page);

    await context.close();
  }

  // 7. Tutorial 07 — Hardware Reload Standby Safety Banner, Help Shortcuts & Staged PWA Update Banner
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface();
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await wsm.waitForFrames(6);
    // Disconnect hardware to show OS-mic-released standby banner ("▶ Resume Mic")
    await wsm.byTestId('btn-stop-hardware').click();
    await expect(wsm.byTestId('audio-status-banner')).toBeVisible();

    // Preview staged offline PWA update indicator + Help shortcuts dialog
    await page.evaluate(() => {
      const app = document.querySelector('web-sound-meter-app') as unknown as {
        shellWindow?: { swUpdateReady?: boolean };
        requestUpdate?: () => void;
      } | null;
      if (app?.shellWindow) {
        app.shellWindow.swUpdateReady = true;
        app.requestUpdate?.();
      }
    });
    await wsm.byTestId('btn-help').click();
    await expect(wsm.byTestId('help-modal')).toBeVisible();
    await wsm.waitForUiSettled();
    await capturer.capture('t07-01-hardware-resume-and-help', page);

    await context.close();
  }
}
