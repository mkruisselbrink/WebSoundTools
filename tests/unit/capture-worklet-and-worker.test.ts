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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DualChannelRingBuffer,
  createRingBufferStorage,
} from '../../src/audio/ring-buffer.js';

interface MockWorkletProcessorInstance {
  port: {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

describe('capture-worklet and dsp.worker', () => {
  let RegisteredProcessorCtor: (new () => MockWorkletProcessorInstance) | null = null;
  let workerIntervalId: ReturnType<typeof setInterval> | null = null;

  beforeAll(async () => {
    class MockAudioWorkletProcessor {
      port = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage: vi.fn(),
      };
    }

    Object.defineProperty(globalThis, 'sampleRate', {
      value: 48000,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'AudioWorkletProcessor', {
      value: MockAudioWorkletProcessor,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'registerProcessor', {
      value: (_name: string, ctor: new () => MockWorkletProcessorInstance) => {
        RegisteredProcessorCtor = ctor;
      },
      configurable: true,
      writable: true,
    });

    await import('../../src/audio/worklets/capture-worklet.js');
  });

  afterAll(() => {
    if (workerIntervalId !== null) {
      clearInterval(workerIntervalId);
    }
  });

  it('CaptureTapProcessor synthesizes generator output, supports internal loopback, writes to ring buffer, and mutes when paused', () => {
    expect(RegisteredProcessorCtor).not.toBeNull();
    const proc = new RegisteredProcessorCtor!();

    const storage = createRingBufferStorage(4096, false);
    const reader = new DualChannelRingBuffer(storage);

    proc.port.onmessage?.({
      data: { type: 'init-ring-buffer', storage },
    } as MessageEvent);

    // Enable generator and internal reference loopback
    proc.port.onmessage?.({
      data: {
        type: 'update-generator-config',
        config: { enabled: true, type: 'sine', frequencyHz: 1000, levelDbFs: -6 },
      },
    } as MessageEvent);
    proc.port.onmessage?.({
      data: { type: 'set-ref-loopback', useInternalGenAsRef: true },
    } as MessageEvent);

    const mIn = new Float32Array(128).fill(0.25);
    const rIn = new Float32Array(128).fill(-0.25);
    const genOut = new Float32Array(128);

    expect(proc.process([[mIn], [rIn]], [[genOut]])).toBe(true);

    // Generator output should have non-zero sine samples
    expect(genOut.some((v) => Math.abs(v) > 0.01)).toBe(true);

    // Ring buffer should have received 128 samples with R matching genOut (internal loopback)
    expect(reader.availableRead()).toBe(128);
    const outM = new Float32Array(128);
    const outR = new Float32Array(128);
    reader.read(outM, outR, 128);
    expect(outM[0]).toBeCloseTo(0.25, 5);
    expect(outR[10]).toBeCloseTo(genOut[10], 5);

    // Pause processor: output should be zeroed and ring buffer should receive no new samples
    proc.port.onmessage?.({
      data: { type: 'pause', paused: true },
    } as MessageEvent);

    genOut.fill(0.9);
    proc.process([[mIn], [rIn]], [[genOut]]);
    expect(genOut.every((v) => v === 0)).toBe(true);
    expect(reader.availableRead()).toBe(0);
  });

  it('CaptureTapProcessor batches 1024-sample fallback chunks when SharedArrayBuffer is unavailable', () => {
    const proc = new RegisteredProcessorCtor!();
    const mIn = new Float32Array(128).fill(0.1);
    const rIn = new Float32Array(128).fill(0.2);
    const genOut = new Float32Array(128);

    // 7 blocks of 128 = 896 samples (< 1024, no postMessage yet)
    for (let i = 0; i < 7; i++) {
      proc.process([[mIn], [rIn]], [[genOut]]);
    }
    expect(proc.port.postMessage).not.toHaveBeenCalled();

    // 8th block reaches 1024 samples -> emits 1 batched message
    proc.process([[mIn], [rIn]], [[genOut]]);
    expect(proc.port.postMessage).toHaveBeenCalledTimes(1);
    const payload = proc.port.postMessage.mock.calls[0][0];
    expect(payload.type).toBe('audio-chunk');
    expect(payload.m).toHaveLength(1024);
  });

  it('dsp.worker handles configuration, calibration, delay estimation, and pause messages', async () => {
    const postedMessages: Array<{ type: string; [k: string]: unknown }> = [];
    Object.defineProperty(globalThis, 'self', {
      value: {
        postMessage: (msg: { type: string }) => {
          postedMessages.push(msg);
        },
        onmessage: null,
      },
      configurable: true,
      writable: true,
    });

    const workerMod = await import('../../src/dsp/dsp.worker.js');
    workerIntervalId = workerMod.intervalId;
    const selfObj = globalThis.self as unknown as {
      onmessage: (e: MessageEvent) => void;
    };

    const storage = createRingBufferStorage(4096, false);
    const rb = new DualChannelRingBuffer(storage);
    rb.write(new Float32Array(64).fill(1), new Float32Array(64).fill(1), 64);

    selfObj.onmessage({
      data: { type: 'init', sampleRate: 48000, ringBufferStorage: storage },
    } as MessageEvent);

    // Switching to hardware mode clears stale ring buffer samples
    selfObj.onmessage({
      data: { type: 'set-input-mode', mode: 'hardware' },
    } as MessageEvent);
    expect(rb.availableRead()).toBe(0);

    // Updating measurement config posts measurement-config-updated
    selfObj.onmessage({
      data: {
        type: 'update-measurement-config',
        config: { sampleRate: 44100, fftSize: 2048 },
      },
    } as MessageEvent);
    expect(postedMessages.some((m) => m.type === 'measurement-config-updated')).toBe(true);

    // Loading calibration posts calibration-loaded
    selfObj.onmessage({
      data: {
        type: 'load-calibration',
        name: 'test.cal',
        text: '100 -1.5\n1000 0.0\n10000 2.0',
      },
    } as MessageEvent);
    expect(postedMessages.some((m) => m.type === 'calibration-loaded')).toBe(true);

    // Apply estimated delay & clear calibration
    selfObj.onmessage({ data: { type: 'find-delay' } } as MessageEvent);
    expect(postedMessages.some((m) => m.type === 'delay-found')).toBe(true);
    selfObj.onmessage({ data: { type: 'apply-estimated-delay' } } as MessageEvent);
    selfObj.onmessage({ data: { type: 'clear-calibration' } } as MessageEvent);

    // Pause clears ring buffer
    rb.write(new Float32Array(32).fill(0.5), new Float32Array(32).fill(0.5), 32);
    selfObj.onmessage({ data: { type: 'pause', paused: true } } as MessageEvent);
    expect(rb.availableRead()).toBe(0);
  });
});

