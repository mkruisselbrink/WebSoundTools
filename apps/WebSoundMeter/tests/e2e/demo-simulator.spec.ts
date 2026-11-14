/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { test, expect } from '@playwright/test';

test.describe('WebSoundMeter Demo Simulator, Multi-Channel & Offline PWA E2E', () => {
  test('boots in Demo Simulator mode, supports multiple simultaneous Live Measurements, captures traces, and persists state across reloads and offline mode', async ({
    page,
    context,
  }) => {
    await page.goto('/');

    const app = page.locator('web-sound-meter-app');
    await expect(app).toBeVisible();

    // Verify PWA manifest link is present
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');

    // Wait for simulator worker frames to populate SPL meter and Delay Finder
    const splValue = app.locator('[data-testid="spl-main-value"]');
    await expect(splValue).not.toHaveText('0.0', { timeout: 5000 });

    const estimatedDelay = app.locator('[data-testid="estimated-delay-ms"]');
    await expect(estimatedDelay).toContainText('8.5', { timeout: 5000 });

    // Click "Apply Delay" and verify Ref Delay input updates to ~8.50 ms
    await app.locator('[data-testid="btn-apply-delay"]').click();
    const refDelayInput = app.locator('[data-testid="input-ref-delay-ms"]');
    const refDelayVal = Number(await refDelayInput.inputValue());
    expect(refDelayVal).toBeCloseTo(8.5, 1);

    // Add a second simultaneous Live Measurement source (+ Meas)
    await app.locator('[data-testid="btn-add-meas"]').click();
    const liveSlotNameInput = app.locator('[data-testid="input-live-slot-name"]');
    await expect(liveSlotNameInput).toHaveValue('Live Measurement #2');
    await liveSlotNameInput.fill('Sub Nearfield Live');

    // Verify Topbar does not show per-slot preset, while Inspector shows it and hides Advanced controls by default
    await expect(app.locator('[data-testid="select-simulator-preset"]')).toHaveCount(0);
    await expect(app.locator('[data-testid="select-live-slot-preset"]')).toBeVisible();
    await expect(app.locator('[data-testid="select-fft-size"]')).toHaveCount(0);
    await app.locator('[data-testid="btn-toggle-advanced-meas"]').click();
    await expect(app.locator('[data-testid="select-fft-size"]')).toBeVisible();
    await expect(app.locator('[data-testid="select-smoothing"]')).toBeVisible();

    // Capture a stored trace
    await app.locator('[data-testid="btn-capture-trace"]').click();
    const storedItems = app.locator('[data-testid^="source-item-stored-"]');
    await expect(storedItems).toHaveCount(1);

    // Rename the stored trace with spaces, 'c', and 'd' and ensure no duplicate traces are created
    const nameInput = app.getByLabel('Stored Trace Name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('');
    await nameInput.pressSequentially('Center Cluster Delayed');
    await expect(nameInput).toHaveValue('Center Cluster Delayed');
    await expect(storedItems).toHaveCount(1);

    // Toggle Live Measurement visibility off and ensure it stays off across incoming frames
    const liveVisibilityCheckbox = app.getByLabel(
      'Toggle visibility for Live Measurement'
    );
    await expect(liveVisibilityCheckbox).toBeChecked();
    await liveVisibilityCheckbox.uncheck();
    await page.waitForTimeout(150);
    await expect(liveVisibilityCheckbox).not.toBeChecked();

    // Switch layout presets and verify chart panel count & URL query string update
    const layoutSelect = app.locator('[data-testid="select-layout"]');
    await layoutSelect.selectOption('tf-dual');
    await expect(app.locator('chart-panel')).toHaveCount(2);
    expect(page.url()).toContain('layout=tf-dual');

    // Add a Virtual Equalizer source and click Auto-Flatten
    await app.locator('[data-testid="btn-add-eq"]').click();
    const autoFlattenBtn = app.locator('[data-testid="btn-auto-flatten-eq"]');
    await expect(autoFlattenBtn).toBeVisible();
    await autoFlattenBtn.click();

    // Add a Math / Union source
    await app.locator('[data-testid="btn-add-union"]').click();
    await expect(app.locator('[data-testid^="source-item-union-"]')).toHaveCount(1);

    // Wait for Service Worker to be ready and controlling the page
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    // Reload the page and verify layout, both Live Measurements, Stored Trace, Virtual EQ, and Math Union persist
    await page.reload();
    await expect(app.locator('chart-panel')).toHaveCount(2);
    await expect(app.locator('[data-testid^="source-item-live-"]')).toHaveCount(2);
    await expect(app.locator('[data-testid^="source-item-stored-"]')).toHaveCount(1);
    await expect(app.locator('[data-testid^="source-item-eq-"]')).toHaveCount(1);
    await expect(app.locator('[data-testid^="source-item-union-"]')).toHaveCount(1);
    await expect(
      app.getByLabel('Toggle visibility for Live Measurement')
    ).not.toBeChecked();

    // Verify offline reload works via Service Worker
    await context.setOffline(true);
    await page.reload();
    await expect(app.locator('chart-panel')).toHaveCount(2);
    await expect(app.locator('[data-testid^="source-item-live-"]')).toHaveCount(2);
    await context.setOffline(false);
  });
});
