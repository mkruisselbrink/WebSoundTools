// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Captures the 8 step-by-step FOH tutorial screenshots (`docs/tutorials/images/t01..t05*.png`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRetinaPage, sleep } from './generate-screenshots.mjs';

export async function captureTutorialScenes({
  browser,
  wsmUrl,
  wssUrl,
  repoRoot,
  exportedFrdPath,
}) {
  const outDir = path.join(repoRoot, 'docs/tutorials/images');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Capturing 8 step-by-step FOH tutorial screenshots...');

  // 1. Tutorial 01 — Hardware Routing & Mic Calibration Curve
  {
    const { context, page } = await createRetinaPage(browser);
    await page.addInitScript(() => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices = async () => [
          {
            deviceId: 'usb-4ch-interface',
            kind: 'audioinput',
            label: 'Focusrite Scarlett 4i4 USB (4ch)',
            groupId: 'grp-1',
            toJSON() {
              return this;
            },
          },
          {
            deviceId: 'default',
            kind: 'audiooutput',
            label: 'Focusrite Scarlett 4i4 USB Out',
            groupId: 'grp-1',
            toJSON() {
              return this;
            },
          },
        ];
        navigator.mediaDevices.getUserMedia = async () => {
          const ac = new AudioContext({ sampleRate: 48000 });
          const dest = ac.createMediaStreamDestination();
          dest.channelCount = 4;
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.frequency.value = 1000;
          gain.gain.value = 0.08;
          osc.connect(gain).connect(dest);
          osc.start();
          return dest.stream;
        };
      }
    });

    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(900);
    await page.getByTestId('select-input-mode').selectOption('hardware:usb-4ch-interface');
    await sleep(600);
    await page.getByTestId('btn-toggle-advanced-meas').click();
    await sleep(400);
    await page.screenshot({
      path: path.join(outDir, 't01-01-hardware-routing-and-generator.png'),
    });

    const calContent = [
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
    await page.locator('input[type="file"][accept=".cal,.txt,.frd"]').setInputFiles({
      name: 'M30-Serial-8412.cal',
      mimeType: 'text/plain',
      buffer: Buffer.from(calContent, 'utf8'),
    });
    await sleep(600);
    await page.screenshot({
      path: path.join(outDir, 't01-02-mic-calibration-loaded.png'),
    });

    await context.close();
  }

  // 2. Tutorial 02 — WebSpeakerSim DSP Group EQ Handles
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wssUrl, { waitUntil: 'networkidle' });
    await sleep(1100);

    await page.locator('[data-testid^="tree-grp-"]').first().click();
    await sleep(350);
    const addBandBtn = page.getByRole('button', { name: /\+ Band|\+ Add Band/i });
    if ((await addBandBtn.count()) > 0) {
      await addBandBtn.first().click();
      await sleep(300);
    }
    await sleep(600);
    await page.screenshot({
      path: path.join(outDir, 't02-01-wss-dsp-group-eq-handles.png'),
    });

    await context.close();
  }

  // 3. Tutorial 03 — Unaligned Phase Wrap, Sub+Top Crossover Notch & Coherence Masking Modes
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(900);

    await page.getByTestId('select-layout').selectOption('pa-triple');
    await page.getByTestId('select-live-slot-preset').selectOption('flat-delayed');
    const refInput = page.getByTestId('input-ref-delay-ms');
    await refInput.fill('0');
    await refInput.dispatchEvent('change');
    await sleep(1100);
    await page.screenshot({
      path: path.join(outDir, 't03-01-unaligned-wrapped-phase.png'),
    });

    await page.getByTestId('select-live-slot-preset').selectOption('sub-top-misaligned');
    await sleep(900);
    await page.getByTestId('btn-apply-delay').click();
    await sleep(1100);
    await page.screenshot({
      path: path.join(outDir, 't03-02-sub-top-crossover-notch.png'),
    });

    // Noisy Venue: Magnitude on Alpha Fade (>= 35%), Phase on Hard Cutoff (>= 50%), Panel 3 on Coherence
    await page.getByTestId('select-live-slot-preset').selectOption('noisy-crowd');
    await sleep(900);
    await page.getByTestId('btn-apply-delay').click();
    const phasePanel = page.getByTestId('chart-panel-1');
    await phasePanel.getByTestId('select-coherence-mode').selectOption('cutoff');
    await phasePanel.getByTestId('select-coherence-threshold').selectOption('0.5');
    await page.getByTestId('chart-panel-2').locator('select').first().selectOption('coherence');
    await sleep(1200);
    await page.screenshot({
      path: path.join(outDir, 't03-03-noisy-venue-coherence-blanking.png'),
    });

    await context.close();
  }

  // 4. Tutorial 04 — Measured Minus Predicted dB Difference Curve
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(900);

    await page.getByTestId('select-layout').selectOption('tf-dual');
    await page.getByTestId('select-live-slot-preset').selectOption('pa-room-modes');
    await sleep(900);
    await page.getByTestId('btn-apply-delay').click();
    await sleep(800);
    await page.getByTestId('btn-capture-trace').click();
    await sleep(400);

    await page.getByTestId('input-import-frd').setInputFiles(exportedFrdPath);
    await sleep(600);

    await page.getByTestId('btn-add-union').click();
    await sleep(400);
    const unionCard = page.getByTestId('inspector-union-source');
    await unionCard.getByLabel('Union Math Operation').selectOption('diff-db');
    const srcASelect = unionCard.getByLabel('Union Source A');
    const srcBSelect = unionCard.getByLabel('Union Source B');
    const optsA = await srcASelect.locator('option').evaluateAll((els) =>
      els.map((el) => ({ value: el.value, text: el.textContent?.trim() ?? '' }))
    );
    const storedOpt = optsA.find(
      (o) => /Capture|Live/i.test(o.text) && !/predicted/i.test(o.text)
    );
    const predOpt = optsA.find((o) => /predicted|foh/i.test(o.text));
    if (storedOpt) await srcASelect.selectOption(storedOpt.value);
    if (predOpt) await srcBSelect.selectOption(predOpt.value);
    await sleep(800);
    await page.screenshot({
      path: path.join(outDir, 't04-01-measured-minus-predicted-diff.png'),
    });

    await context.close();
  }

  // 5. Tutorial 05 — Live Show Multi-Mic SPL Warning + Feedback Ring Log
  {
    const { context, page } = await createRetinaPage(browser);
    await page.goto(wsmUrl, { waitUntil: 'networkidle' });
    await sleep(800);

    await page.getByTestId('btn-mode-show').click();
    await sleep(400);
    await page.getByTestId('btn-show-add-meas').click();
    await sleep(300);
    await page
      .locator('[data-testid^="select-show-sim-preset-"]')
      .first()
      .selectOption('feedback-ring-demo');
    const warnInput = page.getByTestId('input-spl-warn-db');
    const limitInput = page.getByTestId('input-spl-limit-db');
    await warnInput.fill('72');
    await warnInput.dispatchEvent('change');
    await limitInput.fill('84');
    await limitInput.dispatchEvent('change');
    await sleep(2200);
    await page.screenshot({
      path: path.join(outDir, 't05-01-show-spl-compliance-warn.png'),
    });

    await context.close();
  }
}

