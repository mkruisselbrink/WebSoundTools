// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, test } from '@playwright/test';
import { WssPageDriver } from './wss-page-driver.ts';

test.describe('WebSpeakerSim End-to-End Application Suite', () => {
  test('boots with live Web Worker SPL simulation, dual viewports, coverage metrics, and chart tabs', async ({
    page,
  }) => {
    const wss = new WssPageDriver(page);
    await wss.goto('/');

    await expect(page.getByTestId('app-topbar')).toBeVisible();
    const topbarBox = await page.getByTestId('app-topbar').boundingBox();
    expect(topbarBox?.height).toBe(40);
    await expect(page.getByTestId('viewport-plan')).toBeVisible();
    await expect(page.getByTestId('viewport-section')).toBeVisible();
    await expect(page.getByTestId('chart-drawer')).toBeVisible();

    // Verify Help modal open/close via button and Escape
    await page.getByTestId('btn-help').click();
    await expect(page.getByTestId('help-modal')).toBeVisible();
    await expect(page.getByTestId('help-link-source')).toHaveAttribute(
      'href',
      'https://github.com/mkruisselbrink/WebSoundTools'
    );
    await expect(page.getByTestId('help-link-issues')).toHaveAttribute(
      'href',
      'https://github.com/mkruisselbrink/WebSoundTools/issues'
    );
    const cardBoxes = await page
      .locator('foh-help-modal .resource-card')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    expect(cardBoxes).toHaveLength(4);
    expect(cardBoxes[0].bottom).toBeLessThanOrEqual(cardBoxes[2].top);
    expect(cardBoxes[1].bottom).toBeLessThanOrEqual(cardBoxes[3].top);
    await expect(page.getByTestId('help-link-commit')).toHaveCount(0);
    await page.locator('foh-help-modal').evaluate((el: Element) => {
      (el as HTMLElement & { commitSha: string }).commitSha =
        'df48c8b1a2b3c4d5e6f708192a3b4c5d6e7f8091';
    });
    await expect(page.getByTestId('help-link-commit')).toHaveAttribute(
      'href',
      'https://github.com/mkruisselbrink/WebSoundTools/commit/df48c8b1a2b3c4d5e6f708192a3b4c5d6e7f8091'
    );
    await expect(page.getByTestId('help-link-commit')).toContainText('df48c8b1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-modal')).not.toBeVisible();

    // Switch viewport layouts
    await wss.setViewportLayout('plan');
    await expect(page.getByTestId('viewport-plan')).toBeVisible();
    await expect(page.getByTestId('viewport-section')).toHaveCount(0);

    await wss.setViewportLayout('split');
    await expect(page.getByTestId('viewport-section')).toBeVisible();

    // Switch chart tabs inside <wss-chart-panel>
    await wss.selectChartTab('phase');
    await wss.selectChartTab('arrivals');
    await wss.selectChartTab('histogram');
  });

  test('supports preset switching, adding tops & sub arrays, Undo/Redo, and localStorage reload persistence', async ({
    page,
  }) => {
    const wss = new WssPageDriver(page);
    await wss.goto('/');

    // Switch to Raked Auditorium & Balcony preset
    await wss.selectVenuePreset('theater-raked-balcony');
    await expect(page.getByTestId('toast-banner')).toContainText('Raked Auditorium');

    const sidebar = page.getByTestId('scene-sidebar');
    await expect(sidebar).toContainText('Balcony');

    // Add a new Point Source and edit its name
    await page.getByTestId('btn-add-point-source').click();
    await expect(page.getByTestId('inspector-point-source')).toBeVisible();
    const nameInput = page.getByTestId('ps-name-input');
    await nameInput.fill('Delay Outfill Top');
    await nameInput.press('Enter');
    await expect(sidebar).toContainText('Delay Outfill Top');

    // Undo name change, then Undo adding the point source, then Redo
    await page.getByTestId('btn-undo').click();
    await page.getByTestId('btn-undo').click();
    await expect(sidebar).not.toContainText('Delay Outfill Top');

    await page.getByTestId('btn-redo').click();
    await page.getByTestId('btn-redo').click();
    await expect(sidebar).toContainText('Delay Outfill Top');

    // Add a Subwoofer Array and click Set lambda/4 spacing
    await page.getByTestId('btn-add-sub-array').click();
    await expect(page.getByTestId('inspector-sub-array')).toBeVisible();
    await wss.applyQuarterWaveSpacing();

    // Wait >250ms for debounced localStorage autosave, reload, and verify state persisted
    await page.waitForTimeout(350);
    await page.reload();
    await expect(page.getByTestId('scene-sidebar')).toContainText('Delay Outfill Top');
  });

  test('edits DSP Group Parametric EQ and applies Virtual Mic Auto Time-Alignment', async ({
    page,
  }) => {
    const wss = new WssPageDriver(page);
    await wss.goto('/?preset=club-cardioid-pa');

    await wss.selectFirstDspGroup();
    const gainInput = page.getByTestId('grp-gain-db');
    await gainInput.focus();
    const initialGain = await gainInput.inputValue();
    const gainBox = await gainInput.boundingBox();
    if (gainBox) {
      await page.mouse.move(gainBox.x + gainBox.width / 2, gainBox.y + gainBox.height / 2);
      await page.mouse.wheel(0, 120);
      await page.mouse.wheel(0, -120);
    }
    await expect(gainInput).toHaveValue(initialGain);

    await wss.addEqBand();
    await expect(page.getByTestId('eq-band-0')).toBeVisible();

    // Select a Virtual Microphone and run one-click Auto Time-Alignment
    await wss.selectVirtualMic('mic-foh');
    await expect(page.getByTestId('mic-predicted-readout')).toContainText('dBA');

    await wss.applyAutoTimeAlignment();
    await expect(page.getByTestId('toast-banner')).toBeVisible();
  });

  test('synthesizes custom speakers via Spec Builder, imports .gll & .clf files, and persists in IndexedDB', async ({
    page,
  }) => {
    const wss = new WssPageDriver(page);
    await wss.goto('/');
    await wss.openSpeakerLibraryModal();

    // 1. Create speaker from Datasheet Spec Builder
    await page.getByTestId('tab-spec-builder').click();
    await page.getByTestId('spec-name-input').fill('Touring 10-inch Coax');
    await page.getByTestId('btn-create-spec-speaker').click();
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('Touring 10-inch Coax');

    // 2. Import both a .clf polar file and a binary EGLL .gll file in the browser
    await page.getByTestId('tab-import-file').click();

    const clfContent = [
      '<CABINET> Imported 90x40 Horn',
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

    const gllAscii = 'EGLL\x01\x00\x00\x00HDL-Series 90x60 135 dB\x00RCF S.p.A.\x00\x00\x00\x00';
    const gllBytes = new Uint8Array(gllAscii.length);
    for (let i = 0; i < gllAscii.length; i++) {
      gllBytes[i] = gllAscii.charCodeAt(i) & 0xff;
    }

    await page.getByTestId('speaker-file-input').setInputFiles([
      {
        name: 'horn90x40.clf',
        mimeType: 'text/plain',
        buffer: Buffer.from(clfContent, 'utf8'),
      },
      {
        name: 'hdl-custom.gll',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(gllBytes),
      },
    ]);

    const catalogList = page.getByTestId('catalog-speaker-list');
    await expect(catalogList).toContainText('Imported 90x40 Horn');
    await expect(catalogList).toContainText('HDL-Series');

    // Reload browser and confirm IndexedDB re-hydrates all custom & imported speakers
    await wss.closeSpeakerLibraryModal();
    await page.reload();
    await wss.openSpeakerLibraryModal();
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('Touring 10-inch Coax');
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('Imported 90x40 Horn');
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('HDL-Series');
  });

  test('immediately repaints Plan & Section heatmaps when Contours, Scale, Palette, or Stepped change', async ({
    page,
  }) => {
    const wss = new WssPageDriver(page);
    await wss.goto('/?preset=club-cardioid-pa');

    const readGlCanvasDataUrl = () =>
      page.evaluate(() => {
        const app = document.querySelector('web-speaker-sim-app');
        const vp = app?.shadowRoot?.querySelector('[data-testid="viewport-plan"]');
        const canvas = vp?.shadowRoot?.querySelector(
          'canvas.gl-canvas'
        ) as HTMLCanvasElement | null;
        return canvas ? canvas.toDataURL() : '';
      });

    await page.waitForTimeout(100);
    const initialSnap = await readGlCanvasDataUrl();
    expect(initialSnap.length).toBeGreaterThan(200);

    // 1. Toggle Contours from 3 dB -> Off -> 1 dB and verify pixels change each time
    await wss.setIsolineStep(0);
    await page.waitForTimeout(80);
    const contoursOffSnap = await readGlCanvasDataUrl();
    expect(contoursOffSnap).not.toBe(initialSnap);

    await wss.setIsolineStep(1);
    await page.waitForTimeout(80);
    const contours1dBSnap = await readGlCanvasDataUrl();
    expect(contours1dBSnap).not.toBe(contoursOffSnap);

    // 2. Switch Scale to Auto ±3 dB (tight contrast)
    await wss.setColormapRange('auto-6');
    await page.waitForTimeout(80);
    const tightScaleSnap = await readGlCanvasDataUrl();
    expect(tightScaleSnap).not.toBe(contours1dBSnap);

    // 3. Switch Palette to Thermal (inferno) and toggle Stepped bands
    await wss.setColormapPalette('inferno');
    await page.waitForTimeout(80);
    const infernoSnap = await readGlCanvasDataUrl();
    expect(infernoSnap).not.toBe(tightScaleSnap);

    await wss.toggleSteppedColormap();
    await page.waitForTimeout(80);
    const steppedSnap = await readGlCanvasDataUrl();
    expect(steppedSnap).not.toBe(infernoSnap);

    // 4. Verify Magnitude Span selector in <wss-chart-panel> and zero header wrap on hover
    await wss.setMagnitudeSpan('auto-30');
    await expect(page.getByTestId('chart-mag-span-select')).toHaveValue('auto-30');

    const getHeaderHeight = () =>
      page.evaluate(() => {
        const app = document.querySelector('web-speaker-sim-app');
        const chart = app?.shadowRoot?.querySelector('wss-chart-panel');
        const hdr = chart?.shadowRoot?.querySelector('.chart-header') as HTMLElement | null;
        return hdr ? hdr.getBoundingClientRect().height : 0;
      });

    const beforeHoverHeight = await getHeaderHeight();
    expect(beforeHoverHeight).toBeGreaterThan(20);

    const chartDrawer = page.getByTestId('chart-drawer');
    const box = await chartDrawer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.65);
      await page.waitForTimeout(60);
    }
    const duringHoverHeight = await getHeaderHeight();
    expect(duringHoverHeight).toBe(beforeHoverHeight);
  });
});
