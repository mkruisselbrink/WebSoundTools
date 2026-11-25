// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Phase-Vocoder Instantaneous Frequency & Phase Coherence Tracker (`src/dsp/feedback-phase-tracker.ts`).
 *
 * Refines sub-bin candidate frequencies using unwrapped frame-to-frame FFT phase advance
 * and measures phase-lock coherence (`[0, 1]`) and rolling pitch jitter (`cents`) to separate
 * phase-locked Barkhausen feedback loops from vocal vibrato, instrument bends, and narrowband noise.
 */

const TWO_PI = 2.0 * Math.PI;
const TRACK_FREQ_HISTORY_LEN = 8;

export function wrapPhaseRad(angleRad: number): number {
  let w = (angleRad + Math.PI) % TWO_PI;
  if (w < 0) w += TWO_PI;
  return w - Math.PI;
}

export interface PhaseRefinedEstimate {
  /** Phase-vocoder refined instantaneous frequency in Hz */
  readonly refinedFreqHz: number;
  /** Cosine of residual phase prediction error in [-1, 1] (1.0 = perfect phase lock) */
  readonly phaseStepCos: number;
  /** Whether a valid previous-frame phase reference existed for this bin */
  readonly hasPhaseLockSample: boolean;
}

/**
 * Maintains previous-frame FFT bin phases (`atan2(im, re)`) for zero-allocation
 * heterodyned phase-vocoder instantaneous frequency estimation.
 */
export class SpectrumPhaseHistory {
  private prevPhaseRad: Float32Array = new Float32Array(0);
  private prevMag: Float32Array = new Float32Array(0);
  private hasPreviousFrame = false;
  private lastFftSize = 0;
  private lastSampleRate = 0;

  reset(): void {
    this.hasPreviousFrame = false;
  }

  /**
   * Computes a phase-vocoder refined frequency and phase-prediction coherence sample
   * for a candidate peak at `binIndex` (with parabolic sub-bin offset `parabolicDelta`),
   * comparing `curRe/curIm` against the stored previous frame advanced by `hopSamples`.
   */
  refinePeak(params: {
    readonly binIndex: number;
    readonly parabolicDelta: number;
    readonly curRe: Float32Array;
    readonly curIm: Float32Array;
    readonly fftSize: number;
    readonly sampleRate: number;
    readonly hopSamples: number;
  }): PhaseRefinedEstimate {
    const {
      binIndex,
      parabolicDelta,
      curRe,
      curIm,
      fftSize,
      sampleRate,
      hopSamples,
    } = params;
    const df = sampleRate / fftSize;
    const parabolicFreqHz = (binIndex + parabolicDelta) * df;

    if (
      !this.hasPreviousFrame ||
      this.lastFftSize !== fftSize ||
      this.lastSampleRate !== sampleRate ||
      hopSamples <= 0 ||
      hopSamples > fftSize * 4 ||
      binIndex < 1 ||
      binIndex >= this.prevPhaseRad.length
    ) {
      return {
        refinedFreqHz: parabolicFreqHz,
        phaseStepCos: 1.0,
        hasPhaseLockSample: false,
      };
    }

    const prevAmp = this.prevMag[binIndex];
    const re = curRe[binIndex];
    const im = curIm[binIndex];
    const curAmp = Math.hypot(re, im);
    if (prevAmp < 1e-7 || curAmp < 1e-7) {
      return {
        refinedFreqHz: parabolicFreqHz,
        phaseStepCos: 0.0,
        hasPhaseLockSample: false,
      };
    }

    const curPhi = Math.atan2(im, re);
    const prevPhi = this.prevPhaseRad[binIndex];

    // Predict expected phase advance using the parabolic sub-bin frequency so hops > N/2 never alias
    const expectedAdvance = (TWO_PI * (binIndex + parabolicDelta) * hopSamples) / fftSize;
    const residualRad = wrapPhaseRad(curPhi - prevPhi - expectedAdvance);
    const phaseStepCos = Math.cos(residualRad);

    // Refine sub-bin offset when hop is short enough to avoid wrap ambiguity, clamped near parabolic peak
    const deltaRefine = (residualRad * fftSize) / (TWO_PI * hopSamples);
    const clampedRefine = Math.max(-0.25, Math.min(0.25, deltaRefine));
    const refinedBin = binIndex + Math.max(-0.6, Math.min(0.6, parabolicDelta + clampedRefine));

    return {
      refinedFreqHz: Math.max(df, refinedBin * df),
      phaseStepCos,
      hasPhaseLockSample: true,
    };
  }

  /**
   * Commits the current frame's complex spectrum into the phase history buffer.
   * Call once at the end of `FeedbackDetector.processFrame` when `hopSamples > 0`.
   */
  commitSpectrum(
    specRe: Float32Array,
    specIm: Float32Array,
    fftSize: number,
    sampleRate: number
  ): void {
    const B = specRe.length;
    if (this.prevPhaseRad.length !== B) {
      this.prevPhaseRad = new Float32Array(B);
      this.prevMag = new Float32Array(B);
    }
    for (let k = 0; k < B; k++) {
      const re = specRe[k];
      const im = specIm[k];
      this.prevMag[k] = Math.hypot(re, im);
      this.prevPhaseRad[k] = Math.atan2(im, re);
    }
    this.lastFftSize = fftSize;
    this.lastSampleRate = sampleRate;
    this.hasPreviousFrame = true;
  }
}

/**
 * Rolling per-track buffer for instantaneous frequency history (`Hz`) and phase coherence,
 *allocated once when a candidate track is created.
 */
export interface TrackPitchStatsBuffer {
  readonly freqRing: Float64Array;
  readonly phaseCosRing: Float32Array;
  writeIdx: number;
  count: number;
  phaseSampleCount: number;
}

export function createTrackPitchStatsBuffer(initialFreqHz: number): TrackPitchStatsBuffer {
  const freqRing = new Float64Array(TRACK_FREQ_HISTORY_LEN);
  const phaseCosRing = new Float32Array(TRACK_FREQ_HISTORY_LEN);
  freqRing[0] = initialFreqHz;
  phaseCosRing[0] = 1.0;
  return {
    freqRing,
    phaseCosRing,
    writeIdx: 1,
    count: 1,
    phaseSampleCount: 0,
  };
}

export function pushTrackPitchSample(
  buf: TrackPitchStatsBuffer,
  freqHz: number,
  phaseStepCos: number,
  hasPhaseLockSample: boolean
): void {
  const idx = buf.writeIdx % TRACK_FREQ_HISTORY_LEN;
  buf.freqRing[idx] = freqHz;
  if (hasPhaseLockSample) {
    const pIdx = buf.phaseSampleCount % TRACK_FREQ_HISTORY_LEN;
    buf.phaseCosRing[pIdx] = phaseStepCos;
    buf.phaseSampleCount++;
  }
  buf.writeIdx = (idx + 1) % TRACK_FREQ_HISTORY_LEN;
  if (buf.count < TRACK_FREQ_HISTORY_LEN) {
    buf.count++;
  }
}

/**
 * Computes rolling pitch jitter standard deviation in musical cents (`100 cents = 1 semitone`)
 * and mean phase-prediction coherence (`[-1, 1]`).
 */
export function evaluateTrackPitchStability(buf: TrackPitchStatsBuffer): {
  readonly pitchStdCents: number;
  readonly phaseCoherence: number;
} {
  if (buf.count <= 1) {
    return { pitchStdCents: 0, phaseCoherence: 1.0 };
  }

  let sumLog2 = 0;
  for (let i = 0; i < buf.count; i++) {
    sumLog2 += Math.log2(Math.max(1.0, buf.freqRing[i]));
  }
  const meanLog2 = sumLog2 / buf.count;

  let varCentsSq = 0;
  for (let i = 0; i < buf.count; i++) {
    const cents = 1200.0 * (Math.log2(Math.max(1.0, buf.freqRing[i])) - meanLog2);
    varCentsSq += cents * cents;
  }
  const pitchStdCents = Math.sqrt(varCentsSq / buf.count);

  const pLen = Math.min(buf.phaseSampleCount, TRACK_FREQ_HISTORY_LEN);
  if (pLen === 0) {
    return { pitchStdCents, phaseCoherence: 1.0 };
  }
  let sumCos = 0;
  for (let i = 0; i < pLen; i++) {
    sumCos += buf.phaseCosRing[i];
  }
  return {
    pitchStdCents,
    phaseCoherence: sumCos / pLen,
  };
}
