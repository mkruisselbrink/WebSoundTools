/**
 * Math / Union Virtual Source (modeled on Open Sound Meter's `Union` source).
 *
 * Combines 2 or more sources in real time using:
 *  - 'vector-avg': Complex vector average (captures phase cancellations / subwoofer summation)
 *  - 'power-avg':  RMS power average (spatial mic averaging across a venue)
 *  - 'sum':        Complex vector sum (predicting combined output of Sub + Top)
 *  - 'subtract':   Complex vector difference (A - B)
 *  - 'diff-db':    Ratio in dB (|A| / |B|, i.e., A_dB - B_dB and phase_A - phase_B)
 *  - 'apply':      Cascaded transfer function multiplication (A * B, e.g. applying EQ to a trace)
 *  - 'min' / 'max': Envelope minimum or maximum
 */

import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
  getEffectiveBinResponse,
} from './source-data.js';

export type UnionOperation =
  | 'vector-avg'
  | 'power-avg'
  | 'sum'
  | 'subtract'
  | 'diff-db'
  | 'apply'
  | 'min'
  | 'max';

export const UNION_OPERATION_LABELS: Record<UnionOperation, string> = {
  'vector-avg': 'Vector Average',
  'power-avg': 'Power Average (RMS)',
  sum: 'Vector Sum (A + B)',
  subtract: 'Vector Subtract (A - B)',
  'diff-db': 'dB Difference (A / B)',
  apply: 'Apply Filter (A × B)',
  min: 'Minimum Envelope',
  max: 'Maximum Envelope',
};

export interface UnionSourceConfig {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  operation: UnionOperation;
  sourceIds: string[];
}

export function computeUnionSourceData(
  config: UnionSourceConfig,
  inputs: readonly SourceData[]
): SourceData {
  const validInputs = inputs.filter((s) => s && s.active && s.freqData.length > 0);
  if (validInputs.length === 0) {
    return {
      id: config.id,
      name: config.name,
      kind: 'union',
      color: config.color,
      visible: config.visible,
      active: false,
      gainOffsetDb: 0,
      delayOffsetMs: 0,
      invertPolarity: false,
      notes: `Union (${UNION_OPERATION_LABELS[config.operation]})`,
      createdAt: new Date().toISOString(),
      sampleRate: 48000,
      freqData: createEmptyFrequencyDomainData(1025, 48000),
      timeData: createEmptyTimeDomainData(2048, 48000),
    };
  }

  const primary = validInputs[0];
  const B = primary.freqData.length;
  const T = primary.timeData.length;
  const sr = primary.sampleRate;

  const freqData = createEmptyFrequencyDomainData(B, sr);
  freqData.frequency.set(primary.freqData.frequency);
  const timeData = createEmptyTimeDomainData(T, sr);
  timeData.timeMs.set(primary.timeData.timeMs);

  const count = validInputs.length;
  const op = config.operation;

  for (let i = 0; i < B; i++) {
    const first = getEffectiveBinResponse(primary, i);

    if (op === 'vector-avg' || op === 'sum' || op === 'subtract') {
      let vecModRe = first.module * first.phaseRe;
      let vecModIm = first.module * first.phaseIm;
      let vecMagRe = first.magnitude * first.phaseRe;
      let vecMagIm = first.magnitude * first.phaseIm;
      let cohWeightedSum = first.module * first.coherence;
      let cohWeight = first.module;

      for (let sIdx = 1; sIdx < count; sIdx++) {
        const s = validInputs[sIdx];
        if (i >= s.freqData.length) continue;
        const bin = getEffectiveBinResponse(s, i);
        const sign = op === 'subtract' ? -1.0 : 1.0;

        vecModRe += sign * bin.module * bin.phaseRe;
        vecModIm += sign * bin.module * bin.phaseIm;
        vecMagRe += sign * bin.magnitude * bin.phaseRe;
        vecMagIm += sign * bin.magnitude * bin.phaseIm;
        cohWeightedSum += bin.module * bin.coherence;
        cohWeight += bin.module;
      }

      if (op === 'vector-avg') {
        vecModRe /= count;
        vecModIm /= count;
        vecMagRe /= count;
        vecMagIm /= count;
      }

      const outMod = Math.hypot(vecModRe, vecModIm);
      const outMag = Math.hypot(vecMagRe, vecMagIm);
      freqData.module[i] = outMod;
      freqData.magnitude[i] = outMag;
      if (outMag > 1e-12) {
        freqData.phaseReal[i] = vecMagRe / outMag;
        freqData.phaseImag[i] = vecMagIm / outMag;
      } else {
        freqData.phaseReal[i] = 1.0;
        freqData.phaseImag[i] = 0.0;
      }
      freqData.coherence[i] = cohWeight > 1e-12 ? cohWeightedSum / cohWeight : first.coherence;
    } else if (op === 'power-avg') {
      let sumModSq = first.module * first.module;
      let sumMagSq = first.magnitude * first.magnitude;
      let sumPhRe = first.phaseRe;
      let sumPhIm = first.phaseIm;
      let sumCoh = first.coherence;

      for (let sIdx = 1; sIdx < count; sIdx++) {
        const s = validInputs[sIdx];
        if (i >= s.freqData.length) continue;
        const bin = getEffectiveBinResponse(s, i);
        sumModSq += bin.module * bin.module;
        sumMagSq += bin.magnitude * bin.magnitude;
        sumPhRe += bin.phaseRe;
        sumPhIm += bin.phaseIm;
        sumCoh += bin.coherence;
      }

      freqData.module[i] = Math.sqrt(sumModSq / count);
      freqData.magnitude[i] = Math.sqrt(sumMagSq / count);
      const phLen = Math.hypot(sumPhRe, sumPhIm);
      freqData.phaseReal[i] = phLen > 1e-12 ? sumPhRe / phLen : 1.0;
      freqData.phaseImag[i] = phLen > 1e-12 ? sumPhIm / phLen : 0.0;
      freqData.coherence[i] = sumCoh / count;
    } else if (op === 'apply' || op === 'diff-db') {
      let mod = first.module;
      let mag = first.magnitude;
      let phRe = first.phaseRe;
      let phIm = first.phaseIm;
      let minCoh = first.coherence;

      for (let sIdx = 1; sIdx < count; sIdx++) {
        const s = validInputs[sIdx];
        if (i >= s.freqData.length) continue;
        const bin = getEffectiveBinResponse(s, i);

        if (op === 'apply') {
          mod *= bin.magnitude;
          mag *= bin.magnitude;
          // Phase addition: (phRe + i*phIm) * (bin.phaseRe + i*bin.phaseIm)
          const nextRe = phRe * bin.phaseRe - phIm * bin.phaseIm;
          const nextIm = phRe * bin.phaseIm + phIm * bin.phaseRe;
          phRe = nextRe;
          phIm = nextIm;
        } else {
          // diff-db: A / B
          mod = bin.module > 1e-12 ? mod / bin.module : 0;
          mag = bin.magnitude > 1e-12 ? mag / bin.magnitude : 0;
          // Phase subtraction: (phRe + i*phIm) * (bin.phaseRe - i*bin.phaseIm)
          const nextRe = phRe * bin.phaseRe + phIm * bin.phaseIm;
          const nextIm = phIm * bin.phaseRe - phRe * bin.phaseIm;
          phRe = nextRe;
          phIm = nextIm;
        }
        minCoh = Math.min(minCoh, bin.coherence);
      }

      freqData.module[i] = mod;
      freqData.magnitude[i] = mag;
      const len = Math.hypot(phRe, phIm);
      freqData.phaseReal[i] = len > 1e-12 ? phRe / len : 1.0;
      freqData.phaseImag[i] = len > 1e-12 ? phIm / len : 0.0;
      freqData.coherence[i] = minCoh;
    } else if (op === 'min' || op === 'max') {
      let mod = first.module;
      let mag = first.magnitude;
      let coh = first.coherence;

      for (let sIdx = 1; sIdx < count; sIdx++) {
        const s = validInputs[sIdx];
        if (i >= s.freqData.length) continue;
        const bin = getEffectiveBinResponse(s, i);
        if (op === 'min') {
          mod = Math.min(mod, bin.module);
          mag = Math.min(mag, bin.magnitude);
          coh = Math.min(coh, bin.coherence);
        } else {
          mod = Math.max(mod, bin.module);
          mag = Math.max(mag, bin.magnitude);
          coh = Math.max(coh, bin.coherence);
        }
      }

      freqData.module[i] = mod;
      freqData.magnitude[i] = mag;
      freqData.phaseReal[i] = first.phaseRe;
      freqData.phaseImag[i] = first.phaseIm;
      freqData.coherence[i] = coh;
    }
  }

  // Time-domain impulse combination for linear time-domain operations only
  if (op === 'sum' || op === 'subtract' || op === 'vector-avg' || op === 'power-avg') {
    for (let t = 0; t < T; t++) {
      let sumImp = primary.timeData.impulse[t];
      for (let sIdx = 1; sIdx < count; sIdx++) {
        const s = validInputs[sIdx];
        if (t >= s.timeData.length) continue;
        if (op === 'subtract') {
          sumImp -= s.timeData.impulse[t];
        } else {
          sumImp += s.timeData.impulse[t];
        }
      }
      if (op === 'vector-avg' || op === 'power-avg') {
        sumImp /= count;
      }
      timeData.impulse[t] = sumImp;
    }
  }

  return {
    id: config.id,
    name: config.name,
    kind: 'union',
    color: config.color,
    visible: config.visible,
    active: true,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: false,
    notes: `${UNION_OPERATION_LABELS[config.operation]} of ${validInputs.map((s) => s.name).join(', ')}`,
    createdAt: new Date().toISOString(),
    sampleRate: sr,
    freqData,
    timeData,
  };
}

