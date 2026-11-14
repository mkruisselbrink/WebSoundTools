// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Complete per-group / virtual EQ DSP chain model (`SourceDspConfig`):
 * Gain, Electronic Delay, Polarity Inversion, Mute, HPF/LPF Crossovers, and Parametric EQ bands.
 */

import {
  BiquadCoefficients,
  BiquadFilterType,
  BiquadSpec,
  ComplexSample,
  DSP_REFERENCE_SAMPLE_RATE_HZ,
  designBiquad,
  evaluateBiquadCascade,
} from './biquad.js';
import { CrossoverFilterConfig, designCrossoverSections } from './crossovers.js';

export interface ParametricEqBand {
  readonly id: string;
  readonly enabled: boolean;
  readonly type: BiquadFilterType;
  readonly frequencyHz: number;
  readonly gainDb: number;
  readonly q: number;
}

export interface SourceDspConfig {
  readonly gainDb: number;
  readonly delayMs: number;
  readonly invertPolarity: boolean;
  readonly muted: boolean;
  readonly highPass: CrossoverFilterConfig;
  readonly lowPass: CrossoverFilterConfig;
  readonly eqBands: readonly ParametricEqBand[];
}

export const DEFAULT_SOURCE_DSP_CONFIG: SourceDspConfig = {
  gainDb: 0,
  delayMs: 0,
  invertPolarity: false,
  muted: false,
  highPass: { topology: 'off', frequencyHz: 80 },
  lowPass: { topology: 'off', frequencyHz: 120 },
  eqBands: [],
};

export interface CompiledDspChain {
  readonly muted: boolean;
  readonly linearGainSigned: number;
  readonly delaySeconds: number;
  readonly sections: readonly BiquadCoefficients[];
}

export function biquadSpecToEqBand(spec: BiquadSpec, index: number): ParametricEqBand {
  return {
    id: `band-${index + 1}`,
    enabled: spec.enabled !== false,
    type: spec.type,
    frequencyHz: spec.frequency,
    gainDb: spec.gainDb ?? 0,
    q: spec.q ?? Math.SQRT1_2,
  };
}

export function eqBandToBiquadSpec(band: ParametricEqBand): BiquadSpec {
  return {
    type: band.type,
    frequency: band.frequencyHz,
    q: band.q,
    gainDb: band.gainDb,
    enabled: band.enabled,
  };
}

/**
 * Compiles a `SourceDspConfig` into its biquad cascade once for fast multi-bin evaluation.
 */
export function compileDspChain(
  groupDsp: SourceDspConfig,
  trim?: { gainDb?: number; delayMs?: number; invertPolarity?: boolean; muted?: boolean },
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): CompiledDspChain {
  const muted = groupDsp.muted || Boolean(trim?.muted);
  const totalGainDb = groupDsp.gainDb + (trim?.gainDb ?? 0);
  const invert = groupDsp.invertPolarity !== Boolean(trim?.invertPolarity);
  const linearGainSigned = (invert ? -1 : 1) * Math.pow(10, totalGainDb / 20);
  const delaySeconds = (groupDsp.delayMs + (trim?.delayMs ?? 0)) * 1e-3;

  const sections: BiquadCoefficients[] = [
    ...designCrossoverSections('highpass', groupDsp.highPass, sampleRateHz),
    ...designCrossoverSections('lowpass', groupDsp.lowPass, sampleRateHz),
  ];

  for (const band of groupDsp.eqBands) {
    if (!band.enabled) continue;
    sections.push(designBiquad(band.type, band.frequencyHz, band.q, band.gainDb, sampleRateHz));
  }

  return {
    muted,
    linearGainSigned,
    delaySeconds,
    sections,
  };
}

/**
 * Evaluates a compiled DSP chain at `frequencyHz`, including gain, polarity, electronic delay,
 * crossovers, and parametric EQ.
 */
export function evaluateCompiledDspAtFrequency(
  chain: CompiledDspChain,
  frequencyHz: number,
  sampleRateHz: number = DSP_REFERENCE_SAMPLE_RATE_HZ
): ComplexSample {
  if (chain.muted) {
    return { re: 0, im: 0 };
  }

  const filterH = evaluateBiquadCascade(chain.sections, frequencyHz, sampleRateHz);
  const delayPhase = -2 * Math.PI * frequencyHz * chain.delaySeconds;
  const rotRe = Math.cos(delayPhase) * chain.linearGainSigned;
  const rotIm = Math.sin(delayPhase) * chain.linearGainSigned;

  return {
    re: filterH.re * rotRe - filterH.im * rotIm,
    im: filterH.re * rotIm + filterH.im * rotRe,
  };
}
