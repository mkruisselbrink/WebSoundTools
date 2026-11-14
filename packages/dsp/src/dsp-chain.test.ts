// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_DSP_CONFIG,
  biquadSpecToEqBand,
  compileDspChain,
  eqBandToBiquadSpec,
  evaluateCompiledDspAtFrequency,
} from './dsp-chain.js';

describe('SourceDspConfig & CompiledDspChain', () => {
  it('applies gain, polarity inversion, and electronic delay phase rotation', () => {
    const chain = compileDspChain(
      {
        ...DEFAULT_SOURCE_DSP_CONFIG,
        gainDb: 6.0206,
        delayMs: 2.5,
      },
      { invertPolarity: true }
    );

    const h200 = evaluateCompiledDspAtFrequency(chain, 200);
    expect(h200.re).toBeCloseTo(2.0, 3);
    expect(h200.im).toBeCloseTo(0.0, 3);
  });

  it('zeros output when muted and converts cleanly between BiquadSpec and ParametricEqBand', () => {
    const mutedChain = compileDspChain({ ...DEFAULT_SOURCE_DSP_CONFIG, muted: true });
    expect(evaluateCompiledDspAtFrequency(mutedChain, 1000)).toEqual({ re: 0, im: 0 });

    const band = biquadSpecToEqBand(
      { type: 'peaking', frequency: 800, q: 3.0, gainDb: -4.5, enabled: true },
      2
    );
    expect(band).toEqual({
      id: 'band-3',
      enabled: true,
      type: 'peaking',
      frequencyHz: 800,
      gainDb: -4.5,
      q: 3.0,
    });
    expect(eqBandToBiquadSpec(band)).toEqual({
      type: 'peaking',
      frequency: 800,
      q: 3.0,
      gainDb: -4.5,
      enabled: true,
    });
  });
});
