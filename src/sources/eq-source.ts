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

  const cascade: BiquadCoefficients[] = config.bands
    .filter((b) => b.enabled !== false)
    .map((b) => computeBiquadCoefficients(b, sr));

  for (let i = 0; i < B; i++) {
    const f = freqData.frequency[i];
    const eqResp =
      f > 0
        ? evaluateBiquadCascadeResponse(cascade, f, sr)
        : { re: 1.0, im: 0.0, magnitude: 1.0, phaseRad: 0.0 };

    const eqMag = eqResp.magnitude;
    const eqPhRe = eqMag > 1e-12 ? eqResp.re / eqMag : 1.0;
    const eqPhIm = eqMag > 1e-12 ? eqResp.im / eqMag : 0.0;

    if (targetSource) {
      const base = getEffectiveBinResponse(targetSource, i);
      freqData.module[i] = base.module * eqMag;
      freqData.magnitude[i] = base.magnitude * eqMag;
      freqData.phaseReal[i] = base.phaseRe * eqPhRe - base.phaseIm * eqPhIm;
      freqData.phaseImag[i] = base.phaseRe * eqPhIm + base.phaseIm * eqPhRe;
      freqData.coherence[i] = base.coherence;
    } else {
      freqData.module[i] = eqMag;
      freqData.magnitude[i] = eqMag;
      freqData.phaseReal[i] = eqPhRe;
      freqData.phaseImag[i] = eqPhIm;
      freqData.coherence[i] = 1.0;
    }
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

