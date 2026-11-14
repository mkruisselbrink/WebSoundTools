/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from '@playwright/test';

test.describe('WebSpeakerSim End-to-End Application Suite', () => {
  test('boots with live Web Worker SPL simulation, dual viewports, coverage metrics, and chart tabs', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByTestId('app-topbar')).toBeVisible();
    await expect(page.getByTestId('viewport-plan')).toBeVisible();
    await expect(page.getByTestId('viewport-section')).toBeVisible();
    await expect(page.getByTestId('chart-drawer')).toBeVisible();

    // Wait for Web Worker simulation results to populate coverage metrics
    const metrics = page.getByTestId('coverage-metrics');
    await expect(metrics).toBeVisible();
    await expect(metrics).toContainText('Mean');
    await expect(metrics).toContainText('dB');

    // Switch viewport layouts
    await page.getByTestId('layout-plan').click();
    await expect(page.getByTestId('viewport-plan')).toBeVisible();
    await expect(page.getByTestId('viewport-section')).toHaveCount(0);

    await page.getByTestId('layout-split').click();
    await expect(page.getByTestId('viewport-section')).toBeVisible();

    // Switch chart tabs inside <wss-chart-panel>
    await page.getByRole('button', { name: 'Phase (°)' }).click();
    await page.getByRole('button', { name: 'Arrivals' }).click();
    await page.getByRole('button', { name: 'SPL Histogram' }).click();
  });

  test('supports preset switching, adding tops & sub arrays, Undo/Redo, and localStorage reload persistence', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('coverage-metrics')).toBeVisible();

    // Switch to Raked Auditorium & Balcony preset
    await page.getByTestId('preset-select').selectOption('theater-raked-balcony');
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
    await page.getByTestId('btn-sa-quarter-wave').click();

    // Wait >250ms for debounced localStorage autosave, reload, and verify state persisted
    await page.waitForTimeout(350);
    await page.reload();
    await expect(page.getByTestId('scene-sidebar')).toContainText('Delay Outfill Top');
  });

  test('edits DSP Group Parametric EQ and applies Virtual Mic Auto Time-Alignment', async ({
    page,
  }) => {
    await page.goto('/?preset=club-cardioid-pa');
    await expect(page.getByTestId('coverage-metrics')).toBeVisible();

    // Add a DSP group or select existing first DSP group
    const firstGroupRow = page.locator('[data-testid^="tree-grp-"]').first();
    await firstGroupRow.click();
    await expect(page.getByTestId('inspector-dsp-group')).toBeVisible();

    // Add an EQ band
    await page.getByTestId('btn-add-eq-band').click();
    await expect(page.getByTestId('eq-band-0')).toBeVisible();

    // Select a Virtual Microphone and run one-click Auto Time-Alignment
    const firstMicRow = page.locator('[data-testid^="tree-mic-"]').first();
    await firstMicRow.click();
    await expect(page.getByTestId('inspector-virtual-mic')).toBeVisible();
    await expect(page.getByTestId('mic-predicted-readout')).toContainText('dBA');

    await page.getByTestId('btn-apply-alignment').click();
    await expect(page.getByTestId('toast-banner')).toBeVisible();
  });

  test('synthesizes custom speakers via Spec Builder, imports .gll & .clf files, and persists in IndexedDB', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('btn-speaker-library').click();
    await expect(page.getByTestId('speaker-library-modal')).toBeVisible();

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

    const toNodeBuffer = (bytes: Uint8Array) =>
      (globalThis as unknown as { Buffer: { from(b: Uint8Array): unknown } }).Buffer.from(bytes);

    const fileInput = page.getByTestId('speaker-file-input');
    type InputFileArg = Parameters<typeof fileInput.setInputFiles>[0];
    await fileInput.setInputFiles([
      {
        name: 'horn90x40.clf',
        mimeType: 'text/plain',
        buffer: toNodeBuffer(new TextEncoder().encode(clfContent)),
      },
      {
        name: 'hdl-custom.gll',
        mimeType: 'application/octet-stream',
        buffer: toNodeBuffer(gllBytes),
      },
    ] as unknown as InputFileArg);

    const catalogList = page.getByTestId('catalog-speaker-list');
    await expect(catalogList).toContainText('Imported 90x40 Horn');
    await expect(catalogList).toContainText('HDL-Series');

    // Reload browser and confirm IndexedDB re-hydrates all custom & imported speakers
    await page.getByTestId('btn-close-library-modal').click();
    await page.reload();
    await page.getByTestId('btn-speaker-library').click();
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('Touring 10-inch Coax');
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('Imported 90x40 Horn');
    await expect(page.getByTestId('catalog-speaker-list')).toContainText('HDL-Series');
  });

  test('immediately repaints Plan & Section heatmaps when Contours, Scale, Palette, or Stepped change', async ({
    page,
  }) => {
    await page.goto('/?preset=club-cardioid-pa');
    await expect(page.getByTestId('coverage-metrics')).toBeVisible();

    const readGlCanvasDataUrl = () =>
      page.evaluate(() => {
        const app = document.querySelector('web-speaker-sim-app');
        const vp = app?.shadowRoot?.querySelector('[data-testid="viewport-plan"]');
        const canvas = vp?.shadowRoot?.querySelector('canvas.gl-canvas') as HTMLCanvasElement | null;
        return canvas ? canvas.toDataURL() : '';
      });

    // Wait a frame for initial WebGL render
    await page.waitForTimeout(100);
    const initialSnap = await readGlCanvasDataUrl();
    expect(initialSnap.length).toBeGreaterThan(200);

    // 1. Toggle Contours from 3 dB -> Off -> 1 dB and verify pixels change each time
    await page.getByTestId('isoline-select').selectOption('0');
    await page.waitForTimeout(80);
    const contoursOffSnap = await readGlCanvasDataUrl();
    expect(contoursOffSnap).not.toBe(initialSnap);

    await page.getByTestId('isoline-select').selectOption('1');
    await page.waitForTimeout(80);
    const contours1dBSnap = await readGlCanvasDataUrl();
    expect(contours1dBSnap).not.toBe(contoursOffSnap);

    // 2. Switch Scale to Auto ±3 dB (tight contrast)
    await page.getByTestId('colormap-range-select').selectOption('auto-6');
    await page.waitForTimeout(80);
    const tightScaleSnap = await readGlCanvasDataUrl();
    expect(tightScaleSnap).not.toBe(contours1dBSnap);

    // 3. Switch Palette to Thermal (inferno) and toggle Stepped bands
    await page.getByTestId('colormap-palette-select').selectOption('inferno');
    await page.waitForTimeout(80);
    const infernoSnap = await readGlCanvasDataUrl();
    expect(infernoSnap).not.toBe(tightScaleSnap);

    await page.getByTestId('btn-colormap-stepped').click();
    await page.waitForTimeout(80);
    const steppedSnap = await readGlCanvasDataUrl();
    expect(steppedSnap).not.toBe(infernoSnap);

    // 4. Verify Magnitude Span selector in <wss-chart-panel>
    await page.getByTestId('chart-mag-span-select').selectOption('auto-30');
    await expect(page.getByTestId('chart-mag-span-select')).toHaveValue('auto-30');
  });
});

