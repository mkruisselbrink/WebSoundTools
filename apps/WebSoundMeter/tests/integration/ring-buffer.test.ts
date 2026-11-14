// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  MultiChannelRingBuffer,
  TOTAL_RING_BUFFER_SLOTS,
  createRingBufferStorage,
} from '../../src/audio/ring-buffer.js';

describe('MultiChannelRingBuffer', () => {
  it('validates power-of-2 capacity and positive channelCount', () => {
    expect(() => createRingBufferStorage(0)).toThrow();
    expect(() => createRingBufferStorage(100)).toThrow();
    expect(() => createRingBufferStorage(128, false, 0)).toThrow();
    const storage = createRingBufferStorage(128);
    expect(storage.channelCount).toBe(TOTAL_RING_BUFFER_SLOTS);
  });

  it('writes and reads multi-channel frames across wrap-around boundaries', () => {
    const storage = createRingBufferStorage(64, true, 4);
    const rb = new MultiChannelRingBuffer(storage);

    expect(rb.availableRead()).toBe(0);
    expect(rb.availableWrite()).toBe(64);
    expect(rb.channelCount).toBe(4);

    // Write 48 samples across 4 channels
    const in1 = Array.from({ length: 4 }, (_, ch) => {
      const arr = new Float32Array(48);
      for (let i = 0; i < 48; i++) {
        arr[i] = (ch + 1) * 1000 + i;
      }
      return arr;
    });

    expect(rb.write(in1)).toBe(48);
    expect(rb.availableRead()).toBe(48);
    expect(rb.availableWrite()).toBe(16);

    // Read 32 samples (leaving 16 in buffer, readPtr = 32)
    const out1 = Array.from({ length: 4 }, () => new Float32Array(32));
    expect(rb.read(out1)).toBe(32);
    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 32; i++) {
        expect(out1[ch][i]).toBe((ch + 1) * 1000 + i);
      }
    }

    expect(rb.availableRead()).toBe(16);
    expect(rb.availableWrite()).toBe(48);

    // Write 40 samples (wraps around index 64 -> 0..24)
    const in2 = Array.from({ length: 4 }, (_, ch) => {
      const arr = new Float32Array(40);
      for (let i = 0; i < 40; i++) {
        arr[i] = -(ch + 1) * 1000 - i;
      }
      return arr;
    });
    expect(rb.write(in2)).toBe(40);
    expect(rb.availableRead()).toBe(56);

    // Read all 56 samples and verify exact ordering across wrap boundary
    const out2 = Array.from({ length: 4 }, () => new Float32Array(56));
    expect(rb.read(out2)).toBe(56);

    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 16; i++) {
        expect(out2[ch][i]).toBe((ch + 1) * 1000 + 32 + i);
      }
      for (let i = 0; i < 40; i++) {
        expect(out2[ch][16 + i]).toBe(-(ch + 1) * 1000 - i);
      }
    }
    expect(rb.availableRead()).toBe(0);
  });

  it('handles overflow, underflow, and missing input channels gracefully', () => {
    const storage = createRingBufferStorage(16, false, 3);
    const rb = new MultiChannelRingBuffer(storage);

    // Pass only 2 of the 3 channels; 3rd channel should be zero-filled
    const big0 = new Float32Array(32).fill(7);
    const big1 = new Float32Array(32).fill(9);

    expect(rb.write([big0, big1])).toBe(16);
    expect(rb.availableWrite()).toBe(0);
    expect(rb.write([big0, big1])).toBe(0);

    const out = [new Float32Array(32), new Float32Array(32), new Float32Array(32)];
    expect(rb.read(out)).toBe(16);
    expect(out[0][0]).toBe(7);
    expect(out[1][0]).toBe(9);
    expect(out[2][0]).toBe(0);
    expect(rb.read(out)).toBe(0);

    rb.clear();
    expect(rb.availableRead()).toBe(0);
    expect(rb.availableWrite()).toBe(16);
  });

  it('handles Uint32 index wrap-around past 2^31 and 2^32 boundaries without corruption', () => {
    const storage = createRingBufferStorage(16, true, 2);
    const rb = new MultiChannelRingBuffer(storage);
    const header = new Uint32Array(storage.headerBuffer);

    const startIdx = 0xfffffffa >>> 0;
    Atomics.store(header, 0, startIdx);
    Atomics.store(header, 1, startIdx);

    const in0 = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const in1 = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

    expect(rb.write([in0, in1])).toBe(10);
    expect(rb.availableRead()).toBe(10);

    const out0 = new Float32Array(10);
    const out1 = new Float32Array(10);
    expect(rb.read([out0, out1])).toBe(10);
    expect(rb.availableRead()).toBe(0);
    expect(Array.from(out0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Array.from(out1)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });
});
