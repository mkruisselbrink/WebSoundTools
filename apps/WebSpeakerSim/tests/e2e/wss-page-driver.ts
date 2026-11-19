// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Typed Playwright UI driver for `<web-speaker-sim-app>`, shared across E2E specs
 * and Retina documentation screenshot generators.
 */

import type { MagnitudeSpanMode } from '@foh/charts';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import type { SimPlotType } from '../../src/charts/wss-chart-adapter.js';
import type {
  ColormapPaletteId,
  ColormapRangeMode,
  IsolineStepDb,
} from '../../src/model/project-store.js';
import type { SubArrayMode } from '../../src/model/project-types.js';
import type { ViewportLayoutMode } from '../../src/model/url-state.js';

export type VenuePresetId =
  | 'club-cardioid-pa'
  | 'festival-endfire-delays'
  | 'theater-raked-balcony';

const CHART_TAB_LABELS: Record<SimPlotType, string> = {
  magnitude: 'Magnitude (dB)',
  phase: 'Phase (°)',
  'group-delay': 'Group Delay',
  arrivals: 'Arrivals',
  histogram: 'SPL Histogram',
};

export class WssPageDriver {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(urlOrPath: string = '/'): Promise<void> {
    await this.page.goto(urlOrPath);
    await this.waitForSimulationReady();
  }

  async waitForSimulationReady(): Promise<void> {
    const metrics = this.page.getByTestId('coverage-metrics');
    await expect(metrics).toBeVisible({ timeout: 8000 });
    await expect(metrics).toContainText('Mean');
    await expect(metrics).toContainText('dB');
  }

  async selectVenuePreset(presetId: VenuePresetId): Promise<void> {
    await this.page.getByTestId('preset-select').selectOption(presetId);
    await this.waitForSimulationReady();
  }

  async selectBand(bandKey: string): Promise<void> {
    await this.page.getByTestId('band-select').selectOption(bandKey);
  }

  async setColormapRange(rangeMode: ColormapRangeMode): Promise<void> {
    await this.page.getByTestId('colormap-range-select').selectOption(rangeMode);
  }

  async setColormapPalette(palette: ColormapPaletteId): Promise<void> {
    await this.page.getByTestId('colormap-palette-select').selectOption(palette);
  }

  async setIsolineStep(stepDb: IsolineStepDb): Promise<void> {
    await this.page.getByTestId('isoline-select').selectOption(String(stepDb));
  }

  async toggleSteppedColormap(): Promise<void> {
    await this.page.getByTestId('btn-colormap-stepped').click();
  }

  async setViewportLayout(mode: ViewportLayoutMode): Promise<void> {
    await this.page.getByTestId(`layout-${mode}`).click();
  }

  async selectChartTab(tab: SimPlotType): Promise<void> {
    await this.page
      .locator('wss-chart-panel')
      .getByRole('button', { name: CHART_TAB_LABELS[tab] })
      .click();
  }

  async setMagnitudeSpan(span: MagnitudeSpanMode): Promise<void> {
    await this.page.getByTestId('chart-mag-span-select').selectOption(span);
  }

  treeRow(prefix: 'ps' | 'sa' | 'grp' | 'surf' | 'mic', id: string): Locator {
    return this.page.getByTestId(`tree-${prefix}-${id}`);
  }

  async selectPointSource(id: string): Promise<void> {
    await this.treeRow('ps', id).click();
  }

  async togglePointSourceMute(id: string): Promise<void> {
    // <foh-entity-tree> renders an explicit aria-label="Toggle <name>" on the row's action button.
    await this.treeRow('ps', id).locator('button').click();
  }

  async selectSubArray(id: string): Promise<void> {
    await this.treeRow('sa', id).click();
  }

  async setSubArrayMode(mode: SubArrayMode): Promise<void> {
    await this.page.getByTestId('sa-mode-select').selectOption(mode);
  }

  async applyQuarterWaveSpacing(): Promise<void> {
    await this.page.getByTestId('btn-sa-quarter-wave').click();
  }

  async selectFirstDspGroup(): Promise<void> {
    await this.page.locator('[data-testid^="tree-grp-"]').first().click();
    await expect(this.page.getByTestId('inspector-dsp-group')).toBeVisible();
  }

  async addEqBand(): Promise<void> {
    await this.page.getByTestId('btn-add-eq-band').click();
  }

  async selectVirtualMic(id: string): Promise<void> {
    await this.treeRow('mic', id).click();
    await expect(this.page.getByTestId('inspector-virtual-mic')).toBeVisible();
  }

  async applyAutoTimeAlignment(options?: {
    referenceGroupId?: string;
    targetGroupId?: string;
  }): Promise<void> {
    if (options?.referenceGroupId) {
      await this.page
        .getByTestId('align-ref-select')
        .selectOption(options.referenceGroupId);
    }
    if (options?.targetGroupId) {
      await this.page
        .getByTestId('align-target-select')
        .selectOption(options.targetGroupId);
    }
    await this.page.getByTestId('btn-apply-alignment').click();
  }

  async exportVirtualMicFrd(savePath: string): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.getByTestId('btn-export-mic-frd').click(),
    ]);
    await download.saveAs(savePath);
    return download;
  }

  async openSpeakerLibraryModal(): Promise<void> {
    await this.page.getByTestId('btn-speaker-library').click();
    await expect(this.page.getByTestId('speaker-library-modal')).toBeVisible();
  }

  async closeSpeakerLibraryModal(): Promise<void> {
    await this.page.getByTestId('btn-close-library-modal').click();
  }
}

