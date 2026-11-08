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

