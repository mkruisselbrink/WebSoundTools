// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, test } from '@playwright/test';
import { WsmPageDriver } from './wsm-page-driver.ts';

test.describe('WebSoundMeter Demo Simulator, Multi-Channel & Offline PWA E2E', () => {
  test('boots in Demo Simulator mode, supports multiple simultaneous Live Measurements, captures traces, and persists state across reloads and offline mode', async ({
    page,
    context,
  }) => {
    const wsm = new WsmPageDriver(page);
    await wsm.goto('/');

    // Verify PWA manifest link and locked 40px single-row studio header
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');
    const topbarBox = await wsm.app.getByTestId('app-topbar').boundingBox();
    expect(topbarBox?.height).toBe(40);

    // Wait for simulator worker frames to populate SPL meter and Delay Finder
    await wsm.waitForLiveSignal();

    const estimatedDelay = wsm.app.getByTestId('estimated-delay-ms');
    await expect(estimatedDelay).toContainText('8.5', { timeout: 5000 });

    // Click "Apply Delay" and verify Ref Delay input updates to ~8.50 ms
    await wsm.applyAutoDelay();
    const refDelayInput = wsm.app.getByTestId('input-ref-delay-ms');
    await expect(refDelayInput).not.toHaveValue('0');
    const refDelayVal = Number(await refDelayInput.inputValue());
    expect(refDelayVal).toBeCloseTo(8.5, 1);

    // Verify Topbar GitHub link and Help modal non-overlapping resource cards + Escape close
    await expect(wsm.app.getByTestId('link-github')).toHaveAttribute(
      'href',
      'https://github.com/mkruisselbrink/WebSoundTools'
    );
    await wsm.app.getByTestId('btn-help').click();
    await expect(wsm.app.getByTestId('help-modal')).toBeVisible();
    await expect(wsm.app.getByTestId('help-link-issues')).toHaveAttribute(
      'href',
      'https://github.com/mkruisselbrink/WebSoundTools/issues'
    );
    const cardBoxes = await wsm.app
      .locator('foh-help-modal .resource-card')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    expect(cardBoxes).toHaveLength(4);
    expect(cardBoxes[0].bottom).toBeLessThanOrEqual(cardBoxes[2].top);
    expect(cardBoxes[1].bottom).toBeLessThanOrEqual(cardBoxes[3].top);
    await expect(wsm.app.getByTestId('help-link-commit')).toHaveCount(0);
    await wsm.app.locator('foh-help-modal').evaluate((el: Element) => {
      (el as HTMLElement & { commitSha: string }).commitSha =
        'df48c8b1a2b3c4d5e6f708192a3b4c5d6e7f8091';
    });
    await expect(wsm.app.getByTestId('help-link-commit')).toHaveAttribute(
      'href',
      'https://github.com/mkruisselbrink/WebSoundTools/commit/df48c8b1a2b3c4d5e6f708192a3b4c5d6e7f8091'
    );
    await expect(wsm.app.getByTestId('help-link-commit')).toContainText('df48c8b1');
    await page.keyboard.press('Escape');
    await expect(wsm.app.getByTestId('help-modal')).not.toBeVisible();

    // Add a second simultaneous Live Measurement source (+ Meas)
    await wsm.addLiveMeasurement('Sub Nearfield Live');
    await expect(wsm.app.getByTestId('input-live-slot-name')).toHaveValue('Sub Nearfield Live');

    // Verify Topbar does not show per-slot preset, while Inspector shows it and hides Advanced controls by default
    await expect(wsm.app.getByTestId('select-simulator-preset')).toHaveCount(0);
    await expect(wsm.app.getByTestId('select-live-slot-preset')).toBeVisible();
    await expect(wsm.app.getByTestId('select-fft-size')).toHaveCount(0);
    await wsm.toggleAdvancedMeasurementSettings();
    await expect(wsm.app.getByTestId('select-fft-size')).toBeVisible();
    await expect(wsm.app.getByTestId('select-smoothing')).toBeVisible();

    // Verify SPL limit alert activates above threshold and clears automatically once back under limit
    const gainInput = wsm.app.getByLabel('Input Gain (dB)');
    const splBar = wsm.app.getByTestId('spl-meter-bar');
    await gainInput.fill('32');
    await gainInput.press('Enter');
    await expect(splBar).toHaveClass(/alert-limit/);
    await gainInput.fill('0');
    await gainInput.press('Enter');
    await expect(splBar).not.toHaveClass(/alert-limit|alert-warn/);

    // Capture a stored trace and rename with spaces, 'c', and 'd' (verifying keyboard shortcuts ignore inputs)
    await wsm.captureStoredTrace();
    const storedItems = wsm.app.locator('[data-testid^="source-item-stored-"]');
    await expect(storedItems).toHaveCount(1);

    const nameInput = wsm.app.getByLabel('Stored Trace Name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('');
    await nameInput.pressSequentially('Center Cluster Delayed');
    await expect(nameInput).toHaveValue('Center Cluster Delayed');
    await expect(storedItems).toHaveCount(1);

    // Toggle Live Measurement visibility off and ensure it stays off across incoming frames
    const liveVisibilityCheckbox = wsm.app.getByLabel(
      'Toggle visibility for Live Measurement'
    );
    await expect(liveVisibilityCheckbox).toBeChecked();
    await liveVisibilityCheckbox.uncheck();
    await page.waitForTimeout(150);
    await expect(liveVisibilityCheckbox).not.toBeChecked();

    // Switch layout presets and verify chart panel count & URL query string update
    await wsm.selectLayout('tf-dual');
    await expect(wsm.app.locator('chart-panel')).toHaveCount(2);
    expect(page.url()).toContain('layout=tf-dual');

    // Switch Phase chart coherence masking to Hard Cutoff at >= 70%
    const phasePanel = wsm.chartPanel(1);
    await expect(phasePanel.getByTestId('select-coherence-mode')).toHaveValue('alpha');
    await wsm.setChartCoherence(1, 'cutoff', 0.7);
    await expect(phasePanel.getByTestId('select-coherence-threshold')).toHaveValue('0.7');

    // Add a Virtual Equalizer source with Auto-Flatten and a Math / Union source
    await wsm.addVirtualEq({ autoFlatten: true });
    await wsm.addMathUnion();
    await expect(wsm.app.locator('[data-testid^="source-item-union-"]')).toHaveCount(1);

    // Wait for Service Worker to be ready and controlling the page
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    // Reload the page and verify layout, both Live Measurements, Stored Trace, Virtual EQ, and Math Union persist
    await page.reload();
    await expect(wsm.app.locator('chart-panel')).toHaveCount(2);
    await expect(wsm.app.locator('[data-testid^="source-item-live-"]')).toHaveCount(2);
    await expect(wsm.app.locator('[data-testid^="source-item-stored-"]')).toHaveCount(1);
    await expect(wsm.app.locator('[data-testid^="source-item-eq-"]')).toHaveCount(1);
    await expect(wsm.app.locator('[data-testid^="source-item-union-"]')).toHaveCount(1);
    await expect(
      wsm.app.getByLabel('Toggle visibility for Live Measurement')
    ).not.toBeChecked();

    // Verify offline reload works via Service Worker
    await context.setOffline(true);
    await page.reload();
    await expect(wsm.app.locator('chart-panel')).toHaveCount(2);
    await expect(wsm.app.locator('[data-testid^="source-item-live-"]')).toHaveCount(2);
    await context.setOffline(false);
  });

  test('adapts Live Show Mode across Handheld Phone (< 680px) and Tablet Portrait (820x1180)', async ({
    page,
  }) => {
    const wsm = new WsmPageDriver(page);

    // 1. Handheld Phone Portrait (390 x 844)
    await page.setViewportSize({ width: 390, height: 844 });
    await wsm.goto('/?mode=show');
    await wsm.waitForLiveSignal();

    await expect(wsm.app.getByTestId('mobile-show-shell')).toBeVisible();
    await expect(wsm.app.getByTestId('show-sidebar')).toHaveCount(0);
    await expect(wsm.app.getByTestId('spl-status-badge')).toBeVisible();

    // Spectrum tab mounts exactly 1 <chart-panel> (RTA)
    await expect(wsm.app.getByTestId('mobile-tab-rta')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(wsm.app.locator('chart-panel')).toHaveCount(1);

    // Switch to SPL Trend tab -> still mounts only 1 <chart-panel> (SPL History)
    await wsm.app.getByTestId('mobile-tab-history').click();
    await expect(wsm.app.getByTestId('mobile-tab-history')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(wsm.app.locator('chart-panel')).toHaveCount(1);
    await expect(
      wsm.chartPanel(0).getByTestId('select-spl-window')
    ).toBeVisible();

    // Switch to Rings tab -> unmounts WebGL chart panels and shows Feedback Ring Log card
    await wsm.app.getByTestId('mobile-tab-rings').click();
    await expect(wsm.app.locator('chart-panel')).toHaveCount(0);
    await expect(wsm.app.getByTestId('card-feedback-ring-log')).toBeVisible();

    // Switch to Mics & Cal tab -> shows Live Mics & Limits cards and 1-tap 94 dB SPL Calibration
    await wsm.app.getByTestId('mobile-tab-mics').click();
    await expect(wsm.app.getByTestId('card-live-mics-watch')).toBeVisible();
    await expect(wsm.app.getByTestId('card-show-limits-export')).toBeVisible();

    await wsm.app.getByTestId('btn-show-cal-live-measurement').click();
    await wsm.app.getByRole('button', { name: '94 dB Cal' }).click();
    await expect(wsm.app.getByTestId('spl-main-value')).toContainText('94.', {
      timeout: 3000,
    });

    // 2. Tablet Portrait (820 x 1180) -> Full-width charts stacked over 2-column Show bottom deck
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(wsm.app.getByTestId('mobile-show-shell')).toHaveCount(0);
    await expect(wsm.app.getByTestId('show-sidebar')).toBeVisible();
    await expect(wsm.app.locator('chart-panel')).toHaveCount(2);

    const chartsBox = await wsm.app.locator('.charts-column').boundingBox();
    const sidebarBox = await wsm.app.getByTestId('show-sidebar').boundingBox();
    const micsCardBox = await wsm.app.getByTestId('card-live-mics-watch').boundingBox();
    const ringsCardBox = await wsm.app
      .getByTestId('card-feedback-ring-log')
      .boundingBox();

    expect(chartsBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(micsCardBox).not.toBeNull();
    expect(ringsCardBox).not.toBeNull();
    expect(chartsBox!.y + chartsBox!.height).toBeLessThanOrEqual(sidebarBox!.y + 2);
    expect(micsCardBox!.x + micsCardBox!.width).toBeLessThanOrEqual(ringsCardBox!.x + 2);
  });

  test('recovers cleanly on standalone PWA relaunch when Hardware mode was saved in localStorage', async ({
    page,
  }) => {
    const wsm = new WsmPageDriver(page);
    await wsm.installMockUsbHardwareInterface('usb-ipad-mic', 'iPad USB Mic');

    // First launch: select Hardware input -> saves audioInputMode='hardware' to localStorage
    await wsm.goto('/');
    await wsm.selectInputSource('hardware:usb-ipad-mic');
    await wsm.waitForLiveSignal();

    // Simulate Home Screen PWA relaunch / reload -> starts deferred-paused with visible Resume Mic banner
    await page.reload();
    const banner = wsm.app.getByTestId('audio-status-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Resume Mic');

    // Selecting an input source directly while deferred-paused unpauses and resumes live sound data
    await wsm.selectInputSource('hardware:usb-ipad-mic');
    await expect(banner).toHaveCount(0);
    await wsm.waitForLiveSignal();
  });
});
