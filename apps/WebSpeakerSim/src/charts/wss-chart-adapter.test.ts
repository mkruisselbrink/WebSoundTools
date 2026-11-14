// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { getBuiltinSpeakerMap } from '../library/builtin-speakers.js';
import { DEMO_VENUE_PRESETS } from '../library/demo-presets.js';
import { evaluatePlanGrid } from '../physics/summation-solver.js';
import { evaluateVirtualMic } from '../physics/virtual-mic-solver.js';
import {
  buildWssChartScene,
  buildWssCursorReadoutModel,
  computeAdaptivePlotBounds,
  computeAudienceSplHistogram,
  formatFrequencyLabel,
  normXToValue,
  valueToNormX,
} from './wss-chart-adapter.js';

describe('wss-chart-adapter & SPL histogram', () => {
  it('round-trips logarithmic and linear X-axis mappings', () => {
    const nxLog = valueToNormX(1000, 20, 20000, true);
    expect(normXToValue(nxLog, 20, 20000, true)).toBeCloseTo(1000, 4);

    const nxLin = valueToNormX(45, 0, 120, false);
    expect(normXToValue(nxLin, 0, 120, false)).toBeCloseTo(45, 4);

    expect(formatFrequencyLabel(1000)).toBe('1k');
    expect(formatFrequencyLabel(250)).toBe('250');
  });

  it('computes Audience SPL histogram summing to 100% across audience cells', () => {
    const scene = DEMO_VENUE_PRESETS[0].createScene();
    const grid = evaluatePlanGrid(scene, getBuiltinSpeakerMap(), 1.0);
    const hist = computeAudienceSplHistogram(grid, 60, 130, 2);
    const sumPct = hist.reduce((acc, b) => acc + b.percentage, 0);
    expect(sumPct).toBeCloseTo(100, 3);
  });

  it('auto-scales Magnitude, Group Delay, Arrivals, and Histogram bounds and builds interactive EQ scene', () => {
    const speakerMap = getBuiltinSpeakerMap();
    const scene = DEMO_VENUE_PRESETS[0].createScene();
    const hotScene = { ...scene, driveOffsetDb: 6 };
    const micResp = evaluateVirtualMic(hotScene.virtualMics[0], hotScene, speakerMap);
    const maxMag = Math.max(...micResp.magnitudeDbSpl);

    const magBounds = computeAdaptivePlotBounds('magnitude', [micResp], null, 'auto-60');
    expect(magBounds.yMax).toBeGreaterThanOrEqual(maxMag + 4);
    expect(magBounds.yMax - magBounds.yMin).toBe(60);

    const magZoomBounds = computeAdaptivePlotBounds('magnitude', [micResp], null, 'auto-30');
    expect(magZoomBounds.yMax - magZoomBounds.yMin).toBe(30);

    const arrBounds = computeAdaptivePlotBounds('arrivals', [micResp], null);
    const maxArrSpl = Math.max(...micResp.arrivals.map((a) => a.levelDbSpl));
    const maxArrTime = Math.max(...micResp.arrivals.map((a) => a.arrivalTimeMs));
    expect(arrBounds.yMax).toBeGreaterThan(maxArrSpl);
    expect(arrBounds.xMax).toBeGreaterThan(maxArrTime);

    const subScene = {
      ...hotScene,
      bandSelection: { kind: 'single' as const, frequencyHz: 63 },
    };
    const subGrid = evaluatePlanGrid(subScene, speakerMap, 1.0);
    const histBounds = computeAdaptivePlotBounds('histogram', [micResp], subGrid);
    expect(histBounds.xMin).toBeLessThan(subGrid.stats.minAudienceSplDb);
    expect(histBounds.xMax).toBeGreaterThan(subGrid.stats.maxAudienceSplDb);

    // Verify interactive EQ overlay when a DSP Group is selected on Magnitude
    const dspGroup = {
      ...hotScene.dspGroups[0],
      dsp: {
        ...hotScene.dspGroups[0].dsp,
        eqBands: [
          {
            id: 'eq1',
            type: 'peaking' as const,
            frequencyHz: 1000,
            q: 2,
            gainDb: -3,
            enabled: true,
          },
        ],
      },
    };
    const chartScene = buildWssChartScene({
      plotType: 'magnitude',
      magSpanMode: 'auto-60',
      mics: hotScene.virtualMics,
      responses: [micResp],
      planGrid: subGrid,
      activeDspGroup: dspGroup,
    });
    expect(chartScene.traces?.length).toBe(1);
    expect(chartScene.eqOverlay).toBeDefined();
    expect(chartScene.eqOverlay?.referenceZeroDbY).toBeGreaterThan(60);

    const cursor = buildWssCursorReadoutModel(
      'magnitude',
      1000,
      hotScene.virtualMics,
      [micResp],
      subGrid,
      chartScene.axis.bounds
    );
    expect(cursor.headerText).toContain('1.00 kHz');
    expect(cursor.rows.length).toBe(1);
  });
});
