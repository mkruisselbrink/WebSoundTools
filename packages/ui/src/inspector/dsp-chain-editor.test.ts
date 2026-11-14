// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_SOURCE_DSP_CONFIG } from '@foh/dsp';
import { describe, expect, it, vi } from 'vitest';
import {
  CROSSOVER_TOPOLOGY_OPTIONS,
  EQ_FILTER_TYPE_OPTIONS,
  renderDspChainEditor,
} from './dsp-chain-editor.js';

describe('dsp-chain-editor', () => {
  it('exposes full crossover topologies and biquad filter types and builds Lit templates', () => {
    expect(CROSSOVER_TOPOLOGY_OPTIONS.map((o) => o.value)).toContain('linkwitz-riley-24');
    expect(CROSSOVER_TOPOLOGY_OPTIONS.map((o) => o.value)).toContain('butterworth-48');
    expect(EQ_FILTER_TYPE_OPTIONS.map((o) => o.value)).toContain('allpass');

    const dsp = {
      ...DEFAULT_SOURCE_DSP_CONFIG,
      eqBands: [
        {
          id: 'b1',
          enabled: true,
          type: 'peaking' as const,
          frequencyHz: 1000,
          gainDb: -3,
          q: 2.0,
        },
      ],
    };

    const tpl = renderDspChainEditor({
      entityId: 'grp-1',
      dsp,
      tipText: 'Drag EQ handles on the chart',
      onPatchDsp: vi.fn(),
      onPatchEqBand: vi.fn(),
      onAddEqBand: vi.fn(),
      onRemoveEqBand: vi.fn(),
    });
    expect(tpl.values.length).toBeGreaterThan(0);
  });
});
