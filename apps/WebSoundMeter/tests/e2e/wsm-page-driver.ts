// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Typed Playwright UI driver for `<web-sound-meter-app>`, shared across E2E specs
 * and Retina documentation screenshot generators.
 */

import type { CoherenceBlankingMode } from '@foh/charts';
import type { CrossoverTopology, OctaveSmoothingType } from '@foh/dsp';
import { expect, type Locator, type Page } from '@playwright/test';
import type { PlotType } from '../../src/charts/plot-types.js';
import type { SimulatorPresetId } from '../../src/dsp/synthetic-rig.js';
import type { UnionOperation } from '../../src/sources/union-source.js';
import {
  WSM_DYNAMIC_TEST_IDS,
  WSM_TEST_IDS,
  type WsmTestId,
} from '../../src/ui/test-ids.ts';
import type { WorkspaceMode } from '../../src/ui/url-state.js';
import type { LayoutPreset } from '../../src/ui/workspace-store.js';

export { WSM_TEST_IDS, type WsmTestId };

export class WsmPageDriver {
  readonly page: Page;
  readonly app: Locator;

  constructor(page: Page) {
    this.page = page;
    this.app = page.locator('web-sound-meter-app');
  }

  byTestId(id: WsmTestId): Locator {
    return this.app.getByTestId(id);
  }

  async goto(urlOrPath: string = '/'): Promise<void> {
    await this.page.goto(urlOrPath);
    await expect(this.app).toBeVisible();
  }

  async waitForLiveSignal(): Promise<void> {
    const splValue = this.byTestId(WSM_TEST_IDS.splMainValue);
    await expect(splValue).not.toHaveText('0.0', { timeout: 6000 });
    await this.waitForFrames(8);
  }

  async waitForUiSettled(): Promise<void> {
    await this.page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const flushLit = async (root: ParentNode): Promise<void> => {
        const els = Array.from(root.querySelectorAll('*'));
        for (const el of els) {
          const litEl = el as Element & { updateComplete?: Promise<boolean> };
          if (litEl.updateComplete) {
            await litEl.updateComplete;
          }
          if (el.shadowRoot) {
            await flushLit(el.shadowRoot);
          }
        }
      };
      await flushLit(document);
      await flushLit(document);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
  }

  async waitForFrames(count: number = 10, timeoutMs: number = 4000): Promise<void> {
    if (count > 0) {
      await this.page.evaluate(
        ({ targetCount, maxWaitMs }) =>
          new Promise<void>((resolve) => {
            const app = document.querySelector('web-sound-meter-app') as unknown as {
              audio?: { isPaused?: boolean };
              sourceStore?: {
                subscribe?: (fn: (kind: string) => void) => () => void;
              };
            } | null;
            if (!app?.sourceStore?.subscribe || app.audio?.isPaused) {
              resolve();
              return;
            }
            let seen = 0;
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              unsub();
              resolve();
            };
            const unsub = app.sourceStore.subscribe((kind) => {
              if (kind === 'live') {
                seen++;
                if (seen >= targetCount) {
                  finish();
                }
              }
            });
            const timer = setTimeout(finish, maxWaitMs);
          }),
        { targetCount: count, maxWaitMs: timeoutMs }
      );
    }
    await this.waitForUiSettled();
  }

  async waitForFeedbackRing(minCount: number = 1, timeoutMs: number = 6000): Promise<void> {
    await expect
      .poll(
        async () =>
          this.app
            .locator(
              '[data-testid^="ring-log-item-"], [data-testid="mobile-ring-alert-banner"]'
            )
            .count(),
        { timeout: timeoutMs }
      )
      .toBeGreaterThanOrEqual(minCount);
    await this.waitForFrames(4);
  }

  async installMockUsbHardwareInterface(
    deviceId: string = 'usb-4ch-interface',
    label: string = 'Focusrite Scarlett 4i4 USB (4ch)',
    options?: { readonly withFeedbackRings?: boolean }
  ): Promise<void> {
    const withRings = Boolean(options?.withFeedbackRings);
    await this.page.addInitScript(
      ({ id, name, injectRings }) => {
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
            dest.channelCountMode = 'explicit';

            // Deterministic 2-second pink noise buffer for correlated M/R hardware loopback
            const len = ac.sampleRate * 2;
            const buf = ac.createBuffer(1, len, ac.sampleRate);
            const data = buf.getChannelData(0);
            let seed = 0x2468ace1;
            let b0 = 0;
            let b1 = 0;
            let b2 = 0;
            for (let i = 0; i < len; i++) {
              seed ^= seed << 13;
              seed ^= seed >>> 17;
              seed ^= seed << 5;
              const white = (seed >>> 0) / 2147483648.0 - 1.0;
              b0 = 0.99765 * b0 + white * 0.099046;
              b1 = 0.96300 * b1 + white * 0.2965164;
              b2 = 0.57000 * b2 + white * 1.0526913;
              data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.065;
            }

            const noiseSrc = ac.createBufferSource();
            noiseSrc.buffer = buf;
            noiseSrc.loop = true;

            const delayM = ac.createDelay(0.05);
            delayM.delayTime.value = 0.0062;
            const roomBoom = ac.createBiquadFilter();
            roomBoom.type = 'peaking';
            roomBoom.frequency.value = 175;
            roomBoom.Q.value = 2.0;
            roomBoom.gain.value = 4.5;
            const airShelf = ac.createBiquadFilter();
            airShelf.type = 'highshelf';
            airShelf.frequency.value = 9000;
            airShelf.gain.value = -3.5;

            const merger = ac.createChannelMerger(4);
            // Ch 1 (index 0): Measurement Mic M; Ch 2 (index 1): Loopback Reference R
            noiseSrc.connect(delayM).connect(roomBoom).connect(airShelf).connect(merger, 0, 0);
            noiseSrc.connect(merger, 0, 1);

            if (injectRings) {
              const osc1 = ac.createOscillator();
              const g1 = ac.createGain();
              osc1.frequency.value = 2480;
              g1.gain.value = 0.085;
              osc1.connect(g1).connect(merger, 0, 0);
              osc1.start();

              const osc2 = ac.createOscillator();
              const g2 = ac.createGain();
              osc2.frequency.value = 630;
              g2.gain.value = 0.065;
              osc2.connect(g2).connect(merger, 0, 0);
              osc2.start();
            }

            merger.connect(dest);
            noiseSrc.start();
            (
              window as unknown as { __wstLastMockStream?: MediaStream }
            ).__wstLastMockStream = dest.stream;
            return dest.stream;
          };
        }
      },
      { id: deviceId, name: label, injectRings: withRings }
    );
  }

  async installSeededShowSplHistory(options?: {
    readonly slotIds?: readonly string[];
    readonly baseSplDbA?: number;
  }): Promise<void> {
    const slotIds = options?.slotIds ?? ['live-measurement'];
    const baseSpl = options?.baseSplDbA ?? 94.5;
    await this.page.addInitScript(
      ({ ids, centerDb }) => {
        const flagKey = '__wst_seeded_spl_v1';
        if (sessionStorage.getItem(flagKey)) return;
        sessionStorage.setItem(flagKey, '1');

        const req = indexedDB.open('web-sound-meter-db', 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of [
            'stored-traces',
            'eq-sources',
            'union-sources',
            'calibration-curves',
            'spl-show-logs',
          ]) {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, { keyPath: 'id' });
            }
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('spl-show-logs', 'readwrite');
          const store = tx.objectStore('spl-show-logs');
          const n = 900;
          const nowMs = Date.now();
          ids.forEach((slotId, slotIdx) => {
            const slotOffset = slotIdx * -4.2;
            const energyA: number[] = new Array(n);
            const energyC: number[] = new Array(n);
            const energyZ: number[] = new Array(n);
            const shortTermDbA: number[] = new Array(n);
            const shortTermDbC: number[] = new Array(n);
            const peakDb: number[] = new Array(n);

            for (let i = 0; i < n; i++) {
              // Concert dynamics arc: warm-up -> verse/chorus swells -> interlude dip -> headliner push
              const prog = i / n;
              const songWave = Math.sin(i * 0.045) * 2.4 + Math.cos(i * 0.13) * 1.3;
              const setArc =
                prog < 0.25
                  ? -3.5 + prog * 12
                  : prog > 0.55 && prog < 0.68
                    ? -4.0
                    : prog >= 0.68
                      ? 1.2 + (prog - 0.68) * 6.5
                      : 0.2;
              const dbA = centerDb + slotOffset + setArc + songWave;
              const dbC = dbA + 11.8 + Math.sin(i * 0.07) * 1.1;
              const pk = dbC + 8.5 + Math.abs(Math.sin(i * 0.29)) * 3.2;

              shortTermDbA[i] = dbA;
              shortTermDbC[i] = dbC;
              peakDb[i] = pk;
              energyA[i] = Math.pow(10, (dbA - 100) / 10);
              energyC[i] = Math.pow(10, (dbC - 100) / 10);
              energyZ[i] = Math.pow(10, (dbC + 0.8 - 100) / 10);
            }

            store.put({
              id: slotId,
              savedAtMs: nowMs,
              sampleRate: 48000,
              splOffsetDb: 100,
              tierBCount: n,
              tierBHead: n,
              energyA,
              energyC,
              energyZ,
              shortTermDbA,
              shortTermDbC,
              peakDb,
            });
          });
        };
      },
      { ids: [...slotIds], centerDb: baseSpl }
    );
  }

  async setMode(mode: WorkspaceMode): Promise<void> {
    await this.byTestId(
      mode === 'show' ? WSM_TEST_IDS.modeShowBtn : WSM_TEST_IDS.modeTuningBtn
    ).click();
  }

  async selectLayout(layout: LayoutPreset): Promise<void> {
    const sel = this.byTestId(WSM_TEST_IDS.layoutSelect);
    if (!(await sel.isVisible())) {
      await this.byTestId(WSM_TEST_IDS.layoutPopoverBtn).click();
      await expect(sel).toBeVisible();
    }
    await sel.selectOption(layout);
    if (await sel.isVisible()) {
      await this.byTestId(WSM_TEST_IDS.layoutPopoverBtn).click();
    }
  }

  async selectInputSource(optionValue: string): Promise<void> {
    const sel = this.byTestId(WSM_TEST_IDS.inputModeSelect);
    const openedHere = !(await sel.isVisible());
    if (openedHere) {
      await this.byTestId(WSM_TEST_IDS.ioPopoverBtn).click();
      await expect(sel).toBeVisible();
    }
    await sel.selectOption(optionValue);
    if (openedHere && (await sel.isVisible())) {
      await this.byTestId(WSM_TEST_IDS.ioPopoverBtn).click();
    }
  }

  async toggleGenerator(): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.generatorToggleBtn).click();
  }

  chartPanel(index: number): Locator {
    return this.app.getByTestId(WSM_DYNAMIC_TEST_IDS.chartPanel(index));
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
    await panel.getByTestId(WSM_TEST_IDS.coherenceModeSelect).selectOption(mode);
    if (mode !== 'off' && threshold !== undefined) {
      await panel
        .getByTestId(WSM_TEST_IDS.coherenceThresholdSelect)
        .selectOption(String(threshold));
    }
  }

  async selectLiveSlotPreset(preset: SimulatorPresetId): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.liveSlotPresetSelect).selectOption(preset);
  }

  async setReferenceDelayMs(delayMs: number): Promise<void> {
    const input = this.byTestId(WSM_TEST_IDS.refDelayMsInput);
    await input.fill(String(delayMs));
    await input.dispatchEvent('change');
  }

  async applyAutoDelay(): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.applyDelayBtn).click();
  }

  async toggleAdvancedMeasurementSettings(): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.toggleAdvancedMeasBtn).click();
  }

  async setOctaveSmoothing(smoothing: OctaveSmoothingType): Promise<void> {
    const advBtn = this.byTestId(WSM_TEST_IDS.toggleAdvancedMeasBtn);
    const expanded = await advBtn.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await advBtn.click();
    }
    await this.byTestId(WSM_TEST_IDS.smoothingSelect).selectOption(smoothing);
    if (expanded !== 'true') {
      await advBtn.click();
    }
  }

  async setSourceVisibilityByName(name: string, visible: boolean): Promise<void> {
    const checkbox = this.app.getByLabel(`Toggle visibility for ${name}`);
    if (visible) {
      await checkbox.check();
    } else {
      await checkbox.uncheck();
    }
  }

  async addLiveMeasurement(name?: string): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.addMeasBtn).click();
    if (name !== undefined) {
      const input = this.byTestId(WSM_TEST_IDS.liveSlotNameInput);
      await expect(input).toBeVisible();
      await input.fill(name);
      await input.dispatchEvent('change');
    }
  }

  async captureStoredTrace(renameTo?: string): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.captureTraceBtn).click();
    if (renameTo !== undefined) {
      const nameInput = this.app.getByLabel('Stored Trace Name');
      await expect(nameInput).toBeVisible();
      await nameInput.fill(renameTo);
      await nameInput.dispatchEvent('change');
    }
  }

  async importFrdFile(filePath: string): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.importFrdInput).setInputFiles(filePath);
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
    await this.byTestId(WSM_TEST_IDS.addEqBtn).click();
    if (options?.autoFlatten) {
      const btn = this.byTestId(WSM_TEST_IDS.autoFlattenEqBtn);
      await expect(btn).toBeVisible();
      await btn.click();
    }
    if (options?.hpfTopology) {
      const eqInspector = this.byTestId(WSM_TEST_IDS.eqSourceInspector);
      await eqInspector.getByTestId(WSM_TEST_IDS.eqHpfTopology).selectOption(options.hpfTopology);
    }
  }

  async addMathUnion(options?: {
    operation?: UnionOperation;
    sourceAPattern?: RegExp;
    sourceBPattern?: RegExp;
    sourcePatterns?: readonly RegExp[];
  }): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.addUnionBtn).click();
    const unionCard = this.byTestId(WSM_TEST_IDS.unionSourceInspector);
    await expect(unionCard).toBeVisible();

    if (options?.operation) {
      await unionCard.getByLabel('Union Math Operation').selectOption(options.operation);
    }

    const isBinary =
      options?.operation === 'diff-db' ||
      options?.operation === 'subtract' ||
      options?.operation === 'apply';

    if (isBinary) {
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
    } else if (options?.sourcePatterns && options.sourcePatterns.length > 0) {
      const rows = unionCard.locator('.union-check-row');
      const count = await rows.count();
      // First check all matching rows so at least 1 stays checked before unchecking non-matches
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = (await row.textContent())?.trim() ?? '';
        if (options.sourcePatterns.some((p) => p.test(text))) {
          await row.locator('input[type="checkbox"]').check();
        }
      }
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = (await row.textContent())?.trim() ?? '';
        if (!options.sourcePatterns.some((p) => p.test(text))) {
          await row.locator('input[type="checkbox"]').uncheck();
        }
      }
    } else if (options?.sourceBPattern) {
      const rows = unionCard.locator('.union-check-row');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = (await row.textContent())?.trim() ?? '';
        if (options.sourceBPattern.test(text)) {
          await row.locator('input[type="checkbox"]').check();
        }
      }
    }
  }

  async addShowLiveMic(): Promise<void> {
    await this.byTestId(WSM_TEST_IDS.showAddMeasBtn).click();
  }

  async selectShowSlotPreset(slotIndex: number, preset: SimulatorPresetId): Promise<void> {
    await this.app
      .locator('[data-testid^="select-show-sim-preset-"]')
      .nth(slotIndex)
      .selectOption(preset);
  }

  async setShowSplThresholds(warningDb: number, limitDb: number): Promise<void> {
    const warnInput = this.byTestId(WSM_TEST_IDS.splWarnDbInput);
    const limitInput = this.byTestId(WSM_TEST_IDS.splLimitDbInput);
    await warnInput.fill(String(warningDb));
    await warnInput.dispatchEvent('change');
    await limitInput.fill(String(limitDb));
    await limitInput.dispatchEvent('change');
  }

  async openMixerWatchModal(fromMode: WorkspaceMode = 'tuning'): Promise<Locator> {
    const btnId =
      fromMode === 'show'
        ? WSM_TEST_IDS.openMixerWatchBtn
        : WSM_TEST_IDS.tuningMixerWatchBtn;
    await this.byTestId(btnId).click();
    await expect(this.byTestId(WSM_TEST_IDS.mixerWatchModal)).toBeVisible();
    return this.app.locator('foh-modal.mixer-watch-modal-host');
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

