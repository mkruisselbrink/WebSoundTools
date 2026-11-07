/**
 * Pure TypeScript Multi-Mode Acoustic Test Signal Generator.
 *
 * Supports:
 *  - 'pink':  Paul Kellet / Voss-McCartney -3 dB/octave Pink Noise
 *  - 'white': Flat 0 dB/octave White Noise
 *  - 'brown': -6 dB/octave Brown / Red Noise
 *  - 'sine':  Pure sinusoid at configurable `sineFrequencyHz`
 *  - 'sweep': Continuous logarithmic sine sweep (20 Hz -> 20 kHz)
 *  - 'burst': Periodic shaped pink noise burst (250 ms ON / 250 ms OFF) for dynamics & impulse testing
 */

export type GeneratorSignalType = 'pink' | 'white' | 'brown' | 'sine' | 'sweep' | 'burst';

export const GENERATOR_SIGNAL_LABELS: Record<GeneratorSignalType, string> = {
  pink: 'Pink Noise (-3 dB/oct)',
  white: 'White Noise (Flat)',
  brown: 'Brown Noise (-6 dB/oct)',
  sine: 'Sine Tone',
  sweep: 'Log Sine Sweep (20 Hz–20 kHz)',
  burst: 'Burst Pink Noise',
};

export interface SignalGeneratorConfig {
  enabled: boolean;
  type: GeneratorSignalType;
  /** Output level in dBFS (e.g. -12 dBFS) */
  levelDbFs: number;
  /** Sine frequency in Hz when type === 'sine' */
  sineFrequencyHz: number;
  /** Sweep duration in seconds when type === 'sweep' */
  sweepDurationSec: number;
}

export const DEFAULT_GENERATOR_CONFIG: SignalGeneratorConfig = {
  enabled: true,
  type: 'pink',
  levelDbFs: -12.0,
  sineFrequencyHz: 1000.0,
  sweepDurationSec: 2.0,
};

export class SignalGenerator {
  private sampleRate: number;
  private config: SignalGeneratorConfig;

  private prngState: number = 0x2468ace1;
  // Pink filter state (Paul Kellet 6-pole accurate pinking filter)
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  // Brown integrator state
  private brownState = 0;

  // Oscillator phase & sweep state
  private phase = 0;
  private sweepSamplePos = 0;
  private burstSamplePos = 0;

  constructor(sampleRate: number = 48000, config: Partial<SignalGeneratorConfig> = {}) {
    this.sampleRate = sampleRate;
    this.config = { ...DEFAULT_GENERATOR_CONFIG, ...config };
  }

  setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
  }

  updateConfig(partial: Partial<SignalGeneratorConfig>): void {
    Object.assign(this.config, partial);
  }

  getConfig(): SignalGeneratorConfig {
    return this.config;
  }

  private nextWhite(): number {
    let x = this.prngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.prngState = x;
    return (x >>> 0) / 2147483648.0 - 1.0;
  }

  private nextPink(): number {
    const white = this.nextWhite();
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.96900 * this.b2 + white * 0.1538520;
    this.b3 = 0.86650 * this.b3 + white * 0.3104856;
    this.b4 = 0.55000 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.0168980;
    const pink =
      this.b0 +
      this.b1 +
      this.b2 +
      this.b3 +
      this.b4 +
      this.b5 +
      this.b6 +
      white * 0.5362;
    this.b6 = white * 0.115926;
    return pink * 0.18;
  }

  /**
   * Fills `output` with generated signal samples.
   */
  fillBuffer(output: Float32Array, length: number = output.length): void {
    if (!this.config.enabled) {
      output.fill(0, 0, length);
      return;
    }

    const gain = Math.pow(10.0, this.config.levelDbFs / 20.0);
    const type = this.config.type;
    const sr = this.sampleRate;

    if (type === 'white') {
      for (let i = 0; i < length; i++) {
        output[i] = this.nextWhite() * gain;
      }
    } else if (type === 'pink') {
      for (let i = 0; i < length; i++) {
        output[i] = this.nextPink() * gain;
      }
    } else if (type === 'brown') {
      for (let i = 0; i < length; i++) {
        const w = this.nextWhite();
        this.brownState = (this.brownState + 0.02 * w) / 1.02;
        output[i] = this.brownState * 3.5 * gain;
      }
    } else if (type === 'sine') {
      const dPhase = (2.0 * Math.PI * this.config.sineFrequencyHz) / sr;
      for (let i = 0; i < length; i++) {
        output[i] = Math.sin(this.phase) * gain;
        this.phase += dPhase;
        if (this.phase >= 2.0 * Math.PI) {
          this.phase -= 2.0 * Math.PI;
        }
      }
    } else if (type === 'sweep') {
      const fStart = 20.0;
      const fEnd = Math.min(20000.0, sr * 0.45);
      const totalSweepSamples = Math.max(1024, Math.round(this.config.sweepDurationSec * sr));
      const logRatio = Math.log(fEnd / fStart);

      for (let i = 0; i < length; i++) {
        const progress = this.sweepSamplePos / totalSweepSamples;
        const instFreq = fStart * Math.exp(logRatio * progress);
        output[i] = Math.sin(this.phase) * gain;
        this.phase += (2.0 * Math.PI * instFreq) / sr;
        if (this.phase >= 2.0 * Math.PI) {
          this.phase -= 2.0 * Math.PI;
        }
        this.sweepSamplePos++;
        if (this.sweepSamplePos >= totalSweepSamples) {
          this.sweepSamplePos = 0;
        }
      }
    } else if (type === 'burst') {
      const periodSamples = Math.round(0.5 * sr); // 500 ms period
      const onSamples = Math.round(0.25 * sr);    // 250 ms ON, 250 ms low (-30 dB)
      for (let i = 0; i < length; i++) {
        const env = this.burstSamplePos < onSamples ? 1.0 : 0.0316;
        output[i] = this.nextPink() * gain * env;
        this.burstSamplePos = (this.burstSamplePos + 1) % periodSamples;
      }
    }
  }
}
