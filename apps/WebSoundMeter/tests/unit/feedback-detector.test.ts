import { Radix2FFT, createWindowTable } from '@foh/dsp';
import { describe, expect, it } from 'vitest';
import {
  computeTrackMatchToleranceHz,
  computeWindowAwareMinQ,
  DetectedFeedbackTrack,
  FeedbackDetector,
  findNearestIso31Band,
  frequencyToMusicalNote,
  MAX_ACTIVE_TRACKS_PER_SLOT,
} from '../../src/dsp/feedback-detector.js';
import { SignalGenerator } from '../../src/dsp/signal-generator.js';
import {
  SIMULATOR_PRESETS,
  SimulatorRigConfig,
  SyntheticAcousticRig,
} from '../../src/dsp/synthetic-rig.js';
import { TransferFunctionAnalyzer } from '../../src/dsp/transfer-function.js';

describe('FeedbackDetector & Acoustic Utility Mappers', () => {
  it('maps arbitrary frequencies to nearest 31-band ISO center frequency and musical note', () => {
    const iso1 = findNearestIso31Band(2482);
    expect(iso1.isoBandHz).toBe(2500);
    expect(iso1.isoBandLabel).toBe('2.5 kHz');

    const iso2 = findNearestIso31Band(632);
    expect(iso2.isoBandHz).toBe(630);
    expect(iso2.isoBandLabel).toBe('630 Hz');

    expect(frequencyToMusicalNote(440)).toBe('A4 (+0c)');
    expect(frequencyToMusicalNote(880)).toBe('A5 (+0c)');
    expect(frequencyToMusicalNote(2482)).toContain('D#7');
  });

  it('scales effective minimum Q at low frequencies to compensate for FFT window main-lobe width', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const df = sampleRate / fftSize; // 11.71875 Hz

    // At 120 Hz, Hann main-lobe max Q is 120 / (1.44 * 11.72) = 7.11 -> 0.55 * 7.11 = 3.91 -> clamped to 4.0
    const effLowQ = computeWindowAwareMinQ(12.0, 120, df);
    expect(effLowQ).toBeCloseTo(4.0, 2);

    // At 3000 Hz, window max Q is ~177 -> effective min Q stays at target 12.0
    const effHighQ = computeWindowAwareMinQ(12.0, 3000, df);
    expect(effHighQ).toBe(12.0);

    // Hybrid frequency match tolerance: >= 1.5 * df at 100 Hz, capped at 120 Hz at 10 kHz
    expect(computeTrackMatchToleranceHz(100, df)).toBeCloseTo(1.5 * df, 2);
    expect(computeTrackMatchToleranceHz(10000, df)).toBe(120.0);
  });

  it('detects simulated acoustic feedback in M while rejecting program lead tones present in R', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const fft = new Radix2FFT(fftSize, 'hann');
    const tf = new TransferFunctionAnalyzer({
      fftSize,
      sampleRate,
      averagingType: 'fifo',
      fifoDepth: 4,
    });
    const detector = new FeedbackDetector('foh-normal');
    const gen = new SignalGenerator(sampleRate);
    gen.updateConfig({ enabled: true, type: 'pink', levelDbFs: -24.0 });

    // Configure SyntheticAcousticRig with:
    //  1) A true acoustic feedback ring at 2480 Hz (injectIntoReference: false)
    //  2) A synth lead tone at 1000 Hz injected into both R and M (injectIntoReference: true)
    const rigConfig: SimulatorRigConfig = {
      ...SIMULATOR_PRESETS['flat-delayed'],
      propagationDelayMs: 0,
      simulatedFeedbackRings: [
        {
          frequencyHz: 2480,
          q: 28,
          gainDb: 18,
          toneLevelDbFs: -12,
          injectIntoReference: false,
        },
        {
          frequencyHz: 1000,
          q: 25,
          gainDb: 18,
          toneLevelDbFs: -12,
          injectIntoReference: true,
        },
      ],
    };
    const rig = new SyntheticAcousticRig(sampleRate, rigConfig);

    const bufR = new Float32Array(fftSize);
    const bufM = new Float32Array(fftSize);
    const rRe = new Float32Array(tf.binCount);
    const rIm = new Float32Array(tf.binCount);
    const mRe = new Float32Array(tf.binCount);
    const mIm = new Float32Array(tf.binCount);

    let detected: readonly DetectedFeedbackTrack[] = [];
    for (let frame = 0; frame < 6; frame++) {
      gen.fillBuffer(bufR, fftSize);
      rig.processBlock(bufR, bufM, fftSize);
      fft.transformDualReal(bufM, bufR, mRe, mIm, rRe, rIm);
      tf.processFrame(mRe, mIm, rRe, rIm, 0.04);

      detected = detector.processFrame({
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        module: tf.module,
        refModule: tf.refModule,
        referenceRmsDb: -20,
      });
    }

    // Should detect the 2480 Hz acoustic feedback ring and reject the 1000 Hz program tone in R
    expect(detected.length).toBe(1);
    expect(detected[0].frequencyHz).toBeGreaterThan(2465);
    expect(detected[0].frequencyHz).toBeLessThan(2495);
    expect(detected[0].isoBandHz).toBe(2500);
    expect(detected[0].state).toBe('feedback');
  });

  it('detects low-frequency (125 Hz) feedback at FFT 4096 and transitions to 5-second latched hold when cut', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const binCount = (fftSize >>> 1) + 1;
    const df = sampleRate / fftSize;
    const detector = new FeedbackDetector('monitor-sensitive');

    // Synthesize flat background spectrum with a narrow peak at 125 Hz
    const module = new Float32Array(binCount).fill(0.005);
    const targetBin = Math.round(125 / df);
    module[targetBin - 1] = 0.04;
    module[targetBin] = 0.08;
    module[targetBin + 1] = 0.04;

    let tracks: readonly DetectedFeedbackTrack[] = [];
    for (let f = 0; f < 4; f++) {
      tracks = detector.processFrame({
        slotId: 'live-2',
        slotName: 'Wedge L',
        slotColor: '#f43f5e',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        dtMs: 40,
        module,
      });
    }

    expect(tracks.length).toBe(1);
    expect(tracks[0].isoBandHz).toBe(125);
    expect(['ringing', 'feedback']).toContain(tracks[0].state);

    // Pull fader down (flat spectrum) -> track should latch for 5,000 ms before expiring
    module.fill(0.005);
    const latched1 = detector.processFrame({
      slotId: 'live-2',
      slotName: 'Wedge L',
      slotColor: '#f43f5e',
      sampleRate,
      fftSize,
      splOffsetDb: 100,
      dtMs: 1000,
      module,
    });
    expect(latched1.length).toBe(1);
    expect(latched1[0].state).toBe('latched');
    expect(latched1[0].latchRemainingRatio).toBeCloseTo(0.8, 2);

    // Advance past 5,000 ms total latch duration -> track expires
    const expired = detector.processFrame({
      slotId: 'live-2',
      slotName: 'Wedge L',
      slotColor: '#f43f5e',
      sampleRate,
      fftSize,
      splOffsetDb: 100,
      dtMs: 4500,
      module,
    });
    expect(expired.length).toBe(0);
  });

  it('rejects musical instrument notes with 2nd & 3rd harmonics in single-channel mode (Harmonic Veto) and caps active tracks at 6', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const binCount = (fftSize >>> 1) + 1;
    const df = sampleRate / fftSize;
    const detector = new FeedbackDetector('foh-normal');

    // Create a note at 440 Hz with prominent 2nd (880 Hz) and 3rd (1320 Hz) harmonics (+14 dB prominence)
    const module = new Float32Array(binCount).fill(0.01);
    for (const fHz of [440, 880, 1320]) {
      const b = Math.round(fHz / df);
      module[b - 1] = 0.03;
      module[b] = 0.055; // ~14.8 dB above 0.01 background
      module[b + 1] = 0.03;
    }

    for (let i = 0; i < 8; i++) {
      const res = detector.processFrame({
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        module,
      });
      // Fundamental 440 Hz has 2f0 & 3f0 harmonics; 880 Hz has subharmonic 440 Hz -> suppressed!
      expect(res.find((t) => Math.abs(t.frequencyHz - 440) < 15)).toBeUndefined();
      expect(res.find((t) => Math.abs(t.frequencyHz - 880) < 15)).toBeUndefined();
    }

    // Now inject 9 independent non-harmonic inharmonic peaks (+18 dB) and verify MAX_ACTIVE_TRACKS_PER_SLOT = 6 cap
    detector.reset();
    const multiModule = new Float32Array(binCount).fill(0.005);
    const inharmonicFreqs = [310, 470, 690, 1030, 1510, 2190, 3180, 4610, 6700];
    for (const fHz of inharmonicFreqs) {
      const b = Math.round(fHz / df);
      multiModule[b - 1] = 0.025;
      multiModule[b] = 0.06;
      multiModule[b + 1] = 0.025;
    }

    let cappedTracks = [];
    for (let i = 0; i < 8; i++) {
      cappedTracks = detector.processFrame({
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        module: multiModule,
      });
    }
    expect(cappedTracks.length).toBe(MAX_ACTIVE_TRACKS_PER_SLOT);
  });
});
