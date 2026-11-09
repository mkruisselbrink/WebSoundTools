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
 * Complete Dual-Channel Measurement DSP Pipeline.
 *
 * Orchestrates:
 *  - Circular sample buffers (65,536 samples) for Measurement (M) and Reference (R)
 *  - Sample-accurate Delay Compensation (aligning R to M by `delaySamples`)
 *  - Input Gain, Polarity, and Pre-filtering (Z, A, C, 1kHz Notch)
 *  - Broadband SPL / Leq / Peak Metering (IEC 61672 A/C/Z, Fast/Slow/Impulse/Leq)
 *  - Windowed Dual-Real Radix-2 FFT (1024 .. 65536)
 *  - Transfer Function (H1 / Ratio), Complex Phase, Coherence, Peak & Crest Factor
 *  - Regularized Deconvolution (Impulse & Step Response) + Auto Delay Finder
 *  - Fractional-Octave Smoothing & Microphone Calibration (.cal)
 */

import { BiquadCascade, computeBiquadCoefficients } from './biquad.js';
import {
  CalibrationCurve,
  interpolateCalibrationCurve,
} from './calibration.js';
import { DeconvolutionAnalyzer, DelayEstimate } from './deconvolution.js';
import { Radix2FFT } from './fft.js';
import {
  OCTAVE_SMOOTHING_FRACTIONS,
  OctaveSmoothingType,
  smoothMagnitudeOctave,
  smoothPhaseOctave,
} from './smoothing.js';
import {
  AveragingType,
  TransferEstimatorType,
  TransferFunctionAnalyzer,
} from './transfer-function.js';
import {
  BroadbandMeterBank,
  createWeightingBiquadCoeffs,
} from './weighting-meters.js';
import { WindowFunctionType } from './window-functions.js';
import { SourceData } from '../sources/source-data.js';

export type InputPreFilterType = 'Z' | 'A' | 'C' | 'notch-1k';

export interface MeasurementPipelineConfig {
  id: string;
  name: string;
  color: string;
  sampleRate: number;
  fftSize: number;
  windowType: WindowFunctionType;
  averagingType: AveragingType;
  fifoDepth: number;
  lpfCutoffHz: number;
  coherenceDepth: number;
  estimator: TransferEstimatorType;
  octaveSmoothing: OctaveSmoothingType;
  /** Delay applied to Reference channel in milliseconds to align with Measurement */
  delayMs: number;
  /** Input gain applied to Measurement channel in dB */
  gainDb: number;
  invertPolarity: boolean;
  inputFilter: InputPreFilterType;
  splOffsetDb: number;
  calibrationEnabled: boolean;
}

export const DEFAULT_MEASUREMENT_CONFIG: MeasurementPipelineConfig = {
  id: 'live-measurement',
  name: 'Live Measurement',
  color: '#38bdf8',
  sampleRate: 48000,
  fftSize: 4096,
  windowType: 'hann',
  averagingType: 'fifo',
  fifoDepth: 16,
  lpfCutoffHz: 1.0,
  coherenceDepth: 16,
  estimator: 'h1',
  octaveSmoothing: 'off',
  delayMs: 0.0,
  gainDb: 0.0,
  invertPolarity: false,
  inputFilter: 'Z',
  splOffsetDb: 100.0,
  calibrationEnabled: false,
};

/** Sentinel value on `LiveMeasurementSlotConfig.referenceChannel` meaning "follow the Topbar Global Reference Channel". */
export const REFERENCE_CHANNEL_GLOBAL = -2;

export function resolveEffectiveReferenceChannel(
  slotRefChannel: number,
  globalRefChannel: number
): number {
  return slotRefChannel === REFERENCE_CHANNEL_GLOBAL
    ? globalRefChannel
    : slotRefChannel;
}

export const SHARED_MEASUREMENT_CONFIG_KEYS = [
  'sampleRate',
  'fftSize',
  'windowType',
  'averagingType',
  'fifoDepth',
  'lpfCutoffHz',
  'coherenceDepth',
  'estimator',
  'octaveSmoothing',
] as const;

export function splitMeasurementConfigPartial(
  partial: Partial<MeasurementPipelineConfig>
): {
  sharedPartial: Partial<MeasurementPipelineConfig>;
  perSlotPartial: Partial<MeasurementPipelineConfig>;
} {
  const sharedPartial: Partial<MeasurementPipelineConfig> = {};
  const perSlotPartial: Partial<MeasurementPipelineConfig> = {};
  const sharedSet = new Set<string>(SHARED_MEASUREMENT_CONFIG_KEYS);
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if (sharedSet.has(k)) {
      (sharedPartial as Record<string, unknown>)[k] = v;
    } else {
      (perSlotPartial as Record<string, unknown>)[k] = v;
    }
  }
  return { sharedPartial, perSlotPartial };
}

export class MeasurementPipeline {
  private config: MeasurementPipelineConfig;
  private readonly bufferCapacity = 131072; // 2^17 samples (~2.73 sec at 48 kHz)
  private readonly bufferMask = 131072 - 1;
  private readonly circM: Float32Array;
  private readonly circR: Float32Array;
  private writePtr: number = 0;

  private fft: Radix2FFT;
  private tf: TransferFunctionAnalyzer;
  private deconv: DeconvolutionAnalyzer;
  private delayFinder: DeconvolutionAnalyzer;
  private readonly meters: BroadbandMeterBank;

  private readonly preFilterM: BiquadCascade;
  private readonly preFilterR: BiquadCascade;

  // Scratch buffers
  private blockM: Float32Array;
  private blockR: Float32Array;
  private specMRe: Float32Array;
  private specMIm: Float32Array;
  private specRRe: Float32Array;
  private specRIm: Float32Array;

  // Smoothed output buffers
  private outModule: Float32Array;
  private outMagnitude: Float32Array;
  private outPhaseRe: Float32Array;
  private outPhaseIm: Float32Array;

  // Calibration
  private calibrationCurve: CalibrationCurve | null = null;
  private calGainLinear: Float32Array | undefined;
  private calPhaseRad: Float32Array | undefined;

  private transformCount: number = 0;
  private latestDelayEstimate: DelayEstimate = {
    delaySamples: 0,
    subsampleDelaySamples: 0,
    delayMs: 0,
    peakAmplitude: 0,
    polarity: 1,
  };

  constructor(initialConfig: Partial<MeasurementPipelineConfig> = {}) {
    this.config = { ...DEFAULT_MEASUREMENT_CONFIG, ...initialConfig };
    this.circM = new Float32Array(this.bufferCapacity);
    this.circR = new Float32Array(this.bufferCapacity);

    this.preFilterM = new BiquadCascade();
    this.preFilterR = new BiquadCascade();
    this.meters = new BroadbandMeterBank(this.config.sampleRate, this.config.splOffsetDb);

    const N = this.config.fftSize;
    const B = (N >>> 1) + 1;
    this.fft = new Radix2FFT(N, this.config.windowType);
    this.tf = new TransferFunctionAnalyzer({
      fftSize: N,
      sampleRate: this.config.sampleRate,
      averagingType: this.config.averagingType,
      fifoDepth: this.config.fifoDepth,
      lpfCutoffHz: this.config.lpfCutoffHz,
      coherenceDepth: this.config.coherenceDepth,
      estimator: this.config.estimator,
    });
    this.deconv = new DeconvolutionAnalyzer(N, this.config.sampleRate, this.config.windowType);
    // Dedicated 16384-point (~341 ms window) delay finder so long delays are found even when FFT is 1024/2048
    this.delayFinder = new DeconvolutionAnalyzer(16384, this.config.sampleRate, 'hann');

    this.blockM = new Float32Array(N);
    this.blockR = new Float32Array(N);
    this.specMRe = new Float32Array(B);
    this.specMIm = new Float32Array(B);
    this.specRRe = new Float32Array(B);
    this.specRIm = new Float32Array(B);

    this.outModule = new Float32Array(B);
    this.outMagnitude = new Float32Array(B);
    this.outPhaseRe = new Float32Array(B);
    this.outPhaseIm = new Float32Array(B);

    this.rebuildInputFilters();
  }

  getConfig(): MeasurementPipelineConfig {
    return this.config;
  }

  updateConfig(partial: Partial<MeasurementPipelineConfig>): void {
    const prev = this.config;
    this.config = { ...prev, ...partial };

    if (partial.fftSize !== undefined && partial.fftSize !== prev.fftSize) {
      const N = this.config.fftSize;
      const B = (N >>> 1) + 1;
      this.fft = new Radix2FFT(N, this.config.windowType);
      this.tf = new TransferFunctionAnalyzer({
        fftSize: N,
        sampleRate: this.config.sampleRate,
        averagingType: this.config.averagingType,
        fifoDepth: this.config.fifoDepth,
        lpfCutoffHz: this.config.lpfCutoffHz,
        coherenceDepth: this.config.coherenceDepth,
        estimator: this.config.estimator,
      });
      this.deconv = new DeconvolutionAnalyzer(N, this.config.sampleRate, this.config.windowType);
      this.blockM = new Float32Array(N);
      this.blockR = new Float32Array(N);
      this.specMRe = new Float32Array(B);
      this.specMIm = new Float32Array(B);
      this.specRRe = new Float32Array(B);
      this.specRIm = new Float32Array(B);
      this.outModule = new Float32Array(B);
      this.outMagnitude = new Float32Array(B);
      this.outPhaseRe = new Float32Array(B);
      this.outPhaseIm = new Float32Array(B);
      this.rebuildCalibrationArrays();
    } else {
      if (partial.windowType !== undefined) {
        this.fft.setWindowType(this.config.windowType);
        this.deconv.setWindowType(this.config.windowType);
      }
      if (partial.sampleRate !== undefined && partial.sampleRate !== prev.sampleRate) {
        this.deconv.setSampleRate(this.config.sampleRate);
        this.delayFinder.setSampleRate(this.config.sampleRate);
        this.meters.setSampleRate(this.config.sampleRate);
        this.rebuildInputFilters();
        this.rebuildCalibrationArrays();
      }
      this.tf.updateConfig({
        sampleRate: this.config.sampleRate,
        averagingType: this.config.averagingType,
        fifoDepth: this.config.fifoDepth,
        lpfCutoffHz: this.config.lpfCutoffHz,
        coherenceDepth: this.config.coherenceDepth,
        estimator: this.config.estimator,
      });
    }

    if (partial.inputFilter !== undefined && partial.inputFilter !== prev.inputFilter) {
      this.rebuildInputFilters();
    }
    if (partial.splOffsetDb !== undefined) {
      this.meters.setSplOffsetDb(this.config.splOffsetDb);
    }
    if (partial.delayMs !== undefined && partial.delayMs !== prev.delayMs) {
      this.tf.reset();
      this.deconv.reset();
    }
  }

  setCalibrationCurve(curve: CalibrationCurve | null): void {
    this.calibrationCurve = curve;
    this.rebuildCalibrationArrays();
  }

  getCalibrationCurve(): CalibrationCurve | null {
    return this.calibrationCurve;
  }

  private rebuildCalibrationArrays(): void {
    if (!this.calibrationCurve || this.calibrationCurve.points.length === 0) {
      this.calGainLinear = undefined;
      this.calPhaseRad = undefined;
      return;
    }
    const { gainLinear, phaseRad } = interpolateCalibrationCurve(
      this.calibrationCurve,
      this.tf.frequency
    );
    this.calGainLinear = gainLinear;
    this.calPhaseRad = phaseRad;
  }

  private rebuildInputFilters(): void {
    const sr = this.config.sampleRate;
    const fType = this.config.inputFilter;
    if (fType === 'Z') {
      this.preFilterM.setCoefficientsList([]);
      this.preFilterR.setCoefficientsList([]);
    } else if (fType === 'A' || fType === 'C') {
      const coeffs = createWeightingBiquadCoeffs(fType, sr);
      this.preFilterM.setCoefficientsList(coeffs);
      this.preFilterR.setCoefficientsList(coeffs);
    } else if (fType === 'notch-1k') {
      const notch = computeBiquadCoefficients({ type: 'notch', frequency: 1000, q: 3.0 }, sr);
      this.preFilterM.setCoefficientsList([notch]);
      this.preFilterR.setCoefficientsList([notch]);
    }
  }

  resetAveraging(): void {
    this.tf.reset();
    this.deconv.reset();
    this.meters.reset();
  }

  /**
   * Feeds incoming raw time-domain samples for Measurement `samplesM` and Reference `samplesR`.
   */
  writeSamples(samplesM: Float32Array, samplesR: Float32Array, length: number = samplesM.length): void {
    const gainLinear =
      Math.pow(10.0, this.config.gainDb / 20.0) * (this.config.invertPolarity ? -1.0 : 1.0);
    const mask = this.bufferMask;

    // Feed broadband meters with gain-adjusted (unweighted) Measurement and raw Reference
    for (let i = 0; i < length; i++) {
      const rawM = samplesM[i] * gainLinear;
      const rawR = samplesR[i];

      this.meters.processSample(rawM, rawR);

      const filtM = this.preFilterM.processSample(rawM);
      const filtR = this.preFilterR.processSample(rawR);

      this.circM[this.writePtr] = filtM;
      this.circR[this.writePtr] = filtR;
      this.writePtr = (this.writePtr + 1) & mask;
    }
  }

  /**
   * Extracts a time-aligned window of length `windowSize` from the circular buffers,
   * where Reference is delayed by `delaySamples` to compensate for acoustic propagation delay.
   */
  private extractAlignedWindow(
    outM: Float32Array,
    outR: Float32Array,
    windowSize: number,
    delaySamples: number
  ): void {
    const mask = this.bufferMask;
    // If delaySamples > 0, Measurement arrives `delaySamples` AFTER Reference,
    // so we read Reference from `delaySamples` earlier in the circular buffer.
    const offsetM = delaySamples < 0 ? -delaySamples : 0;
    const offsetR = delaySamples > 0 ? delaySamples : 0;

    const startM = (this.writePtr - windowSize - offsetM) & mask;
    const startR = (this.writePtr - windowSize - offsetR) & mask;

    for (let i = 0; i < windowSize; i++) {
      outM[i] = this.circM[(startM + i) & mask];
      outR[i] = this.circR[(startR + i) & mask];
    }
  }

  /**
   * Immediately runs the 16384-point Auto Delay Finder and returns the total propagation delay
   * (current `delayMs` + residual `deltaDelayMs`).
   */
  findDelayNow(): DelayEstimate {
    const N = this.delayFinder.size;
    const bufM = new Float32Array(N);
    const bufR = new Float32Array(N);
    const currentDelaySamples = Math.round(
      (this.config.delayMs * this.config.sampleRate) / 1000.0
    );

    this.extractAlignedWindow(bufM, bufR, N, currentDelaySamples);
    const residual = this.delayFinder.processTimeDomain(bufM, bufR, 0);

    const totalDelaySamples = currentDelaySamples + residual.delaySamples;
    const totalSubsample = currentDelaySamples + residual.subsampleDelaySamples;
    const totalDelayMs = (1000.0 * totalSubsample) / this.config.sampleRate;

    this.latestDelayEstimate = {
      delaySamples: totalDelaySamples,
      subsampleDelaySamples: totalSubsample,
      delayMs: totalDelayMs,
      peakAmplitude: residual.peakAmplitude,
      polarity: residual.polarity,
    };
    return this.latestDelayEstimate;
  }

  /**
   * Runs one analysis transform frame and returns the updated `SourceData` snapshot.
   */
  computeTransform(dtSeconds: number = 0.04): SourceData {
    const N = this.config.fftSize;
    const currentDelaySamples = Math.round(
      (this.config.delayMs * this.config.sampleRate) / 1000.0
    );

    this.extractAlignedWindow(this.blockM, this.blockR, N, currentDelaySamples);

    this.fft.transformDualReal(
      this.blockM,
      this.blockR,
      this.specMRe,
      this.specMIm,
      this.specRRe,
      this.specRIm,
      true
    );

    const useCal = this.config.calibrationEnabled && this.calGainLinear !== undefined;
    this.tf.processFrame(
      this.specMRe,
      this.specMIm,
      this.specRRe,
      this.specRIm,
      dtSeconds,
      useCal ? this.calGainLinear : undefined,
      useCal ? this.calPhaseRad : undefined
    );

    const deconvSmoothing = this.config.averagingType === 'off' ? 0.0 : 0.75;
    const residualDelay = this.deconv.processSpectra(
      this.specMRe,
      this.specMIm,
      this.specRRe,
      this.specRIm,
      deconvSmoothing
    );

    // Every 15 frames (~0.5s) update the wide-range delay finder; otherwise use deconv residual
    this.transformCount++;
    if (this.transformCount % 15 === 1) {
      this.findDelayNow();
    } else {
      const totalDelaySamples = currentDelaySamples + residualDelay.delaySamples;
      const totalSubsample = currentDelaySamples + residualDelay.subsampleDelaySamples;
      this.latestDelayEstimate = {
        delaySamples: totalDelaySamples,
        subsampleDelaySamples: totalSubsample,
        delayMs: (1000.0 * totalSubsample) / this.config.sampleRate,
        peakAmplitude: residualDelay.peakAmplitude,
        polarity: residualDelay.polarity,
      };
    }

    // Apply optional fractional-octave smoothing
    const smoothFrac = OCTAVE_SMOOTHING_FRACTIONS[this.config.octaveSmoothing];
    if (smoothFrac > 0) {
      smoothMagnitudeOctave(this.tf.module, this.outModule, smoothFrac);
      smoothMagnitudeOctave(this.tf.magnitude, this.outMagnitude, smoothFrac);
      smoothPhaseOctave(
        this.tf.phaseReal,
        this.tf.phaseImag,
        this.outPhaseRe,
        this.outPhaseIm,
        smoothFrac
      );
    } else {
      this.outModule.set(this.tf.module);
      this.outMagnitude.set(this.tf.magnitude);
      this.outPhaseRe.set(this.tf.phaseReal);
      this.outPhaseIm.set(this.tf.phaseImag);
    }

    return {
      id: this.config.id,
      name: this.config.name,
      kind: 'measurement',
      color: this.config.color,
      visible: true,
      active: true,
      gainOffsetDb: 0,
      delayOffsetMs: 0,
      invertPolarity: false,
      notes: `FFT ${N} | ${this.config.windowType} | Avg: ${this.config.averagingType} | Delay: ${this.config.delayMs.toFixed(2)} ms`,
      createdAt: '',
      sampleRate: this.config.sampleRate,
      freqData: {
        length: this.tf.binCount,
        frequency: this.tf.frequency,
        module: this.outModule,
        magnitude: this.outMagnitude,
        phaseReal: this.outPhaseRe,
        phaseImag: this.outPhaseIm,
        coherence: this.tf.coherence,
        peakSquared: this.tf.peakSquared,
        meanSquared: this.tf.meanSquared,
      },
      timeData: {
        length: this.deconv.size,
        timeMs: this.deconv.timeMs,
        impulse: this.deconv.impulse,
        stepResponse: this.deconv.stepResponse,
      },
      levels: this.meters.getSnapshot(),
      delayEstimate: this.latestDelayEstimate,
    };
  }
}

