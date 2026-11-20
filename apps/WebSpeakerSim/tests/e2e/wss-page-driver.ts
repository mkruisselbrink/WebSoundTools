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
  PresetDspGroupId,
  PresetPointSourceId,
  PresetSubArrayId,
  PresetSurfaceId,
  PresetVirtualMicId,
  VenuePresetId,
} from '../../src/library/demo-presets.js';
import type {
  ColormapPaletteId,
  ColormapRangeMode,
  IsolineStepDb,
} from '../../src/model/project-store.js';
import type { SubArrayMode } from '../../src/model/project-types.js';
import type { ViewportLayoutMode } from '../../src/model/url-state.js';
import {
  WSS_DYNAMIC_TEST_IDS,
  WSS_TEST_IDS,
  type WssTestId,
} from '../../src/ui/test-ids.ts';
import type { BandOptionKey } from '../../src/ui/topbar/topbar-view.js';

export {
  WSS_TEST_IDS,
  type BandOptionKey,
  type PresetDspGroupId,
  type PresetPointSourceId,
  type PresetSubArrayId,
  type PresetSurfaceId,
  type PresetVirtualMicId,
  type VenuePresetId,
  type WssTestId,
};

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

  byTestId(id: WssTestId): Locator {
    return this.page.getByTestId(id);
  }

  async goto(urlOrPath: string = '/'): Promise<void> {
    await this.page.goto(urlOrPath);
    await this.waitForSimulationReady();
  }

  async waitForSimulationReady(): Promise<void> {
    const metrics = this.byTestId(WSS_TEST_IDS.coverageMetrics);
    await expect(metrics).toBeVisible({ timeout: 8000 });
    await expect(metrics).toContainText('Mean');
    await expect(metrics).toContainText('dB');
  }

  async selectVenuePreset(presetId: VenuePresetId): Promise<void> {
    const sel = this.byTestId(WSS_TEST_IDS.presetSelect);
    if (!(await sel.isVisible())) {
      await this.byTestId(WSS_TEST_IDS.scenePopoverBtn).click();
      await expect(sel).toBeVisible();
    }
    await sel.selectOption(presetId);
    if (await sel.isVisible()) {
      await this.byTestId(WSS_TEST_IDS.scenePopoverBtn).click();
    }
    await this.waitForSimulationReady();
  }

  async selectBand(bandKey: BandOptionKey): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.bandSelect).selectOption(bandKey);
  }

  private async withHeatmapPopover(fn: () => Promise<void>): Promise<void> {
    const sel = this.byTestId(WSS_TEST_IDS.colormapRangeSelect);
    const openedHere = !(await sel.isVisible());
    if (openedHere) {
      await this.byTestId(WSS_TEST_IDS.heatmapPopoverBtn).click();
      await expect(sel).toBeVisible();
    }
    await fn();
    if (openedHere && (await sel.isVisible())) {
      await this.byTestId(WSS_TEST_IDS.heatmapPopoverBtn).click();
    }
  }

  async setColormapRange(rangeMode: ColormapRangeMode): Promise<void> {
    await this.withHeatmapPopover(async () => {
      await this.byTestId(WSS_TEST_IDS.colormapRangeSelect).selectOption(rangeMode);
    });
  }

  async setColormapPalette(palette: ColormapPaletteId): Promise<void> {
    await this.withHeatmapPopover(async () => {
      await this.byTestId(WSS_TEST_IDS.colormapPaletteSelect).selectOption(palette);
    });
  }

  async setIsolineStep(stepDb: IsolineStepDb): Promise<void> {
    await this.withHeatmapPopover(async () => {
      await this.byTestId(WSS_TEST_IDS.isolineSelect).selectOption(String(stepDb));
    });
  }

  async toggleSteppedColormap(): Promise<void> {
    await this.withHeatmapPopover(async () => {
      await this.byTestId(WSS_TEST_IDS.colormapSteppedBtn).click();
    });
  }

  async setViewportLayout(mode: ViewportLayoutMode): Promise<void> {
    const id: WssTestId =
      mode === 'split'
        ? WSS_TEST_IDS.layoutSplitBtn
        : mode === 'plan'
          ? WSS_TEST_IDS.layoutPlanBtn
          : WSS_TEST_IDS.layoutSectionBtn;
    await this.byTestId(id).click();
  }

  async selectChartTab(tab: SimPlotType): Promise<void> {
    await this.page
      .locator('wss-chart-panel')
      .getByRole('tab', { name: CHART_TAB_LABELS[tab] })
      .click();
  }

  async setMagnitudeSpan(span: MagnitudeSpanMode): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.chartMagSpanSelect).selectOption(span);
  }

  treeRow(prefix: 'ps' | 'sa' | 'grp' | 'surf' | 'mic', id: string): Locator {
    return this.page.getByTestId(WSS_DYNAMIC_TEST_IDS.treeRow(prefix, id));
  }

  async selectPointSource(id: PresetPointSourceId): Promise<void> {
    await this.treeRow('ps', id).click();
  }

  async togglePointSourceMute(id: PresetPointSourceId): Promise<void> {
    await this.treeRow('ps', id).locator('button.foh-tree-toggle-btn').click();
  }

  async selectSubArray(id: PresetSubArrayId): Promise<void> {
    await this.treeRow('sa', id).click();
  }

  async setSubArrayMode(mode: SubArrayMode): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.saModeSelect).selectOption(mode);
  }

  async applyQuarterWaveSpacing(): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.saQuarterWaveBtn).click();
  }

  async selectFirstDspGroup(): Promise<void> {
    await this.page.locator('[data-testid^="tree-grp-"]').first().click();
    await expect(this.byTestId(WSS_TEST_IDS.dspGroupInspector)).toBeVisible();
  }

  async addEqBand(): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.addEqBandBtn).click();
  }

  async selectVirtualMic(id: PresetVirtualMicId): Promise<void> {
    await this.treeRow('mic', id).click();
    await expect(this.byTestId(WSS_TEST_IDS.virtualMicInspector)).toBeVisible();
  }

  async applyAutoTimeAlignment(options?: {
    referenceGroupId?: PresetDspGroupId;
    targetGroupId?: PresetDspGroupId;
  }): Promise<void> {
    if (options?.referenceGroupId) {
      await this.byTestId(WSS_TEST_IDS.alignRefSelect).selectOption(options.referenceGroupId);
    }
    if (options?.targetGroupId) {
      await this.byTestId(WSS_TEST_IDS.alignTargetSelect).selectOption(options.targetGroupId);
    }
    await this.byTestId(WSS_TEST_IDS.applyAlignmentBtn).click();
  }

  async exportVirtualMicFrd(savePath: string): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.byTestId(WSS_TEST_IDS.exportMicFrdBtn).click(),
    ]);
    await download.saveAs(savePath);
    return download;
  }

  async openSpeakerLibraryModal(): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.speakerLibraryBtn).click();
    await expect(this.byTestId(WSS_TEST_IDS.speakerLibraryModal)).toBeVisible();
  }

  async closeSpeakerLibraryModal(): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.closeLibraryModalBtn).click();
  }

  async selectSurface(id: PresetSurfaceId): Promise<void> {
    await this.treeRow('surf', id).click();
    await expect(this.byTestId(WSS_TEST_IDS.surfaceInspector)).toBeVisible();
  }

  async selectEnvironment(): Promise<void> {
    await this.byTestId(WSS_TEST_IDS.treeEnvironment).click();
    await expect(this.byTestId(WSS_TEST_IDS.environmentInspector)).toBeVisible();
  }

  async dismissToast(): Promise<void> {
    await this.page.evaluate(() => {
      const app = document.querySelector('web-speaker-sim-app') as unknown as {
        toastMessage?: string;
        requestUpdate?: () => void;
      } | null;
      if (app) {
        app.toastMessage = '';
        app.requestUpdate?.();
      }
    });
  }

  async dragAcousticRulerOnPlan(
    fromNorm: { readonly x: number; readonly y: number },
    toNorm: { readonly x: number; readonly y: number }
  ): Promise<void> {
    const vp = this.byTestId(WSS_TEST_IDS.viewportPlan).locator('.canvas-stage');
    const box = await vp.boundingBox();
    if (!box) return;
    const x0 = box.x + box.width * fromNorm.x;
    const y0 = box.y + box.height * fromNorm.y;
    const x1 = box.x + box.width * toNorm.x;
    const y1 = box.y + box.height * toNorm.y;

    await this.page.keyboard.down('Shift');
    await this.page.mouse.move(x0, y0);
    await this.page.mouse.down();
    await this.page.mouse.move(x1, y1, { steps: 8 });
  }

  async releaseAcousticRuler(): Promise<void> {
    await this.page.mouse.up();
    await this.page.keyboard.up('Shift');
  }
}
