// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { Radix2FFT } from '@foh/dsp';
import { describe, expect, it } from 'vitest';
import { MeasurementPipeline } from './analyzer-pipeline.js';
import {
  computeTrackMatchToleranceHz,
  computeWindowAwareMinQ,
  DetectedFeedbackTrack,
  FeedbackDetector,
  findNearestIso31Band,
  frequencyToMusicalNote,
  MAX_ACTIVE_TRACKS_PER_SLOT,
} from './feedback-detector.js';
import { SignalGenerator } from './signal-generator.js';
import {
  SIMULATOR_PRESETS,
  SimulatorRigConfig,
  SyntheticAcousticRig,
} from './synthetic-rig.js';
import { TransferFunctionAnalyzer } from './transfer-function.js';

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

    const effLowQ = computeWindowAwareMinQ(12.0, 120, df);
    expect(effLowQ).toBeCloseTo(4.0, 2);

    const effHighQ = computeWindowAwareMinQ(12.0, 3000, df);
    expect(effHighQ).toBe(12.0);

    expect(computeTrackMatchToleranceHz(100, df)).toBeCloseTo(1.35 * df, 2);
    expect(computeTrackMatchToleranceHz(10000, df)).toBe(90.0);
  });

  it('tags closed-loop PA feedback (in both M & R) as in-mix and wedge feedback as stage-only by default, while supporting playback-veto', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const hopSamples = 2048;
    const fft = new Radix2FFT(fftSize, 'hann');
    const tf = new TransferFunctionAnalyzer({
      fftSize,
      sampleRate,
      averagingType: 'fifo',
      fifoDepth: 4,
    });
    const closedLoopDetector = new FeedbackDetector('foh-normal', 'closed-loop-mix');
    const playbackVetoDetector = new FeedbackDetector('foh-normal', 'playback-veto');
    const gen = new SignalGenerator(sampleRate);
    gen.updateConfig({ enabled: true, type: 'pink', levelDbFs: -24.0 });

    const rigConfig: SimulatorRigConfig = {
      ...SIMULATOR_PRESETS['flat-delayed'],
      propagationDelayMs: 0,
      simulatedFeedbackRings: [
        {
          frequencyHz: 2480,
          q: 28,
          gainDb: 18,
          toneLevelDbFs: -12,
          injectIntoReference: false, // Stage / Wedge only
        },
        {
          frequencyHz: 1000,
          q: 25,
          gainDb: 18,
          toneLevelDbFs: -12,
          injectIntoReference: true, // Present in both Console Mix R and Room M
        },
      ],
    };
    const rig = new SyntheticAcousticRig(sampleRate, rigConfig);

    const bufR = new Float32Array(fftSize);
    const bufM = new Float32Array(fftSize);
    const stepR = new Float32Array(hopSamples);
    const stepM = new Float32Array(hopSamples);
    const rRe = new Float32Array(tf.binCount);
    const rIm = new Float32Array(tf.binCount);
    const mRe = new Float32Array(tf.binCount);
    const mIm = new Float32Array(tf.binCount);

    // Prime full FFT window
    gen.fillBuffer(bufR, fftSize);
    rig.processBlock(bufR, bufM, fftSize);

    let closedLoopDetected: readonly DetectedFeedbackTrack[] = [];
    let playbackVetoDetected: readonly DetectedFeedbackTrack[] = [];

    for (let frame = 0; frame < 8; frame++) {
      if (frame > 0) {
        gen.fillBuffer(stepR, hopSamples);
        rig.processBlock(stepR, stepM, hopSamples);
        bufR.copyWithin(0, hopSamples);
        bufR.set(stepR, fftSize - hopSamples);
        bufM.copyWithin(0, hopSamples);
        bufM.set(stepM, fftSize - hopSamples);
      }
      fft.transformDualReal(bufM, bufR, mRe, mIm, rRe, rIm, true);
      tf.processFrame(mRe, mIm, rRe, rIm, 0.04);

      closedLoopDetected = closedLoopDetector.processFrame({
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        specMRe: mRe,
        specMIm: mIm,
        specRRe: rRe,
        specRIm: rIm,
        hopSamples,
        module: tf.module,
        refModule: tf.refModule,
        referenceRmsDb: -20,
      });

      playbackVetoDetected = playbackVetoDetector.processFrame({
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        specMRe: mRe,
        specMIm: mIm,
        specRRe: rRe,
        specRIm: rIm,
        hopSamples,
        module: tf.module,
        refModule: tf.refModule,
        referenceRmsDb: -20,
      });
    }

    // Closed-loop mode catches BOTH the 1 kHz PA loop ('in-mix') and 2.48 kHz wedge loop ('stage-only')
    const paRing = closedLoopDetected.find((t) => Math.abs(t.frequencyHz - 1000) < 25);
    const wedgeRing = closedLoopDetected.find((t) => Math.abs(t.frequencyHz - 2480) < 25);
    expect(paRing?.state).toBe('feedback');
    expect(paRing?.loopLocation).toBe('in-mix');
    expect(wedgeRing?.state).toBe('feedback');
    expect(wedgeRing?.loopLocation).toBe('stage-only');

    // Playback-veto mode suppresses the 1 kHz stem tone in R while still catching 2.48 kHz
    expect(playbackVetoDetected.length).toBe(1);
    expect(playbackVetoDetected[0].isoBandHz).toBe(2500);
    expect(playbackVetoDetected[0].state).toBe('feedback');
  });

  it('rejects vibrato singing, 3rd–5th vocal formant harmonics in sparse silence, and brief FIFO-16 speech bursts', () => {
    const sampleRate = 48000;
    const pipeline = new MeasurementPipeline({
      id: 'live-measurement',
      name: 'FOH Mic',
      sampleRate,
      fftSize: 4096,
      averagingType: 'fifo',
      fifoDepth: 16,
      feedbackMode: 'foh-normal',
    });

    const chunk = 1920; // 40 ms @ 48 kHz
    const bufM = new Float32Array(chunk);
    const bufR = new Float32Array(chunk); // silent reference (single-mic FOH setup!)

    // 1. Singing with realistic vibrato (+/- 28 cents at 5.5 Hz) and strong 4th/5th formant harmonics (880 Hz, 1100 Hz)
    let phase = 0;
    for (let tick = 0; tick < 20; tick++) {
      for (let i = 0; i < chunk; i++) {
        const t = (tick * chunk + i) / sampleRate;
        const cents = 28 * Math.sin(2 * Math.PI * 5.5 * t);
        const f0 = 220 * Math.pow(2, cents / 1200);
        phase += (2 * Math.PI * f0) / sampleRate;
        // Vocal vowel with boosted 4th & 5th harmonics in a quiet room (-70 dBFS noise)
        const voice =
          0.08 * Math.sin(phase) +
          0.05 * Math.sin(2 * phase) +
          0.04 * Math.sin(3 * phase) +
          0.14 * Math.sin(4 * phase) +
          0.18 * Math.sin(5 * phase);
        const roomFloor = 0.0002 * Math.sin(i * 12.9898 + tick);
        bufM[i] = voice + roomFloor;
      }
      pipeline.writeSamples(bufM, bufR, chunk);
      const snap = pipeline.computeTransform(0.04);
      expect(snap.feedbackTracks?.length ?? 0).toBe(0);
    }

    // 2. Short 80 ms pure burst (2 ticks) followed by quiet noise: must NOT ride the 16-frame FIFO into a false alert
    pipeline.resetAveraging();
    let tonePhase = 0;
    for (let tick = 0; tick < 12; tick++) {
      for (let i = 0; i < chunk; i++) {
        tonePhase += (2 * Math.PI * 1850) / sampleRate;
        bufM[i] = tick < 2 ? 0.2 * Math.sin(tonePhase) : 0.0005 * Math.sin(i * 7.13 + tick);
      }
      pipeline.writeSamples(bufM, bufR, chunk);
      const snap = pipeline.computeTransform(0.04);
      expect(snap.feedbackTracks?.length ?? 0).toBe(0);
    }
  });

  it('detects post-transient overhang ringing (▲) during soundcheck speech', () => {
    const sampleRate = 48000;
    const pipeline = new MeasurementPipeline({
      id: 'live-wedge',
      name: 'Wedge 1',
      sampleRate,
      fftSize: 4096,
      feedbackMode: 'monitor-sensitive',
    });

    const chunk = 1920;
    const bufM = new Float32Array(chunk);
    const bufR = new Float32Array(chunk);
    let ringPhase = 0;
    let rng = 0x2468ace1;

    let detectedOverhang: DetectedFeedbackTrack | undefined;
    for (let tick = 0; tick < 8; tick++) {
      const isSyllableActive = tick < 3;
      const noiseAmp = isSyllableActive ? 0.12 : 0.002;
      // High-Q wedge ring at 1620 Hz excited by the syllable and decaying slowly afterward
      const ringAmp = isSyllableActive ? 0.06 : 0.045 * Math.pow(0.92, tick - 2);
      for (let i = 0; i < chunk; i++) {
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        const white = ((rng >>> 0) / 2147483648 - 1) * noiseAmp;
        ringPhase += (2 * Math.PI * 1620) / sampleRate;
        bufM[i] = white + ringAmp * Math.sin(ringPhase);
      }
      pipeline.writeSamples(bufM, bufR, chunk);
      const snap = pipeline.computeTransform(0.04);
      const match = snap.feedbackTracks?.find((t) => Math.abs(t.frequencyHz - 1620) < 25);
      if (match) {
        detectedOverhang = match;
      }
    }

    expect(detectedOverhang).toBeDefined();
    expect(['ringing', 'feedback']).toContain(detectedOverhang!.state);
    expect(detectedOverhang!.isoBandHz).toBe(1600);
  });

  it('detects low-frequency (125 Hz) feedback at FFT 4096 and transitions to 5-second latched hold when cut', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const binCount = (fftSize >>> 1) + 1;
    const df = sampleRate / fftSize;
    const detector = new FeedbackDetector('monitor-sensitive');

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

  it('rejects musical instrument notes (including 3rd–5th harmonics) via Harmonic Comb Sieve and caps active tracks at 6', () => {
    const sampleRate = 48000;
    const fftSize = 4096;
    const binCount = (fftSize >>> 1) + 1;
    const df = sampleRate / fftSize;
    const detector = new FeedbackDetector('foh-normal');

    // Note at 220 Hz with 2nd (440), 3rd (660), and prominent 5th (1100 Hz) formant harmonic
    const module = new Float32Array(binCount).fill(0.004);
    for (const [fHz, amp] of [
      [220, 0.025],
      [440, 0.02],
      [660, 0.018],
      [1100, 0.05], // +22 dB formant harmonic!
    ] as const) {
      const b = Math.round(fHz / df);
      module[b - 1] = amp * 0.55;
      module[b] = amp;
      module[b + 1] = amp * 0.55;
    }

    for (let i = 0; i < 10; i++) {
      const res = detector.processFrame({
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        sampleRate,
        fftSize,
        splOffsetDb: 100,
        module,
      });
      expect(res.length).toBe(0);
    }

    // Inject 9 independent non-harmonic peaks (+21 dB) and verify MAX_ACTIVE_TRACKS_PER_SLOT = 6 cap
    detector.reset();
    const multiModule = new Float32Array(binCount).fill(0.004);
    const inharmonicFreqs = [310, 470, 690, 1030, 1510, 2190, 3180, 4610, 6700];
    for (const fHz of inharmonicFreqs) {
      const b = Math.round(fHz / df);
      multiModule[b - 1] = 0.035;
      multiModule[b] = 0.08;
      multiModule[b + 1] = 0.035;
    }

    let cappedTracks: readonly DetectedFeedbackTrack[] = [];
    for (let i = 0; i < 10; i++) {
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
