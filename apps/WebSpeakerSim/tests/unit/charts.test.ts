/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  computeAdaptivePlotBounds,
  computeAudienceSplHistogram,
  formatFrequencyLabel,
  normXToValue,
  valueToNormX,
} from '../../src/charts/plot-types.js';
import { getBuiltinSpeakerMap } from '../../src/library/builtin-speakers.js';
import { DEMO_VENUE_PRESETS } from '../../src/library/demo-presets.js';
import { evaluatePlanGrid } from '../../src/physics/summation-solver.js';
import { evaluateVirtualMic } from '../../src/physics/virtual-mic-solver.js';

describe('chart plot-types & SPL histogram', () => {
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

  it('auto-scales Magnitude, Group Delay, Arrivals, and Histogram bounds without clipping peaks', () => {
    const speakerMap = getBuiltinSpeakerMap();
    const scene = DEMO_VENUE_PRESETS[0].createScene();
    // Push drive offset high (+6 dB) so low-end sums above 120 dB SPL
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

    // Single-band 63 Hz sub grid (~127 dB SPL) must fit cleanly inside adaptive histogram bounds
    const subScene = {
      ...hotScene,
      bandSelection: { kind: 'single' as const, frequencyHz: 63 },
    };
    const subGrid = evaluatePlanGrid(subScene, speakerMap, 1.0);
    const histBounds = computeAdaptivePlotBounds('histogram', [micResp], subGrid);
    expect(histBounds.xMin).toBeLessThan(subGrid.stats.minAudienceSplDb);
    expect(histBounds.xMax).toBeGreaterThan(subGrid.stats.maxAudienceSplDb);

    const fittedBins = computeAudienceSplHistogram(subGrid, histBounds.xMin, histBounds.xMax, 2);
    const maxBinPct = Math.max(...fittedBins.map((b) => b.percentage));
    expect(histBounds.yMax).toBeGreaterThanOrEqual(Math.min(100, maxBinPct));
  });
});

