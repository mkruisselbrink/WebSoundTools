// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 15 step-by-step FOH tutorial screenshots (`docs/tutorials/images/t01..t06*.png`).
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

  console.log('Capturing 15 step-by-step FOH tutorial screenshots...');

  // 1. Tutorial 01 — Hardware Routing, Live Preamp dBFS Meters & Mic Calibration Upload
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface();
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectInputSource('hardware:usb-4ch-interface');
    await sleep(300);
    // Explicitly enable generator after switching to hardware (showing GEN ON + Out Ch 1+2)
    await wsm.toggleGenerator();
    await sleep(650);
    await wsm.applyAutoDelay();
    await sleep(500);
    // Crop cleanly to full Topbar (including GEN ON + Out Ch 1+2) + Charts + Right Inspector (Meas M / Ref R dBFS meters)
    await page.screenshot({
      path: path.join(outDir, 't01-01-hardware-routing-and-generator.png'),
      clip: { x: 0, y: 0, width: 1440, height: 615 },
    });

    await wsm.toggleAdvancedMeasurementSettings();
    await sleep(250);
    await wsm.uploadCalibrationText('M30-Serial-8412.cal', SAMPLE_MIC_CALIBRATION);
    await sleep(450);
    // Scroll right sidebar so both Mic Calibration Curve dropdown and Upload button are fully visible
    await wsm.app.locator('.sidebar').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await sleep(200);
    await page.screenshot({
      path: path.join(outDir, 't01-02-mic-calibration-loaded.png'),
      clip: { x: 1096, y: 52, width: 344, height: 848 },
    });

    await context.close();
  }

  // 2. Tutorial 02 — Live Club CSA Schedule, Club Virtual Mic Alignment & Multi-Band EQ Handles
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    // t02-03: Cropped CSA Subwoofer Array Designer + Generated Enclosure Schedule
    await wss.setColormapRange('auto-36');
    await wss.selectBand('hz-63');
    await wss.selectSubArray('sa-center-cardioid');
    await wss.setSubArrayMode('cardioid-csa');
    await wss.applyQuarterWaveSpacing();
    await sleep(650);
    await page.screenshot({
      path: path.join(outDir, 't02-03-csa-enclosure-schedule.png'),
      clip: { x: 1088, y: 392, width: 352, height: 508 },
    });

    // t02-02: Live Club Virtual Mic Phase & Auto Time-Alignment (toast cleared)
    await wss.selectBand('pink-A');
    await wss.setColormapRange('auto-21');
    await wss.selectVirtualMic('mic-foh');
    await wss.selectChartTab('phase');
    await wss.applyAutoTimeAlignment({
      referenceGroupId: 'grp-subs',
      targetGroupId: 'grp-mains',
    });
    await wss.dismissToast();
    await sleep(650);
    await page.screenshot({
      path: path.join(outDir, 't02-02-club-mic-alignment.png'),
    });

    // t02-01: Cropped Chart + DSP Group Inspector with 3 sculpted EQ handles
    await wss.selectChartTab('magnitude');
    await wss.selectFirstDspGroup();
    await wss.addEqBand();
    await wss.addEqBand();
    await wss.addEqBand();
    await sleep(650);
    await page.screenshot({
      path: path.join(outDir, 't02-01-wss-dsp-group-eq-handles.png'),
      clip: { x: 0, y: 392, width: 1440, height: 508 },
    });

    await context.close();
  }

  // 3. Tutorial 03 — Unaligned Phase, Fixed 100 Hz Crossover Notch, Coherence Masking & Impulse ETC
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('pa-triple');
    await wsm.selectLiveSlotPreset('flat-delayed');
    await wsm.setReferenceDelayMs(0);
    await sleep(950);
    await page.screenshot({
      path: path.join(outDir, 't03-01-unaligned-wrapped-phase.png'),
    });

    // Preset 3 (+5.0 ms sub delay -> deep -20+ dB 100 Hz notch unsmoothed + +5.0 ms sub arrival)
    await wsm.setOctaveSmoothing('off');
    await wsm.selectLiveSlotPreset('sub-top-misaligned');
    await sleep(850);
    await wsm.applyAutoDelay();
    await sleep(1050);
    await page.screenshot({
      path: path.join(outDir, 't03-02-sub-top-crossover-notch.png'),
    });
    await wsm.setOctaveSmoothing('1/12');

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

    // t03-04: Impulse (Linear) vs. Impulse (ETC dB) exposing floor & rear-wall reflections
    await wsm.selectLayout('tf-dual');
    await wsm.selectLiveSlotPreset('comb-filtering');
    await sleep(800);
    await wsm.applyAutoDelay();
    await wsm.setChartPlotType(0, 'impulse');
    await wsm.setChartPlotType(1, 'etc');
    await sleep(900);
    await page.screenshot({
      path: path.join(outDir, 't03-04-impulse-etc-reflections.png'),
      clip: { x: 0, y: 52, width: 1096, height: 848 },
    });

    await context.close();
  }

  // 4. Tutorial 04 — Clean Smoothed Measured Minus Predicted dB Difference Curve
  {
    const { context, page } = await createRetinaPage(browser);
    const wsm = new WsmPageDriver(page);
    await wsm.goto(wsmUrl);
    await wsm.waitForLiveSignal();

    await wsm.selectLayout('tf-dual');
    await wsm.setOctaveSmoothing('1/3');
    await wsm.selectLiveSlotPreset('pa-room-modes');
    await sleep(850);
    await wsm.applyAutoDelay();
    await sleep(750);
    await wsm.captureStoredTrace('FOH Measured');
    await sleep(300);

    await wsm.importFrdFile(exportedFrdPath);
    await sleep(500);

    // Hide live trace so only FOH Measured, foh-mix-position-predicted, and smoothed dB Difference show
    await wsm.setSourceVisibilityByName('Live Measurement', false);

    await wsm.addMathUnion({
      operation: 'diff-db',
      sourceAPattern: /FOH Measured/i,
      sourceBPattern: /foh-mix-position-predicted/i,
    });
    // Show Magnitude + Coherence/RTA or clean Magnitude focus; set Phase coherence cutoff cleanly
    await sleep(750);
    await page.screenshot({
      path: path.join(outDir, 't04-01-measured-minus-predicted-diff.png'),
    });

    await context.close();
  }

  // 5. Tutorial 05 — Seeded 15m Show SPL Warning Timeline + Cropped LIMIT & Ring Log Notch EQ
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
    await sleep(2200);
    await page.screenshot({
      path: path.join(outDir, 't05-01-show-spl-compliance-warn.png'),
    });

    // Click Notch EQ on first detected feedback ring and lower Limit to 95 dB to show ◆ LIMIT badge
    const notchBtn = wsm.app.locator('.btn-notch-eq').first();
    if ((await notchBtn.count()) > 0) {
      await notchBtn.click();
    }
    await wsm.setShowSplThresholds(91, 94);
    await sleep(600);
    await page.screenshot({
      path: path.join(outDir, 't05-02-show-limit-and-ring-log.png'),
      clip: { x: 0, y: 0, width: 1440, height: 525 },
    });

    await context.close();
  }

  // 6. Tutorial 06 — Custom Multi-Zone Venue, Outdoor End-Fire Subs + Delay Ring & Acoustic Ruler
  {
    const { context, page } = await createRetinaPage(browser);
    const wss = new WssPageDriver(page);
    await wss.goto(wssUrl);

    // t06-01: Raked Auditorium & Overhanging Balcony Zone Inspector
    await wss.selectVenuePreset('theater-raked-balcony');
    await wss.dismissToast();
    await wss.selectSurface('surf-balcony');
    await sleep(650);
    await page.screenshot({
      path: path.join(outDir, 't06-01-custom-raked-balcony-zones.png'),
    });

    // t06-02: Outdoor Festival Field — End-Fire Subs + 26 m Delay Ring
    await wss.selectVenuePreset('festival-endfire-delays');
    await wss.dismissToast();
    await wss.selectSubArray('sa-endfire-c');
    await sleep(750);
    const festivalMetrics = await wss.byTestId('coverage-metrics').textContent();
    console.log('  [WSS Outdoor Festival]:', festivalMetrics?.trim());
    await page.screenshot({
      path: path.join(outDir, 't06-02-outdoor-endfire-delay-ring.png'),
    });

    // t06-03: Shift + Drag Acoustic Ruler measuring throw distance (m) & flight time (ms) in Plan View
    await wss.setViewportLayout('plan');
    await sleep(350);
    await wss.dragAcousticRulerOnPlan({ x: 0.36, y: 0.4 }, { x: 0.52, y: 0.38 });
    await sleep(250);
    await page.screenshot({
      path: path.join(outDir, 't06-03-acoustic-ruler-delay-check.png'),
      clip: { x: 0, y: 66, width: 1090, height: 525 },
    });
    await wss.releaseAcousticRuler();

    await context.close();
  }
}
