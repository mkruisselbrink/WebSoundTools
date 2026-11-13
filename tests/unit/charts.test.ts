/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  computeAudienceSplHistogram,
  formatFrequencyLabel,
  normXToValue,
  valueToNormX,
} from '../../src/charts/plot-types.js';
import { getBuiltinSpeakerMap } from '../../src/library/builtin-speakers.js';
import { DEMO_VENUE_PRESETS } from '../../src/library/demo-presets.js';
import { evaluatePlanGrid } from '../../src/physics/summation-solver.js';

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
});

