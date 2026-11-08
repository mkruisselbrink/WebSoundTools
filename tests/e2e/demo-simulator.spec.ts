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

test.describe('WebSoundMeter Demo Simulator E2E', () => {
  test('boots in Demo Simulator mode, updates SPL meters, finds delay, captures traces, and auto-flattens Virtual EQ', async ({
    page,
  }) => {
    await page.goto('/');

    const app = page.locator('web-sound-meter-app');
    await expect(app).toBeVisible();

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

    // Capture a stored trace
    await app.locator('[data-testid="btn-capture-trace"]').click();
    await expect(app.locator('[data-testid^="source-item-stored-"]')).toHaveCount(1);

    // Add a Virtual Equalizer source and click Auto-Flatten
    await app.locator('[data-testid="btn-add-eq"]').click();
    const autoFlattenBtn = app.locator('[data-testid="btn-auto-flatten-eq"]');
    await expect(autoFlattenBtn).toBeVisible();
    await autoFlattenBtn.click();

    // Add a Math / Union source
    await app.locator('[data-testid="btn-add-union"]').click();
    await expect(app.locator('[data-testid^="source-item-union-"]')).toHaveCount(1);
  });
});

