/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Deterministic Sample-Accurate Synthetic Acoustic Rig (Virtual PA & Room Simulator).
 *
 * Used both:
 *  1. Live inside the DSP / Demo Mode pipeline so the user can demo every feature
 *     (Auto Delay Finder, Transfer Function Magnitude/Phase, Sub+Top Crossover Alignment,
 *     Comb Filtering / Reflections, Coherence Blanking, Virtual EQ, RTA & SPL) without hardware.
 *  2. In automated unit and E2E tests as a known ground-truth acoustic system.
 */

import {
  BiquadCascade,
  BiquadSpec,
  computeBiquadCoefficients,
} from './biquad.js';

export type SimulatorPresetId =
  | 'flat-delayed'
  | 'pa-room-modes'
  | 'sub-top-misaligned'
  | 'comb-filtering'
  | 'noisy-crowd';

export interface ReflectionTap {
  /** Additional delay relative to direct sound in milliseconds */
  readonly delayMs: number;
  /** Attenuation in dB relative to direct sound (e.g. -6 dB) */
  readonly gainDb: number;
  readonly polarity?: 1 | -1;
}

export interface SimulatorRigConfig {
  readonly id: SimulatorPresetId;
  readonly name: string;
  readonly description: string;
  /** Air propagation delay in milliseconds */
  readonly propagationDelayMs: number;
  /** Overall system gain in dB */
  readonly gainDb: number;
  /** Overall polarity (+1 or -1) */
  readonly polarity: 1 | -1;
  /** Biquad EQ / Room Mode / Roll-off filters on the main path */
  readonly eqFilters: readonly BiquadSpec[];
  /** Optional 2-way Sub + Top crossover simulation */
  readonly subCrossover?: {
    readonly enabled: boolean;
    readonly crossoverFreqHz: number;
    readonly subDelayMs: number;
    readonly subGainDb: number;
    readonly subPolarity: 1 | -1;
  };
  /** Early reflection delay taps (floor bounce, wall slap) */
  readonly reflections: readonly ReflectionTap[];
  /** Uncorrelated ambient noise level in dBFS (e.g. -60 for quiet, -18 for noisy crowd) */
  readonly ambientNoiseDbFs: number;
}

export const SIMULATOR_PRESETS: Record<SimulatorPresetId, SimulatorRigConfig> = {
  'flat-delayed': {
    id: 'flat-delayed',
    name: '1. Flat System (Delayed 10ms)',
    description: 'Ideal flat loudspeaker at 10.0 ms (3.43 m) air delay in a quiet room.',
    propagationDelayMs: 10.0,
    gainDb: 0.0,
    polarity: 1,
    eqFilters: [],
    reflections: [],
    ambientNoiseDbFs: -75.0,
  },
  'pa-room-modes': {
    id: 'pa-room-modes',
    name: '2. PA Tuning (Room Modes + HF Loss)',
    description: 'Main PA at 8.5 ms with +6.5 dB low-mid boom (160 Hz), -5 dB dip (800 Hz), and HF roll-off.',
    propagationDelayMs: 8.5,
    gainDb: 0.0,
    polarity: 1,
    eqFilters: [
      { type: 'highpass', frequency: 35, q: 0.707 },
      { type: 'peaking', frequency: 160, q: 2.2, gainDb: 6.5 },
      { type: 'peaking', frequency: 800, q: 3.0, gainDb: -5.0 },
      { type: 'peaking', frequency: 3200, q: 2.5, gainDb: 3.5 },
      { type: 'highshelf', frequency: 9000, q: 0.707, gainDb: -6.0 },
    ],
    reflections: [{ delayMs: 6.5, gainDb: -16.0 }],
    ambientNoiseDbFs: -55.0,
  },
  'sub-top-misaligned': {
    id: 'sub-top-misaligned',
    name: '3. Sub + Top Crossover (Misaligned)',
    description: '2-way system at 100 Hz LR24 crossover with Subwoofer delayed +4.5 ms and polarity inverted.',
    propagationDelayMs: 7.0,
    gainDb: 0.0,
    polarity: 1,
    eqFilters: [
      { type: 'highpass', frequency: 28, q: 0.707 },
      { type: 'lowpass', frequency: 18000, q: 0.707 },
    ],
    subCrossover: {
      enabled: true,
      crossoverFreqHz: 100,
      subDelayMs: 4.5,
      subGainDb: 2.0,
      subPolarity: -1,
    },
    reflections: [],
    ambientNoiseDbFs: -60.0,
  },
  'comb-filtering': {
    id: 'comb-filtering',
    name: '4. Floor Bounce Comb Filtering',
    description: 'Main speaker at 5.0 ms with a strong -3.5 dB floor reflection arriving 2.0 ms later.',
    propagationDelayMs: 5.0,
    gainDb: 0.0,
    polarity: 1,
    eqFilters: [],
    reflections: [
      { delayMs: 2.0, gainDb: -3.5, polarity: 1 },
      { delayMs: 14.5, gainDb: -14.0, polarity: -1 },
    ],
    ambientNoiseDbFs: -65.0,
  },
  'noisy-crowd': {
    id: 'noisy-crowd',
    name: '5. Noisy Venue / FOH Crowd Noise',
    description: 'PA system buried in loud uncorrelated ambient noise (-16 dBFS) — showcases Coherence & H1 averaging.',
    propagationDelayMs: 12.0,
    gainDb: -3.0,
    polarity: 1,
    eqFilters: [
      { type: 'peaking', frequency: 220, q: 1.8, gainDb: 4.5 },
      { type: 'highshelf', frequency: 7500, q: 0.707, gainDb: -4.0 },
    ],
    reflections: [{ delayMs: 4.2, gainDb: -11.0 }],
    ambientNoiseDbFs: -16.0,
  },
};

/**
 * Fractional delay line with linear interpolation and power-of-2 circular buffer.
 */
class DelayLine {
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private writePtr: number = 0;

  constructor(maxSamples: number = 65536) {
    let cap = 1024;
    while (cap < maxSamples) cap <<= 1;
    this.buffer = new Float32Array(cap);
    this.mask = cap - 1;
  }

  reset(): void {
    this.buffer.fill(0);
    this.writePtr = 0;
  }

  write(sample: number): void {
    this.buffer[this.writePtr] = sample;
    this.writePtr = (this.writePtr + 1) & this.mask;
  }

  readDelayed(delaySamples: number): number {
    const clamped = Math.max(0, Math.min(this.mask - 2, delaySamples));
    const intDelay = Math.floor(clamped);
    const frac = clamped - intDelay;
    // Note: writePtr was already incremented after writing current sample, so lag 0 is at writePtr - 1
    const idx0 = (this.writePtr - 1 - intDelay) & this.mask;
    const idx1 = (idx0 - 1) & this.mask;
    return this.buffer[idx0] * (1.0 - frac) + this.buffer[idx1] * frac;
  }
}

/**
 * Sample-accurate Synthetic Acoustic Rig that processes Reference samples `R[n]`
 * into simulated Measurement samples `M[n]`.
 */
export class SyntheticAcousticRig {
  private sampleRate: number;
  private config: SimulatorRigConfig;

  private readonly mainDelayLine: DelayLine;
  private readonly subDelayLine: DelayLine;
  private readonly eqCascade: BiquadCascade;
  private readonly topHighpassCascade: BiquadCascade;
  private readonly subLowpassCascade: BiquadCascade;

  // Independent PRNG state for uncorrelated ambient noise
  private noiseSeed: number = 0x13579bdf;
  private pinkB0 = 0;
  private pinkB1 = 0;
  private pinkB2 = 0;

  constructor(sampleRate: number = 48000, preset: SimulatorPresetId | SimulatorRigConfig = 'pa-room-modes') {
    this.sampleRate = sampleRate;
    this.config = typeof preset === 'string' ? SIMULATOR_PRESETS[preset] : preset;

    this.mainDelayLine = new DelayLine(65536);
    this.subDelayLine = new DelayLine(65536);
    this.eqCascade = new BiquadCascade();
    this.topHighpassCascade = new BiquadCascade();
    this.subLowpassCascade = new BiquadCascade();

    this.rebuildFilters();
  }

  setConfig(presetOrConfig: SimulatorPresetId | SimulatorRigConfig): void {
    this.config =
      typeof presetOrConfig === 'string' ? SIMULATOR_PRESETS[presetOrConfig] : presetOrConfig;
    this.rebuildFilters();
  }

  getConfig(): SimulatorRigConfig {
    return this.config;
  }

  setSampleRate(sampleRate: number): void {
    if (this.sampleRate !== sampleRate) {
      this.sampleRate = sampleRate;
      this.rebuildFilters();
      this.reset();
    }
  }

  reset(): void {
    this.mainDelayLine.reset();
    this.subDelayLine.reset();
    this.eqCascade.reset();
    this.topHighpassCascade.reset();
    this.subLowpassCascade.reset();
    this.pinkB0 = 0;
    this.pinkB1 = 0;
    this.pinkB2 = 0;
  }

  private rebuildFilters(): void {
    const sr = this.sampleRate;
    const eqCoeffs = this.config.eqFilters.map((spec) => computeBiquadCoefficients(spec, sr));
    this.eqCascade.setCoefficientsList(eqCoeffs);

    if (this.config.subCrossover?.enabled) {
      const fc = this.config.subCrossover.crossoverFreqHz;
      // 4th-order Linkwitz-Riley (LR24) = two cascaded 2nd-order Butterworth filters (Q = 1/sqrt(2))
      const hp = computeBiquadCoefficients({ type: 'highpass', frequency: fc, q: Math.SQRT1_2 }, sr);
      const lp = computeBiquadCoefficients({ type: 'lowpass', frequency: fc, q: Math.SQRT1_2 }, sr);
      this.topHighpassCascade.setCoefficientsList([hp, hp]);
      this.subLowpassCascade.setCoefficientsList([lp, lp]);
    } else {
      this.topHighpassCascade.setCoefficientsList([]);
      this.subLowpassCascade.setCoefficientsList([]);
    }
  }

  private nextAmbientPinkSample(): number {
    // Xorshift32
    let x = this.noiseSeed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.noiseSeed = x;
    const white = (x >>> 0) / 2147483648.0 - 1.0;

    // 3-stage Paul Kellet pinking filter approximation
    this.pinkB0 = 0.99765 * this.pinkB0 + white * 0.099046;
    this.pinkB1 = 0.96300 * this.pinkB1 + white * 0.2965164;
    this.pinkB2 = 0.57000 * this.pinkB2 + white * 1.0526913;
    return (this.pinkB0 + this.pinkB1 + this.pinkB2 + white * 0.1848) * 0.25;
  }

  /**
   * Processes a block of Reference samples `inputR` into simulated Measurement samples `outputM`.
   */
  processBlock(inputR: Float32Array, outputM: Float32Array, length: number = inputR.length): void {
    const sr = this.sampleRate;
    const cfg = this.config;
    const baseDelaySamples = (cfg.propagationDelayMs * sr) / 1000.0;
    const linearGain = Math.pow(10.0, cfg.gainDb / 20.0) * cfg.polarity;
    const noiseGain = cfg.ambientNoiseDbFs > -120 ? Math.pow(10.0, cfg.ambientNoiseDbFs / 20.0) : 0;

    const xover = cfg.subCrossover;
    const hasXover = Boolean(xover && xover.enabled);
    const subDelaySamples = hasXover ? ((cfg.propagationDelayMs + xover!.subDelayMs) * sr) / 1000.0 : 0;
    const subGain = hasXover
      ? Math.pow(10.0, xover!.subGainDb / 20.0) * xover!.subPolarity
      : 0;

    const reflections = cfg.reflections;
    const numRefl = reflections.length;
    const tapDelays = new Float32Array(numRefl);
    const tapSubDelays = new Float32Array(numRefl);
    const tapGains = new Float32Array(numRefl);
    for (let t = 0; t < numRefl; t++) {
      const tap = reflections[t];
      const extraDelay = (tap.delayMs * sr) / 1000.0;
      tapDelays[t] = baseDelaySamples + extraDelay;
      tapSubDelays[t] = subDelaySamples + extraDelay;
      tapGains[t] = Math.pow(10.0, tap.gainDb / 20.0) * (tap.polarity ?? 1);
    }

    for (let i = 0; i < length; i++) {
      const r = inputR[i];

      // Pass through system EQ
      const eqOut = this.eqCascade.processSample(r) * linearGain;

      let directSample = eqOut;
      if (hasXover) {
        const topSample = this.topHighpassCascade.processSample(eqOut);
        const subSample = this.subLowpassCascade.processSample(eqOut) * subGain;
        this.mainDelayLine.write(topSample);
        this.subDelayLine.write(subSample);
        directSample =
          this.mainDelayLine.readDelayed(baseDelaySamples) +
          this.subDelayLine.readDelayed(subDelaySamples);
      } else {
        this.mainDelayLine.write(eqOut);
        directSample = this.mainDelayLine.readDelayed(baseDelaySamples);
      }

      // Add early reflections from the acoustic output (including sub when crossover is active)
      let totalSample = directSample;
      for (let t = 0; t < numRefl; t++) {
        const reflSample = hasXover
          ? this.mainDelayLine.readDelayed(tapDelays[t]) +
            this.subDelayLine.readDelayed(tapSubDelays[t])
          : this.mainDelayLine.readDelayed(tapDelays[t]);
        totalSample += reflSample * tapGains[t];
      }

      // Mix uncorrelated ambient room/crowd noise
      if (noiseGain > 0) {
        totalSample += this.nextAmbientPinkSample() * noiseGain;
      }

      outputM[i] = totalSample;
    }
  }
}

