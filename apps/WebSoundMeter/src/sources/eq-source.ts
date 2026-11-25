// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Virtual Parametric Equalizer, Delay, Polarity & Crossover Modeling Source (`src/sources/eq-source.ts`).
 *
 * Evaluates a complete `@foh/dsp` `SourceDspConfig` chain (Gain, Electronic Delay e^{-j*omega*tau},
 * Polarity Inversion, Mute, Butterworth/Linkwitz-Riley 12–48 dB/oct HPF/LPF Crossovers,
 * and Parametric EQ bands at 192 kHz reference sample rate) across any target source's frequency bins.
 */

import {
  BiquadSpec,
  CrossoverFilterConfig,
  DEFAULT_SOURCE_DSP_CONFIG,
  DSP_REFERENCE_SAMPLE_RATE_HZ,
  ParametricEqBand,
  SourceDspConfig,
  biquadSpecToEqBand,
  compileDspChain,
  eqBandToBiquadSpec,
  evaluateCompiledDspAtFrequency,
} from '@foh/dsp';
import {
  EffectiveBinResponse,
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
  writeEffectiveBinResponse,
} from './source-data.js';

export interface EqualizerSourceConfig {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  /** Parametric EQ biquad bands synchronized with `dsp.eqBands` for interactive chart handles */
  bands: BiquadSpec[];
  /** Complete DSP chain configuration (Gain, Delay, Polarity, Mute, HPF/LPF Crossovers, Parametric EQ) */
  dsp?: SourceDspConfig;
  /** Optional ID of a live Measurement or Stored source to apply this EQ onto */
  targetSourceId?: string | null;
  /** Optional mixer culprit key (e.g. 'mixer-ch-13') for per-input feedback notch cheat-sheets */
  culpritKey?: string;
  createdAt?: string;
}

export function createDefaultEqBands(): BiquadSpec[] {
  return [
    { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
    { type: 'lowshelf', frequency: 100, q: 0.707, gainDb: 0, enabled: true },
    { type: 'peaking', frequency: 160, q: 2.2, gainDb: 0, enabled: true },
    { type: 'peaking', frequency: 800, q: 3.0, gainDb: 0, enabled: true },
    { type: 'peaking', frequency: 3200, q: 2.5, gainDb: 0, enabled: true },
    { type: 'highshelf', frequency: 9000, q: 0.707, gainDb: 0, enabled: true },
  ];
}

export function createRoomModeFlattenEqBands(): BiquadSpec[] {
  return [
    { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
    { type: 'lowshelf', frequency: 100, q: 0.707, gainDb: 0, enabled: true },
    { type: 'peaking', frequency: 160, q: 2.2, gainDb: -6.5, enabled: true },
    { type: 'peaking', frequency: 800, q: 3.0, gainDb: 5.0, enabled: true },
    { type: 'peaking', frequency: 3200, q: 2.5, gainDb: -3.5, enabled: true },
    { type: 'highshelf', frequency: 9000, q: 0.707, gainDb: 6.0, enabled: true },
  ];
}

export function createDefaultEqDspConfig(
  bands: readonly BiquadSpec[] = createDefaultEqBands()
): SourceDspConfig {
  return {
    ...DEFAULT_SOURCE_DSP_CONFIG,
    eqBands: bands.map((b, i) => biquadSpecToEqBand(b, i)),
  };
}

/**
 * Resolves a complete `SourceDspConfig` from an `EqualizerSourceConfig`,
 * deriving `eqBands` from `config.bands` when `config.dsp` is omitted.
 */
export function resolveEqDspConfig(config: EqualizerSourceConfig): SourceDspConfig {
  const base = config.dsp ?? DEFAULT_SOURCE_DSP_CONFIG;
  const eqBands: ParametricEqBand[] = config.dsp
    ? [...config.dsp.eqBands]
    : config.bands.map((b, i) => biquadSpecToEqBand(b, i));
  return {
    gainDb: base.gainDb ?? 0,
    delayMs: base.delayMs ?? 0,
    invertPolarity: Boolean(base.invertPolarity),
    muted: Boolean(base.muted),
    highPass: base.highPass ?? { topology: 'off', frequencyHz: 80 },
    lowPass: base.lowPass ?? { topology: 'off', frequencyHz: 120 },
    eqBands,
  };
}

/**
 * Normalizes an `EqualizerSourceConfig` loaded from persistence or updated via UI
 * so `config.dsp` and `config.bands` are always consistent.
 */
export function normalizeEqSourceConfig(raw: EqualizerSourceConfig): EqualizerSourceConfig {
  const dsp = resolveEqDspConfig(raw);
  const bands = dsp.eqBands.map(eqBandToBiquadSpec);
  return {
    ...raw,
    bands,
    dsp,
  };
}

export function syncEqConfigWithBands(
  config: EqualizerSourceConfig,
  bands: BiquadSpec[]
): EqualizerSourceConfig {
  const prevDsp = resolveEqDspConfig(config);
  const eqBands: ParametricEqBand[] = bands.map((spec, idx) => ({
    id: prevDsp.eqBands[idx]?.id ?? `band-${idx + 1}`,
    enabled: spec.enabled !== false,
    type: spec.type,
    frequencyHz: spec.frequency,
    gainDb: spec.gainDb ?? 0,
    q: spec.q ?? Math.SQRT1_2,
  }));
  return {
    ...config,
    bands,
    dsp: {
      ...prevDsp,
      eqBands,
    },
  };
}

export interface SourceDspPatch {
  readonly gainDb?: number;
  readonly delayMs?: number;
  readonly invertPolarity?: boolean;
  readonly muted?: boolean;
  readonly highPass?: Partial<CrossoverFilterConfig>;
  readonly lowPass?: Partial<CrossoverFilterConfig>;
  readonly eqBands?: readonly ParametricEqBand[];
}

export function applyPatchToEqConfig(
  config: EqualizerSourceConfig,
  patch: SourceDspPatch
): EqualizerSourceConfig {
  const prev = resolveEqDspConfig(config);
  const nextDsp: SourceDspConfig = {
    gainDb: patch.gainDb ?? prev.gainDb,
    delayMs: patch.delayMs ?? prev.delayMs,
    invertPolarity: patch.invertPolarity ?? prev.invertPolarity,
    muted: patch.muted ?? prev.muted,
    highPass: patch.highPass ? { ...prev.highPass, ...patch.highPass } : prev.highPass,
    lowPass: patch.lowPass ? { ...prev.lowPass, ...patch.lowPass } : prev.lowPass,
    eqBands: patch.eqBands ?? prev.eqBands,
  };
  return {
    ...config,
    dsp: nextDsp,
    bands: nextDsp.eqBands.map(eqBandToBiquadSpec),
  };
}

interface CachedDspChainCurve {
  readonly sampleRate: number;
  readonly binCount: number;
  readonly eqMag: Float32Array;
  readonly eqPhRe: Float32Array;
  readonly eqPhIm: Float32Array;
}

const eqConfigCurveCache = new WeakMap<EqualizerSourceConfig, CachedDspChainCurve>();

function getOrComputeEqChainCurve(
  config: EqualizerSourceConfig,
  frequencies: Float32Array,
  sampleRate: number
): CachedDspChainCurve {
  const B = frequencies.length;
  const cached = eqConfigCurveCache.get(config);
  if (cached && cached.sampleRate === sampleRate && cached.binCount === B) {
    return cached;
  }

  const eqMag = new Float32Array(B);
  const eqPhRe = new Float32Array(B);
  const eqPhIm = new Float32Array(B);

  const dsp = resolveEqDspConfig(config);
  const compiled = compileDspChain(dsp, undefined, DSP_REFERENCE_SAMPLE_RATE_HZ);

  for (let i = 0; i < B; i++) {
    const f = frequencies[i];
    if (f > 0) {
      const c = evaluateCompiledDspAtFrequency(compiled, f, DSP_REFERENCE_SAMPLE_RATE_HZ);
      const mag = Math.hypot(c.re, c.im);
      eqMag[i] = mag;
      eqPhRe[i] = mag > 1e-12 ? c.re / mag : 1.0;
      eqPhIm[i] = mag > 1e-12 ? c.im / mag : 0.0;
    } else {
      eqMag[i] = compiled.muted ? 0 : Math.abs(compiled.linearGainSigned);
      eqPhRe[i] = compiled.linearGainSigned < 0 ? -1.0 : 1.0;
      eqPhIm[i] = 0.0;
    }
  }

  const entry: CachedDspChainCurve = {
    sampleRate,
    binCount: B,
    eqMag,
    eqPhRe,
    eqPhIm,
  };
  eqConfigCurveCache.set(config, entry);
  return entry;
}

const eqScratchBin: EffectiveBinResponse = {
  frequency: 0,
  module: 0,
  magnitude: 0,
  phaseRe: 1,
  phaseIm: 0,
  coherence: 0,
};

export function computeEqualizerSourceData(
  config: EqualizerSourceConfig,
  targetSource?: SourceData | null,
  defaultBinCount: number = 2049,
  defaultSampleRate: number = 48000
): SourceData {
  const sr = targetSource ? targetSource.sampleRate : defaultSampleRate;
  const B = targetSource ? targetSource.freqData.length : defaultBinCount;
  const T = targetSource ? targetSource.timeData.length : 2048;

  const freqData = createEmptyFrequencyDomainData(B, sr);
  if (targetSource) {
    freqData.frequency.set(targetSource.freqData.frequency);
  }
  const timeData = createEmptyTimeDomainData(T, sr);

  const { eqMag, eqPhRe, eqPhIm } = getOrComputeEqChainCurve(
    config,
    freqData.frequency,
    sr
  );

  if (targetSource) {
    for (let i = 0; i < B; i++) {
      const mag = eqMag[i];
      const phRe = eqPhRe[i];
      const phIm = eqPhIm[i];
      writeEffectiveBinResponse(targetSource, i, eqScratchBin);
      freqData.module[i] = eqScratchBin.module * mag;
      freqData.magnitude[i] = eqScratchBin.magnitude * mag;
      freqData.phaseReal[i] =
        eqScratchBin.phaseRe * phRe - eqScratchBin.phaseIm * phIm;
      freqData.phaseImag[i] =
        eqScratchBin.phaseRe * phIm + eqScratchBin.phaseIm * phRe;
      freqData.coherence[i] = eqScratchBin.coherence;
    }
  } else {
    freqData.module.set(eqMag);
    freqData.magnitude.set(eqMag);
    freqData.phaseReal.set(eqPhRe);
    freqData.phaseImag.set(eqPhIm);
    freqData.coherence.fill(1.0);
  }

  return {
    id: config.id,
    name: config.name,
    kind: 'eq',
    color: config.color,
    visible: config.visible,
    active: true,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: false,
    notes: targetSource
      ? `Virtual EQ applied to ${targetSource.name}`
      : 'Standalone Virtual EQ Curve',
    createdAt: config.createdAt ?? '',
    sampleRate: sr,
    freqData,
    timeData,
  };
}
