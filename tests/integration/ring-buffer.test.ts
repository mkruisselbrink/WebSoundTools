import { describe, expect, it } from 'vitest';
import {
  DualChannelRingBuffer,
  createRingBufferStorage,
} from '../../src/audio/ring-buffer.js';

describe('DualChannelRingBuffer', () => {
  it('validates power-of-2 capacity', () => {
    expect(() => createRingBufferStorage(0)).toThrow();
    expect(() => createRingBufferStorage(100)).toThrow();
    expect(() => createRingBufferStorage(128)).not.toThrow();
  });

  it('writes and reads stereo [M, R] frames across wrap-around boundaries', () => {
    const storage = createRingBufferStorage(64, true);
    const rb = new DualChannelRingBuffer(storage);

    expect(rb.availableRead()).toBe(0);
    expect(rb.availableWrite()).toBe(64);

    // Write 48 samples
    const inM1 = new Float32Array(48);
    const inR1 = new Float32Array(48);
    for (let i = 0; i < 48; i++) {
      inM1[i] = i + 1;
      inR1[i] = -(i + 1);
    }

    expect(rb.write(inM1, inR1)).toBe(48);
    expect(rb.availableRead()).toBe(48);
    expect(rb.availableWrite()).toBe(16);

    // Read 32 samples (leaving 16 in buffer, readPtr = 32)
    const outM1 = new Float32Array(32);
    const outR1 = new Float32Array(32);
    expect(rb.read(outM1, outR1)).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(outM1[i]).toBe(i + 1);
      expect(outR1[i]).toBe(-(i + 1));
    }

    expect(rb.availableRead()).toBe(16);
    expect(rb.availableWrite()).toBe(48);

    // Write 40 samples (wraps around index 64 -> 0..24)
    const inM2 = new Float32Array(40);
    const inR2 = new Float32Array(40);
    for (let i = 0; i < 40; i++) {
      inM2[i] = 100 + i;
      inR2[i] = -100 - i;
    }
    expect(rb.write(inM2, inR2)).toBe(40);
    expect(rb.availableRead()).toBe(56);

    // Read all 56 samples and verify exact ordering across wrap boundary
    const outM2 = new Float32Array(56);
    const outR2 = new Float32Array(56);
    expect(rb.read(outM2, outR2)).toBe(56);

    for (let i = 0; i < 16; i++) {
      expect(outM2[i]).toBe(33 + i);
      expect(outR2[i]).toBe(-(33 + i));
    }
    for (let i = 0; i < 40; i++) {
      expect(outM2[16 + i]).toBe(100 + i);
      expect(outR2[16 + i]).toBe(-100 - i);
    }
    expect(rb.availableRead()).toBe(0);
  });

  it('handles overflow and underflow gracefully without corrupting state', () => {
    const storage = createRingBufferStorage(16, false);
    const rb = new DualChannelRingBuffer(storage);

    const bigM = new Float32Array(32).fill(7);
    const bigR = new Float32Array(32).fill(9);

    // Should clamp write to capacity (16)
    expect(rb.write(bigM, bigR)).toBe(16);
    expect(rb.availableWrite()).toBe(0);
    expect(rb.write(bigM, bigR)).toBe(0);

    const outM = new Float32Array(32);
    const outR = new Float32Array(32);
    expect(rb.read(outM, outR)).toBe(16);
    expect(rb.read(outM, outR)).toBe(0);

    rb.clear();
    expect(rb.availableRead()).toBe(0);
    expect(rb.availableWrite()).toBe(16);
  });
});

