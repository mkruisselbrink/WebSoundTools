import { describe, expect, it } from 'vitest';
import { MeasurementPipeline } from '../../src/dsp/analyzer-pipeline.js';
import { SyntheticAcousticRig } from '../../src/dsp/synthetic-rig.js';

function createPinkishSignal(length: number, seed: number = 42): Float32Array {
  const out = new Float32Array(length);
  let s = seed >>> 0;
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const white = (s >>> 0) / 2147483648.0 - 1.0;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    out[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
  }
  return out;
}

describe('MeasurementPipeline End-to-End Integration', () => {
  it('finds propagation delay, flattens phase when delay is applied, and recovers PA EQ peaks', () => {
    const sampleRate = 48000;
    const rig = new SyntheticAcousticRig(sampleRate, 'pa-room-modes'); // 8.5 ms delay, +6.5 dB @ 160 Hz, -5 dB @ 800 Hz
    const pipeline = new MeasurementPipeline({
      sampleRate,
      fftSize: 4096,
      windowType: 'hann',
      averagingType: 'fifo',
      fifoDepth: 16,
      delayMs: 0.0,
    });

    const chunkLen = 4096;
    const refStream = createPinkishSignal(chunkLen * 20, 12345);
    const measStream = new Float32Array(chunkLen * 20);
    rig.processBlock(refStream, measStream);

    // Feed 10 chunks with delayMs = 0
    for (let c = 0; c < 10; c++) {
      const subR = refStream.subarray(c * chunkLen, (c + 1) * chunkLen);
      const subM = measStream.subarray(c * chunkLen, (c + 1) * chunkLen);
      pipeline.writeSamples(subM, subR);
    }

    // 1. Run Auto Delay Finder and verify it detects the 8.5 ms (408 sample) delay
    const est = pipeline.findDelayNow();
    expect(est.delaySamples).toBe(408);
    expect(est.delayMs).toBeCloseTo(8.5, 1);

    // 2. Apply the found delay (8.5 ms) and feed the remaining 10 chunks
    pipeline.updateConfig({ delayMs: est.delayMs });
    let snapshot = pipeline.computeTransform();
    for (let c = 10; c < 20; c++) {
      const subR = refStream.subarray(c * chunkLen, (c + 1) * chunkLen);
      const subM = measStream.subarray(c * chunkLen, (c + 1) * chunkLen);
      pipeline.writeSamples(subM, subR);
      snapshot = pipeline.computeTransform();
    }

    // Verify the +6.5 dB room mode near 160 Hz and -5.0 dB dip near 800 Hz are captured
    const df = sampleRate / 4096; // 11.71875 Hz per bin
    const bin160 = Math.round(160 / df); // bin 14 (164 Hz)
    const bin800 = Math.round(800 / df); // bin 68 (797 Hz)

    const magDb160 = 20 * Math.log10(snapshot.freqData.magnitude[bin160]);
    const magDb800 = 20 * Math.log10(snapshot.freqData.magnitude[bin800]);

    expect(magDb160).toBeGreaterThan(5.0);
    expect(magDb160).toBeLessThan(8.0);
    expect(magDb800).toBeLessThan(-3.5);
    expect(magDb800).toBeGreaterThan(-6.5);

    // Verify impulse peak is now centered at t = 0 ms (index 2048)
    expect(Math.abs(snapshot.timeData.impulse[2048])).toBeGreaterThan(0.3);

    // Verify broadband SPL meters are populated
    expect(snapshot.levels).toBeDefined();
    expect(snapshot.levels!.levelsDb.A.Fast).toBeGreaterThan(50);
  });
});
