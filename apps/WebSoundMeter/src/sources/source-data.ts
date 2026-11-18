// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `SourceData` Model (inspired by Open Sound Meter's `Abstract::Data` & `Abstract::Source`).
 *
 * Every source in WebSoundMeter — Live Measurement, Stored Trace, Math Union,
 * Virtual Parametric EQ, or Target Curve — produces this exact same data structure,
 * enabling any chart to plot any source interchangeably.
 */

import {
  interpolateFrdCurveLogFreq,
  parseFrdCurveText,
  serializeFrdText,
} from '@foh/acoustics';
import { DelayEstimate } from '../dsp/deconvolution.js';
import { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import { SplHistoryData } from '../dsp/spl-history.js';
import { BroadbandLevelsSnapshot } from '../dsp/weighting-meters.js';

export type SourceKind = 'measurement' | 'stored' | 'union' | 'eq' | 'target';

export interface FrequencyDomainData {
  readonly length: number;
  readonly frequency: Float32Array;    // Hz
  readonly module: Float32Array;       // RTA linear RMS magnitude |M(f)|
  readonly magnitude: Float32Array;    // Linear transfer function |H(f)|
  readonly phaseReal: Float32Array;    // cos(phi)
  readonly phaseImag: Float32Array;    // sin(phi)
  readonly coherence: Float32Array;    // gamma^2(f) in [0, 1]
  readonly peakSquared: Float32Array;  // Peak hold |M(f)|^2
  readonly meanSquared: Float32Array;  // Smoothed |M(f)|^2 for Crest Factor
}

export interface TimeDomainData {
  readonly length: number;
  readonly timeMs: Float32Array;       // Centered time axis in ms
  readonly impulse: Float32Array;      // Deconvolved impulse h(t)
  readonly stepResponse: Float32Array; // Cumulative step response
}

export interface SourceData {
  id: string;
  name: string;
  kind: SourceKind;
  color: string;
  visible: boolean;
  active: boolean;
  /** User gain offset in dB applied at display / downstream math time */
  gainOffsetDb: number;
  /** User delay offset in ms applied at display / downstream math time */
  delayOffsetMs: number;
  /** Polarity inversion toggle */
  invertPolarity: boolean;
  notes: string;
  createdAt: string;
  sampleRate: number;
  freqData: FrequencyDomainData;
  timeData: TimeDomainData;
  levels?: BroadbandLevelsSnapshot;
  delayEstimate?: DelayEstimate;
  splHistory?: SplHistoryData;
  feedbackTracks?: readonly DetectedFeedbackTrack[];
}

export const DEFAULT_SOURCE_PALETTE: readonly string[] = [
  '#38bdf8', // Sky Blue
  '#f43f5e', // Rose
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#84cc16', // Lime
  '#06b6d4', // Cyan
];

export function createEmptyFrequencyDomainData(binCount: number, sampleRate: number = 48000): FrequencyDomainData {
  const frequency = new Float32Array(binCount);
  const fftSize = (binCount - 1) * 2;
  const df = fftSize > 0 ? sampleRate / fftSize : 1;
  for (let k = 0; k < binCount; k++) {
    frequency[k] = k * df;
  }
  const phaseReal = new Float32Array(binCount).fill(1.0);
  return {
    length: binCount,
    frequency,
    module: new Float32Array(binCount),
    magnitude: new Float32Array(binCount),
    phaseReal,
    phaseImag: new Float32Array(binCount),
    coherence: new Float32Array(binCount),
    peakSquared: new Float32Array(binCount),
    meanSquared: new Float32Array(binCount),
  };
}

export function createEmptyTimeDomainData(timeSize: number, sampleRate: number = 48000): TimeDomainData {
  const timeMs = new Float32Array(timeSize);
  const half = timeSize >>> 1;
  const dtMs = 1000.0 / sampleRate;
  for (let i = 0; i < timeSize; i++) {
    timeMs[i] = (i - half) * dtMs;
  }
  return {
    length: timeSize,
    timeMs,
    impulse: new Float32Array(timeSize),
    stepResponse: new Float32Array(timeSize),
  };
}

/**
 * Clones any `SourceData` into an immutable `stored` snapshot trace.
 */
export function cloneSourceDataAsStored(
  source: SourceData,
  customName?: string,
  customColor?: string
): SourceData {
  const id = `stored-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = new Date().toLocaleTimeString();
  return {
    id,
    name: customName ?? `${source.name} (${timestamp})`,
    kind: 'stored',
    color: customColor ?? source.color,
    visible: true,
    active: true,
    gainOffsetDb: source.gainOffsetDb,
    delayOffsetMs: source.delayOffsetMs,
    invertPolarity: source.invertPolarity,
    notes:
      source.notes ||
      `Captured from ${source.name} @ ${(source.sampleRate / 1000).toFixed(1)} kHz (${new Date().toLocaleString()})`,
    createdAt: new Date().toISOString(),
    sampleRate: source.sampleRate,
    freqData: {
      length: source.freqData.length,
      frequency: source.freqData.frequency.slice(),
      module: source.freqData.module.slice(),
      magnitude: source.freqData.magnitude.slice(),
      phaseReal: source.freqData.phaseReal.slice(),
      phaseImag: source.freqData.phaseImag.slice(),
      coherence: source.freqData.coherence.slice(),
      peakSquared: source.freqData.peakSquared.slice(),
      meanSquared: source.freqData.meanSquared.slice(),
    },
    timeData: {
      length: source.timeData.length,
      timeMs: source.timeData.timeMs.slice(),
      impulse: source.timeData.impulse.slice(),
      stepResponse: source.timeData.stepResponse.slice(),
    },
    levels: source.levels ? structuredClone(source.levels) : undefined,
    delayEstimate: source.delayEstimate ? { ...source.delayEstimate } : undefined,
  };
}

export interface EffectiveBinResponse {
  frequency: number;
  module: number;
  magnitude: number;
  phaseRe: number;
  phaseIm: number;
  coherence: number;
}

/**
 * Evaluates effective complex phase `(re, im)` and linear magnitude at bin `i`
 * into a reusable `out` object without per-bin heap allocations.
 */
export function writeEffectiveBinResponse(
  source: SourceData,
  binIndex: number,
  out: EffectiveBinResponse
): void {
  const fd = source.freqData;
  const f = fd.frequency[binIndex];
  const gainLinear =
    source.gainOffsetDb !== 0 ? Math.pow(10.0, source.gainOffsetDb / 20.0) : 1.0;
  const polSign = source.invertPolarity ? -1.0 : 1.0;

  let phRe = fd.phaseReal[binIndex] * polSign;
  let phIm = fd.phaseImag[binIndex] * polSign;

  if (source.delayOffsetMs !== 0) {
    // Adding delay delta_t rotates phase by -2*pi*f*delta_t
    const angle = (-2.0 * Math.PI * f * source.delayOffsetMs) / 1000.0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rotRe = phRe * c - phIm * s;
    const rotIm = phRe * s + phIm * c;
    phRe = rotRe;
    phIm = rotIm;
  }

  out.frequency = f;
  out.module = fd.module[binIndex] * gainLinear;
  out.magnitude = fd.magnitude[binIndex] * gainLinear;
  out.phaseRe = phRe;
  out.phaseIm = phIm;
  out.coherence = fd.coherence[binIndex];
}

/**
 * Evaluates effective complex phase `(re, im)` and linear magnitude at bin `i`
 * taking into account `source.gainOffsetDb`, `source.delayOffsetMs`, and `source.invertPolarity`.
 */
export function getEffectiveBinResponse(
  source: SourceData,
  binIndex: number
): EffectiveBinResponse {
  const out: EffectiveBinResponse = {
    frequency: 0,
    module: 0,
    magnitude: 0,
    phaseRe: 1,
    phaseIm: 0,
    coherence: 0,
  };
  writeEffectiveBinResponse(source, binIndex, out);
  return out;
}

export interface SerializedSourceData {
  id: string;
  name: string;
  kind: SourceKind;
  color: string;
  visible: boolean;
  active: boolean;
  gainOffsetDb: number;
  delayOffsetMs: number;
  invertPolarity: boolean;
  notes: string;
  createdAt: string;
  sampleRate: number;
  freqData: {
    length: number;
    frequency: number[];
    module: number[];
    magnitude: number[];
    phaseReal: number[];
    phaseImag: number[];
    coherence: number[];
    peakSquared: number[];
    meanSquared: number[];
  };
  timeData: {
    length: number;
    timeMs: number[];
    impulse: number[];
    stepResponse: number[];
  };
}

export function serializeSourceData(source: SourceData): SerializedSourceData {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    color: source.color,
    visible: source.visible,
    active: source.active,
    gainOffsetDb: source.gainOffsetDb,
    delayOffsetMs: source.delayOffsetMs,
    invertPolarity: source.invertPolarity,
    notes: source.notes,
    createdAt: source.createdAt,
    sampleRate: source.sampleRate,
    freqData: {
      length: source.freqData.length,
      frequency: Array.from(source.freqData.frequency),
      module: Array.from(source.freqData.module),
      magnitude: Array.from(source.freqData.magnitude),
      phaseReal: Array.from(source.freqData.phaseReal),
      phaseImag: Array.from(source.freqData.phaseImag),
      coherence: Array.from(source.freqData.coherence),
      peakSquared: Array.from(source.freqData.peakSquared),
      meanSquared: Array.from(source.freqData.meanSquared),
    },
    timeData: {
      length: source.timeData.length,
      timeMs: Array.from(source.timeData.timeMs),
      impulse: Array.from(source.timeData.impulse),
      stepResponse: Array.from(source.timeData.stepResponse),
    },
  };
}

export function deserializeSourceData(raw: SerializedSourceData): SourceData {
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    color: raw.color,
    visible: raw.visible,
    active: raw.active,
    gainOffsetDb: raw.gainOffsetDb ?? 0,
    delayOffsetMs: raw.delayOffsetMs ?? 0,
    invertPolarity: raw.invertPolarity ?? false,
    notes: raw.notes ?? '',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    sampleRate: raw.sampleRate ?? 48000,
    freqData: {
      length: raw.freqData.length,
      frequency: new Float32Array(raw.freqData.frequency),
      module: new Float32Array(raw.freqData.module),
      magnitude: new Float32Array(raw.freqData.magnitude),
      phaseReal: new Float32Array(raw.freqData.phaseReal),
      phaseImag: new Float32Array(raw.freqData.phaseImag),
      coherence: new Float32Array(raw.freqData.coherence),
      peakSquared: new Float32Array(raw.freqData.peakSquared),
      meanSquared: new Float32Array(raw.freqData.meanSquared),
    },
    timeData: {
      length: raw.timeData.length,
      timeMs: new Float32Array(raw.timeData.timeMs),
      impulse: new Float32Array(raw.timeData.impulse),
      stepResponse: new Float32Array(raw.timeData.stepResponse),
    },
  };
}

export interface FrdStoredImportOptions {
  readonly name?: string;
  readonly color?: string;
  readonly sampleRate?: number;
  readonly binCount?: number;
  /**
   * When undefined (default), automatically normalizes absolute dB SPL curves (passband > 35 dB,
   * such as WebSpeakerSim Virtual Mic exports) to 0 dB passband average so they overlay cleanly
   * onto Transfer Function Magnitude traces.
   */
  readonly normalizeToZeroDb?: boolean;
}

/**
 * Imports a 2-column or 3-column `.frd` / `.csv` curve as a `SourceData` (`kind: 'stored'`)
 * interpolated onto WebSoundMeter's FFT frequency grid.
 */
export function importFrdAsStoredSource(
  frdText: string,
  options: FrdStoredImportOptions = {}
): SourceData {
  const curve = parseFrdCurveText(frdText);
  const sampleRate = options.sampleRate ?? 48000;
  const binCount = options.binCount ?? 2049;

  const freqData = createEmptyFrequencyDomainData(binCount, sampleRate);
  const timeData = createEmptyTimeDomainData((binCount - 1) * 2, sampleRate);

  // Estimate 200 Hz .. 2 kHz passband mean to detect absolute SPL vs relative TF dB
  let pbSum = 0;
  let pbCount = 0;
  for (let i = 0; i < curve.frequenciesHz.length; i++) {
    const f = curve.frequenciesHz[i];
    if (f >= 200 && f <= 2000) {
      pbSum += curve.magnitudeDb[i];
      pbCount++;
    }
  }
  const pbMeanDb =
    pbCount > 0
      ? pbSum / pbCount
      : curve.magnitudeDb[Math.floor(curve.magnitudeDb.length / 2)] ?? 0;
  const shouldNormalize =
    options.normalizeToZeroDb !== undefined ? options.normalizeToZeroDb : pbMeanDb > 35;
  const normOffsetDb = shouldNormalize ? pbMeanDb : 0;

  for (let k = 1; k < binCount; k++) {
    const f = freqData.frequency[k];
    const sample = interpolateFrdCurveLogFreq(curve, f);
    const relDb = sample.magDb - normOffsetDb;
    const linMag = Math.pow(10.0, relDb / 20.0);
    freqData.magnitude[k] = linMag;
    freqData.module[k] = linMag * Math.pow(10.0, -30.0 / 20.0);
    freqData.phaseReal[k] = Math.cos(sample.phaseRad);
    freqData.phaseImag[k] = Math.sin(sample.phaseRad);
    freqData.coherence[k] = 1.0;
  }

  const id = `stored-frd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const refNote = shouldNormalize
    ? `Imported .FRD (${curve.frequenciesHz.length} pts, normalized from ${pbMeanDb.toFixed(1)} dB SPL)`
    : `Imported .FRD (${curve.frequenciesHz.length} pts)`;

  return {
    id,
    name: options.name ?? 'Imported .FRD Trace',
    kind: 'stored',
    color: options.color ?? '#a855f7',
    visible: true,
    active: true,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: false,
    notes: refNote,
    createdAt: new Date().toISOString(),
    sampleRate,
    freqData,
    timeData,
  };
}

/**
 * Exports any `SourceData` trace (including effective Gain Offset, Delay Offset, and Polarity)
 * to standard 3-column `.frd` text (`FreqHz\tMagDb\tPhaseDeg`).
 */
export function exportSourceDataToFrd(source: SourceData): string {
  const B = source.freqData.length;
  const freqs: number[] = [];
  const magsDb: number[] = [];
  const phasesDeg: number[] = [];
  const bin: EffectiveBinResponse = {
    frequency: 0,
    module: 0,
    magnitude: 0,
    phaseRe: 1,
    phaseIm: 0,
    coherence: 0,
  };
  const radToDeg = 180.0 / Math.PI;

  for (let k = 1; k < B; k++) {
    writeEffectiveBinResponse(source, k, bin);
    if (bin.frequency < 10 || bin.frequency > 24000) continue;
    freqs.push(bin.frequency);
    magsDb.push(bin.magnitude > 1e-10 ? 20.0 * Math.log10(bin.magnitude) : -120.0);
    phasesDeg.push(Math.atan2(bin.phaseIm, bin.phaseRe) * radToDeg);
  }

  return serializeFrdText(
    freqs,
    magsDb,
    phasesDeg,
    `WebSoundMeter Trace — ${source.name} (${source.notes || source.kind})`
  );
}

