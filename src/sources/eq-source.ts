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
 * Virtual Parametric Equalizer & Crossover Modeling Source (inspired by OSM's `Equalizer` & `FilterSource`).
 *
 * Evaluates a cascade of biquad filter bands (Peaking, Shelves, Highpass/Lowpass Crossovers, Allpass, Notch)
 * and optionally applies them onto a target `baseSource` (e.g. a live Measurement or Stored trace)
 * so the sound engineer can design a corrective EQ curve and immediately see the predicted
 * post-EQ Magnitude and Phase response in real time.
 */

import {
  BiquadCoefficients,
  BiquadSpec,
  computeBiquadCoefficients,
  evaluateBiquadCascadeResponse,
} from '../dsp/biquad.js';
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
  getEffectiveBinResponse,
} from './source-data.js';

export interface EqualizerSourceConfig {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  bands: BiquadSpec[];
  /** Optional ID of a live Measurement or Stored source to apply this EQ onto */
  targetSourceId?: string | null;
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

interface CachedBandCascadeCurve {
  readonly sampleRate: number;
  readonly binCount: number;
  readonly eqMag: Float32Array;
  readonly eqPhRe: Float32Array;
  readonly eqPhIm: Float32Array;
}

const bandCascadeCache = new WeakMap<BiquadSpec[], CachedBandCascadeCurve>();

function getOrComputeBandCascadeCurve(
  bands: BiquadSpec[],
  frequencies: Float32Array,
  sampleRate: number
): CachedBandCascadeCurve {
  const B = frequencies.length;
  const cached = bandCascadeCache.get(bands);
  if (cached && cached.sampleRate === sampleRate && cached.binCount === B) {
    return cached;
  }

  const eqMag = new Float32Array(B);
  const eqPhRe = new Float32Array(B);
  const eqPhIm = new Float32Array(B);

  const cascade: BiquadCoefficients[] = bands
    .filter((b) => b.enabled !== false)
    .map((b) => computeBiquadCoefficients(b, sampleRate));

  for (let i = 0; i < B; i++) {
    const f = frequencies[i];
    const eqResp =
      f > 0
        ? evaluateBiquadCascadeResponse(cascade, f, sampleRate)
        : { re: 1.0, im: 0.0, magnitude: 1.0, phaseRad: 0.0 };

    const mag = eqResp.magnitude;
    eqMag[i] = mag;
    eqPhRe[i] = mag > 1e-12 ? eqResp.re / mag : 1.0;
    eqPhIm[i] = mag > 1e-12 ? eqResp.im / mag : 0.0;
  }

  const entry: CachedBandCascadeCurve = {
    sampleRate,
    binCount: B,
    eqMag,
    eqPhRe,
    eqPhIm,
  };
  bandCascadeCache.set(bands, entry);
  return entry;
}

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

  const { eqMag, eqPhRe, eqPhIm } = getOrComputeBandCascadeCurve(
    config.bands,
    freqData.frequency,
    sr
  );

  if (targetSource) {
    for (let i = 0; i < B; i++) {
      const mag = eqMag[i];
      const phRe = eqPhRe[i];
      const phIm = eqPhIm[i];
      const base = getEffectiveBinResponse(targetSource, i);
      freqData.module[i] = base.module * mag;
      freqData.magnitude[i] = base.magnitude * mag;
      freqData.phaseReal[i] = base.phaseRe * phRe - base.phaseIm * phIm;
      freqData.phaseImag[i] = base.phaseRe * phIm + base.phaseIm * phRe;
      freqData.coherence[i] = base.coherence;
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
    createdAt: new Date().toISOString(),
    sampleRate: sr,
    freqData,
    timeData,
  };
}

