/**
 * Dual-Channel Transfer Function, Spectrum (RTA), Complex Phase, Coherence, and Crest Factor Engine.
 *
 * Supports:
 *  - H1 Cross-Spectral Estimator: H1(f) = <G_rm(f)> / <G_rr(f)> (Smaart-style noise rejection)
 *  - Ratio Estimator: <|M(f)| / |R(f)|> + Complex Unit Vector Phase (OSM-style)
 *  - Averaging modes: 'off', 'fifo' (rolling ring buffer of N frames), 'lpf' (exponential/LPF time constant)
 *  - Magnitude-Squared Coherence: gamma^2(f) = |<G_rm(f)>|^2 / (<G_rr(f)> * <G_mm(f)>)
 */

export type AveragingType = 'off' | 'fifo' | 'lpf';
export type TransferEstimatorType = 'h1' | 'ratio';

export interface TransferFunctionConfig {
  fftSize: number;
  sampleRate: number;
  averagingType: AveragingType;
  /** Number of frames for FIFO averaging (e.g. 4..128) */
  fifoDepth: number;
  /** Cutoff frequency in Hz for LPF averaging (e.g. 0.25, 0.5, 1.0, 2.0 Hz) */
  lpfCutoffHz: number;
  /** Rolling window depth for Coherence calculation (default 16) */
  coherenceDepth: number;
  /** Estimator formula: 'h1' (default) or 'ratio' */
  estimator: TransferEstimatorType;
}

export class TransferFunctionAnalyzer {
  readonly binCount: number;
  private config: TransferFunctionConfig;

  // Output arrays (length = binCount = fftSize / 2 + 1)
  readonly frequency: Float32Array;
  readonly module: Float32Array;        // RTA linear RMS magnitude of Measurement channel
  readonly magnitude: Float32Array;     // Linear transfer function |H(f)|
  readonly phaseReal: Float32Array;     // cos(phi)
  readonly phaseImag: Float32Array;     // sin(phi)
  readonly coherence: Float32Array;     // gamma^2(f) in [0, 1]
  readonly peakSquared: Float32Array;   // Peak hold |M(f)|^2
  readonly meanSquared: Float32Array;   // Smoothed |M(f)|^2 for Crest Factor

  // FIFO ring buffers (size = maxFifoDepth * binCount)
  private maxFifoCapacity: number;
  private fifoGrmRe: Float32Array;
  private fifoGrmIm: Float32Array;
  private fifoGrr: Float32Array;
  private fifoGmm: Float32Array;
  private fifoMagRatio: Float32Array;
  private fifoPhaseRe: Float32Array;
  private fifoPhaseIm: Float32Array;
  private fifoPointer: number = 0;
  private fifoCount: number = 0;

  // Running sums for O(1) FIFO updates & LPF state
  private sumGrmRe: Float32Array;
  private sumGrmIm: Float32Array;
  private sumGrr: Float32Array;
  private sumGmm: Float32Array;
  private sumMagRatio: Float32Array;
  private sumPhaseRe: Float32Array;
  private sumPhaseIm: Float32Array;

  // Dedicated rolling window for Coherence (so coherence works even when main averaging is 'off')
  private cohDepth: number;
  private cohGrmRe: Float32Array;
  private cohGrmIm: Float32Array;
  private cohGrr: Float32Array;
  private cohGmm: Float32Array;
  private cohSumGrmRe: Float32Array;
  private cohSumGrmIm: Float32Array;
  private cohSumGrr: Float32Array;
  private cohSumGmm: Float32Array;
  private cohPointer: number = 0;
  private cohCount: number = 0;

  constructor(config: Partial<TransferFunctionConfig> & { fftSize: number; sampleRate: number }) {
    this.config = {
      averagingType: 'fifo',
      fifoDepth: 16,
      lpfCutoffHz: 1.0,
      coherenceDepth: 16,
      estimator: 'h1',
      ...config,
    };

    this.binCount = (this.config.fftSize >>> 1) + 1;
    const B = this.binCount;

    this.frequency = new Float32Array(B);
    this.module = new Float32Array(B);
    this.magnitude = new Float32Array(B);
    this.phaseReal = new Float32Array(B);
    this.phaseImag = new Float32Array(B);
    this.coherence = new Float32Array(B);
    this.peakSquared = new Float32Array(B);
    this.meanSquared = new Float32Array(B);

    this.maxFifoCapacity = Math.max(128, this.config.fifoDepth);
    this.fifoGrmRe = new Float32Array(this.maxFifoCapacity * B);
    this.fifoGrmIm = new Float32Array(this.maxFifoCapacity * B);
    this.fifoGrr = new Float32Array(this.maxFifoCapacity * B);
    this.fifoGmm = new Float32Array(this.maxFifoCapacity * B);
    this.fifoMagRatio = new Float32Array(this.maxFifoCapacity * B);
    this.fifoPhaseRe = new Float32Array(this.maxFifoCapacity * B);
    this.fifoPhaseIm = new Float32Array(this.maxFifoCapacity * B);

    this.sumGrmRe = new Float32Array(B);
    this.sumGrmIm = new Float32Array(B);
    this.sumGrr = new Float32Array(B);
    this.sumGmm = new Float32Array(B);
    this.sumMagRatio = new Float32Array(B);
    this.sumPhaseRe = new Float32Array(B);
    this.sumPhaseIm = new Float32Array(B);

    this.cohDepth = Math.max(2, this.config.coherenceDepth);
    this.cohGrmRe = new Float32Array(this.cohDepth * B);
    this.cohGrmIm = new Float32Array(this.cohDepth * B);
    this.cohGrr = new Float32Array(this.cohDepth * B);
    this.cohGmm = new Float32Array(this.cohDepth * B);
    this.cohSumGrmRe = new Float32Array(B);
    this.cohSumGrmIm = new Float32Array(B);
    this.cohSumGrr = new Float32Array(B);
    this.cohSumGmm = new Float32Array(B);

    this.updateFrequencyAxis();
    this.reset();
  }

  private updateFrequencyAxis(): void {
    const df = this.config.sampleRate / this.config.fftSize;
    for (let k = 0; k < this.binCount; k++) {
      this.frequency[k] = k * df;
    }
  }

  updateConfig(partial: Partial<TransferFunctionConfig>): void {
    const needReset =
      (partial.averagingType !== undefined && partial.averagingType !== this.config.averagingType) ||
      (partial.fifoDepth !== undefined && partial.fifoDepth !== this.config.fifoDepth) ||
      (partial.sampleRate !== undefined && partial.sampleRate !== this.config.sampleRate);

    Object.assign(this.config, partial);
    if (partial.sampleRate !== undefined) {
      this.updateFrequencyAxis();
    }
    if (needReset) {
      this.reset();
    }
  }

  reset(): void {
    this.fifoGrmRe.fill(0);
    this.fifoGrmIm.fill(0);
    this.fifoGrr.fill(0);
    this.fifoGmm.fill(0);
    this.fifoMagRatio.fill(0);
    this.fifoPhaseRe.fill(0);
    this.fifoPhaseIm.fill(0);
    this.fifoPointer = 0;
    this.fifoCount = 0;

    this.sumGrmRe.fill(0);
    this.sumGrmIm.fill(0);
    this.sumGrr.fill(0);
    this.sumGmm.fill(0);
    this.sumMagRatio.fill(0);
    this.sumPhaseRe.fill(0);
    this.sumPhaseIm.fill(0);

    this.cohGrmRe.fill(0);
    this.cohGrmIm.fill(0);
    this.cohGrr.fill(0);
    this.cohGmm.fill(0);
    this.cohSumGrmRe.fill(0);
    this.cohSumGrmIm.fill(0);
    this.cohSumGrr.fill(0);
    this.cohSumGmm.fill(0);
    this.cohPointer = 0;
    this.cohCount = 0;

    this.peakSquared.fill(0);
    this.meanSquared.fill(0);
    this.phaseReal.fill(1);
    this.phaseImag.fill(0);
    this.coherence.fill(0);
  }

  resetPeaks(): void {
    this.peakSquared.fill(0);
  }

  /**
   * Processes a new frame of complex spectra M(k) and R(k) (length = binCount).
   * `dtSeconds` is the time elapsed since the previous frame (used for LPF averaging).
   */
  processFrame(
    mRe: Float32Array,
    mIm: Float32Array,
    rRe: Float32Array,
    rIm: Float32Array,
    dtSeconds: number = 0.04,
    calibrationGain?: Float32Array,
    calibrationPhaseRad?: Float32Array
  ): void {
    const B = this.binCount;
    const avgType = this.config.averagingType;
    const estimator = this.config.estimator;
    const depth = Math.max(1, Math.min(this.config.fifoDepth, this.maxFifoCapacity));

    const fifoOffset = this.fifoPointer * B;
    const cohOffset = this.cohPointer * B;

    // LPF smoothing factor alpha in (0, 1]
    const rc = 1.0 / (2.0 * Math.PI * Math.max(0.05, this.config.lpfCutoffHz));
    const lpfAlpha = this.fifoCount === 0 ? 1.0 : Math.min(1.0, dtSeconds / (rc + dtSeconds));
    const oneMinusAlpha = 1.0 - lpfAlpha;

    const EPS = 1e-24;

    for (let k = 0; k < B; k++) {
      let mkRe = mRe[k];
      let mkIm = mIm[k];
      const rkRe = rRe[k];
      const rkIm = rIm[k];

      // Apply optional microphone calibration (gain linear multiplier & phase rotation)
      if (calibrationGain) {
        const invGain = 1.0 / Math.max(1e-6, calibrationGain[k]);
        mkRe *= invGain;
        mkIm *= invGain;
      }
      if (calibrationPhaseRad) {
        const calPhi = calibrationPhaseRad[k];
        if (calPhi !== 0) {
          const c = Math.cos(-calPhi);
          const s = Math.sin(-calPhi);
          const rotRe = mkRe * c - mkIm * s;
          const rotIm = mkRe * s + mkIm * c;
          mkRe = rotRe;
          mkIm = rotIm;
        }
      }

      // RMS power (for single-sided spectrum, multiply amplitude by 1/sqrt(2) -> power by 0.5)
      const gmm = 0.5 * (mkRe * mkRe + mkIm * mkIm);
      const grr = 0.5 * (rkRe * rkRe + rkIm * rkIm);

      // Cross-spectrum G_rm(k) = R*(k) * M(k) = (rkRe - i*rkIm) * (mkRe + i*mkIm)
      const grmRe = 0.5 * (rkRe * mkRe + rkIm * mkIm);
      const grmIm = 0.5 * (rkRe * mkIm - rkIm * mkRe);

      // Instantaneous ratio & unit phase vector
      const mAbs = Math.sqrt(gmm);
      const rAbs = Math.sqrt(grr);
      const instRatio = rAbs > 1e-12 ? mAbs / rAbs : 0;
      const grmAbs = Math.hypot(grmRe, grmIm);
      const unitPhRe = grmAbs > 1e-18 ? grmRe / grmAbs : 1.0;
      const unitPhIm = grmAbs > 1e-18 ? grmIm / grmAbs : 0.0;

      // 1. Update Coherence rolling window
      const ci = cohOffset + k;
      this.cohSumGrmRe[k] += grmRe - this.cohGrmRe[ci];
      this.cohSumGrmIm[k] += grmIm - this.cohGrmIm[ci];
      this.cohSumGrr[k] += grr - this.cohGrr[ci];
      this.cohSumGmm[k] += gmm - this.cohGmm[ci];

      this.cohGrmRe[ci] = grmRe;
      this.cohGrmIm[ci] = grmIm;
      this.cohGrr[ci] = grr;
      this.cohGmm[ci] = gmm;

      const cohNum =
        this.cohSumGrmRe[k] * this.cohSumGrmRe[k] + this.cohSumGrmIm[k] * this.cohSumGrmIm[k];
      const cohDen = this.cohSumGrr[k] * this.cohSumGmm[k];
      this.coherence[k] = cohDen > EPS ? Math.min(1.0, Math.max(0.0, cohNum / cohDen)) : 0.0;

      // 2. Update Peak & Mean Squared for RTA / Crest Factor
      if (gmm > this.peakSquared[k]) {
        this.peakSquared[k] = gmm;
      }
      this.meanSquared[k] =
        this.fifoCount === 0 ? gmm : 0.9 * this.meanSquared[k] + 0.1 * gmm;

      // 3. Update Main Averaging (Off / FIFO / LPF)
      let avgGrmRe = grmRe;
      let avgGrmIm = grmIm;
      let avgGrr = grr;
      let avgGmm = gmm;
      let avgRatio = instRatio;
      let avgPhRe = unitPhRe;
      let avgPhIm = unitPhIm;

      if (avgType === 'fifo') {
        const fi = fifoOffset + k;
        this.sumGrmRe[k] += grmRe - this.fifoGrmRe[fi];
        this.sumGrmIm[k] += grmIm - this.fifoGrmIm[fi];
        this.sumGrr[k] += grr - this.fifoGrr[fi];
        this.sumGmm[k] += gmm - this.fifoGmm[fi];
        this.sumMagRatio[k] += instRatio - this.fifoMagRatio[fi];
        this.sumPhaseRe[k] += unitPhRe - this.fifoPhaseRe[fi];
        this.sumPhaseIm[k] += unitPhIm - this.fifoPhaseIm[fi];

        this.fifoGrmRe[fi] = grmRe;
        this.fifoGrmIm[fi] = grmIm;
        this.fifoGrr[fi] = grr;
        this.fifoGmm[fi] = gmm;
        this.fifoMagRatio[fi] = instRatio;
        this.fifoPhaseRe[fi] = unitPhRe;
        this.fifoPhaseIm[fi] = unitPhIm;

        const count = Math.min(this.fifoCount + 1, depth);
        const invCount = 1.0 / count;
        avgGrmRe = this.sumGrmRe[k] * invCount;
        avgGrmIm = this.sumGrmIm[k] * invCount;
        avgGrr = this.sumGrr[k] * invCount;
        avgGmm = this.sumGmm[k] * invCount;
        avgRatio = this.sumMagRatio[k] * invCount;
        avgPhRe = this.sumPhaseRe[k] * invCount;
        avgPhIm = this.sumPhaseIm[k] * invCount;
      } else if (avgType === 'lpf') {
        avgGrmRe = oneMinusAlpha * this.sumGrmRe[k] + lpfAlpha * grmRe;
        avgGrmIm = oneMinusAlpha * this.sumGrmIm[k] + lpfAlpha * grmIm;
        avgGrr = oneMinusAlpha * this.sumGrr[k] + lpfAlpha * grr;
        avgGmm = oneMinusAlpha * this.sumGmm[k] + lpfAlpha * gmm;
        avgRatio = oneMinusAlpha * this.sumMagRatio[k] + lpfAlpha * instRatio;
        avgPhRe = oneMinusAlpha * this.sumPhaseRe[k] + lpfAlpha * unitPhRe;
        avgPhIm = oneMinusAlpha * this.sumPhaseIm[k] + lpfAlpha * unitPhIm;

        this.sumGrmRe[k] = avgGrmRe;
        this.sumGrmIm[k] = avgGrmIm;
        this.sumGrr[k] = avgGrr;
        this.sumGmm[k] = avgGmm;
        this.sumMagRatio[k] = avgRatio;
        this.sumPhaseRe[k] = avgPhRe;
        this.sumPhaseIm[k] = avgPhIm;
      }

      // Module (RTA RMS amplitude of M)
      this.module[k] = Math.sqrt(Math.max(0, avgGmm));

      // Transfer Function Magnitude & Phase
      if (estimator === 'h1') {
        const hRe = avgGrr > EPS ? avgGrmRe / avgGrr : 0;
        const hIm = avgGrr > EPS ? avgGrmIm / avgGrr : 0;
        const hMag = Math.hypot(hRe, hIm);
        this.magnitude[k] = hMag;
        if (hMag > 1e-12) {
          this.phaseReal[k] = hRe / hMag;
          this.phaseImag[k] = hIm / hMag;
        } else {
          this.phaseReal[k] = 1.0;
          this.phaseImag[k] = 0.0;
        }
      } else {
        this.magnitude[k] = avgRatio;
        const phLen = Math.hypot(avgPhRe, avgPhIm);
        if (phLen > 1e-12) {
          this.phaseReal[k] = avgPhRe / phLen;
          this.phaseImag[k] = avgPhIm / phLen;
        } else {
          this.phaseReal[k] = 1.0;
          this.phaseImag[k] = 0.0;
        }
      }
    }

    this.fifoPointer = (this.fifoPointer + 1) % depth;
    if (this.fifoCount < depth) {
      this.fifoCount++;
    }

    this.cohPointer = (this.cohPointer + 1) % this.cohDepth;
    if (this.cohCount < this.cohDepth) {
      this.cohCount++;
    }
  }
}

