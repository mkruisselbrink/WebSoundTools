// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Typed Playwright UI driver for `<web-sound-meter-app>`, shared across E2E specs
 * and Retina documentation screenshot generators.
 */

import type { CoherenceBlankingMode } from '@foh/charts';
import type { CrossoverTopology } from '@foh/dsp';
import { expect, type Locator, type Page } from '@playwright/test';
import type { PlotType } from '../../src/charts/plot-types.js';
import type { SimulatorPresetId } from '../../src/dsp/synthetic-rig.js';
import type { UnionOperation } from '../../src/sources/union-source.js';
import type { WorkspaceMode } from '../../src/ui/url-state.js';
import type { LayoutPreset } from '../../src/ui/workspace-store.js';

export class WsmPageDriver {
  readonly page: Page;
  readonly app: Locator;

  constructor(page: Page) {
    this.page = page;
    this.app = page.locator('web-sound-meter-app');
  }

  async goto(urlOrPath: string = '/'): Promise<void> {
    await this.page.goto(urlOrPath);
    await expect(this.app).toBeVisible();
  }

  async waitForLiveSignal(): Promise<void> {
    const splValue = this.app.getByTestId('spl-main-value');
    await expect(splValue).not.toHaveText('0.0', { timeout: 6000 });
  }

  async installMockUsbHardwareInterface(
    deviceId: string = 'usb-4ch-interface',
    label: string = 'Focusrite Scarlett 4i4 USB (4ch)'
  ): Promise<void> {
    await this.page.addInitScript(
      ({ id, name }) => {
        if (navigator.mediaDevices) {
          navigator.mediaDevices.enumerateDevices = async () =>
            [
              {
                deviceId: id,
                kind: 'audioinput',
                label: name,
                groupId: 'grp-usb',
                toJSON() {
                  return this;
                },
              },
              {
                deviceId: 'default',
                kind: 'audiooutput',
                label: `${name} Out`,
                groupId: 'grp-usb',
                toJSON() {
                  return this;
                },
              },
            ] as MediaDeviceInfo[];
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
      },
      { id: deviceId, name: label }
    );
  }

  async setMode(mode: WorkspaceMode): Promise<void> {
    await this.app
      .getByTestId(mode === 'show' ? 'btn-mode-show' : 'btn-mode-tuning')
      .click();
  }

  async selectLayout(layout: LayoutPreset): Promise<void> {
    await this.app.getByTestId('select-layout').selectOption(layout);
  }

  async selectInputSource(optionValue: string): Promise<void> {
    await this.app.getByTestId('select-input-mode').selectOption(optionValue);
  }

  chartPanel(index: number): Locator {
    return this.app.getByTestId(`chart-panel-${index}`);
  }

  async setChartPlotType(panelIndex: number, plotType: PlotType): Promise<void> {
    await this.chartPanel(panelIndex).locator('select').first().selectOption(plotType);
  }

  async setChartCoherence(
    panelIndex: number,
    mode: CoherenceBlankingMode,
    threshold?: number
  ): Promise<void> {
    const panel = this.chartPanel(panelIndex);
    await panel.getByTestId('select-coherence-mode').selectOption(mode);
    if (mode !== 'off' && threshold !== undefined) {
      await panel
        .getByTestId('select-coherence-threshold')
        .selectOption(String(threshold));
    }
  }

  async selectLiveSlotPreset(preset: SimulatorPresetId): Promise<void> {
    await this.app.getByTestId('select-live-slot-preset').selectOption(preset);
  }

  async setReferenceDelayMs(delayMs: number): Promise<void> {
    const input = this.app.getByTestId('input-ref-delay-ms');
    await input.fill(String(delayMs));
    await input.dispatchEvent('change');
  }

  async applyAutoDelay(): Promise<void> {
    await this.app.getByTestId('btn-apply-delay').click();
  }

  async toggleAdvancedMeasurementSettings(): Promise<void> {
    await this.app.getByTestId('btn-toggle-advanced-meas').click();
  }

  async addLiveMeasurement(name?: string): Promise<void> {
    await this.app.getByTestId('btn-add-meas').click();
    if (name !== undefined) {
      const input = this.app.getByTestId('input-live-slot-name');
      await expect(input).toBeVisible();
      await input.fill(name);
      await input.dispatchEvent('change');
    }
  }

  async captureStoredTrace(renameTo?: string): Promise<void> {
    await this.app.getByTestId('btn-capture-trace').click();
    if (renameTo !== undefined) {
      const nameInput = this.app.getByLabel('Stored Trace Name');
      await expect(nameInput).toBeVisible();
      await nameInput.fill(renameTo);
      await nameInput.dispatchEvent('change');
    }
  }

  async importFrdFile(filePath: string): Promise<void> {
    await this.app.getByTestId('input-import-frd').setInputFiles(filePath);
  }

  async uploadCalibrationText(fileName: string, content: string): Promise<void> {
    await this.app.locator('input[type="file"][accept=".cal,.txt,.frd"]').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(content, 'utf8'),
    });
  }

  async addVirtualEq(options?: {
    autoFlatten?: boolean;
    hpfTopology?: CrossoverTopology;
  }): Promise<void> {
    await this.app.getByTestId('btn-add-eq').click();
    if (options?.autoFlatten) {
      const btn = this.app.getByTestId('btn-auto-flatten-eq');
      await expect(btn).toBeVisible();
      await btn.click();
    }
    if (options?.hpfTopology) {
      const eqInspector = this.app.getByTestId('inspector-eq-source');
      await eqInspector.locator('select').nth(1).selectOption(options.hpfTopology);
    }
  }

  async addMathUnion(options?: {
    operation?: UnionOperation;
    sourceAPattern?: RegExp;
    sourceBPattern?: RegExp;
  }): Promise<void> {
    await this.app.getByTestId('btn-add-union').click();
    const unionCard = this.app.getByTestId('inspector-union-source');
    await expect(unionCard).toBeVisible();

    if (options?.operation) {
      await unionCard.getByLabel('Union Math Operation').selectOption(options.operation);
    }
    if (options?.sourceAPattern) {
      await this.selectOptionMatching(
        unionCard.getByLabel('Union Source A'),
        options.sourceAPattern
      );
    }
    if (options?.sourceBPattern) {
      await this.selectOptionMatching(
        unionCard.getByLabel('Union Source B'),
        options.sourceBPattern
      );
    }
  }

  async addShowLiveMic(): Promise<void> {
    await this.app.getByTestId('btn-show-add-meas').click();
  }

  async selectShowSlotPreset(slotIndex: number, preset: SimulatorPresetId): Promise<void> {
    await this.app
      .locator('[data-testid^="select-show-sim-preset-"]')
      .nth(slotIndex)
      .selectOption(preset);
  }

  async setShowSplThresholds(warningDb: number, limitDb: number): Promise<void> {
    const warnInput = this.app.getByTestId('input-spl-warn-db');
    const limitInput = this.app.getByTestId('input-spl-limit-db');
    await warnInput.fill(String(warningDb));
    await warnInput.dispatchEvent('change');
    await limitInput.fill(String(limitDb));
    await limitInput.dispatchEvent('change');
  }

  private async selectOptionMatching(selectLocator: Locator, pattern: RegExp): Promise<void> {
    const options = await selectLocator.locator('option').evaluateAll((els) =>
      els.map((el) => ({
        value: (el as HTMLOptionElement).value,
        text: el.textContent?.trim() ?? '',
      }))
    );
    const match = options.find((o) => pattern.test(o.text));
    if (match) {
      await selectLocator.selectOption(match.value);
    }
  }
}

