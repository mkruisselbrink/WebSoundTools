// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_LOOPBACK_SLOT_INDEX,
  MultiChannelRingBuffer,
  TOTAL_RING_BUFFER_SLOTS,
  createRingBufferStorage,
} from '../audio/ring-buffer.js';
import { DEFAULT_MEASUREMENT_CONFIG } from './analyzer-pipeline.js';

interface MockWorkletProcessorInstance {
  port: {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

describe('capture-worklet and multi-slot dsp.worker', () => {
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

    await import('../audio/worklets/capture-worklet.js');
  });

  afterAll(() => {
    if (workerIntervalId !== null) {
      clearInterval(workerIntervalId);
    }
  });

  it('CaptureTapProcessor taps multiple input channels plus internal loopback into MultiChannelRingBuffer and mutes when paused', () => {
    expect(RegisteredProcessorCtor).not.toBeNull();
    const proc = new RegisteredProcessorCtor!();

    const storage = createRingBufferStorage(4096, false, TOTAL_RING_BUFFER_SLOTS);
    const reader = new MultiChannelRingBuffer(storage);

    proc.port.onmessage?.({
      data: { type: 'init-ring-buffer', storage },
    } as MessageEvent);

    // Enable generator
    proc.port.onmessage?.({
      data: {
        type: 'update-generator-config',
        config: { enabled: true, type: 'sine', sineFrequencyHz: 1000, levelDbFs: -6 },
      },
    } as MessageEvent);

    const ch0In = new Float32Array(128).fill(0.25);
    const ch1In = new Float32Array(128).fill(-0.25);
    const ch2In = new Float32Array(128).fill(0.75);
    const genOut = new Float32Array(128);

    expect(proc.process([[ch0In], [ch1In], [ch2In]], [[genOut]])).toBe(true);

    // Generator output should have non-zero sine samples
    expect(genOut.some((v) => Math.abs(v) > 0.01)).toBe(true);

    // Ring buffer should have received 128 frames across all 9 slots
    expect(reader.availableRead()).toBe(128);
    const outChannels = Array.from(
      { length: TOTAL_RING_BUFFER_SLOTS },
      () => new Float32Array(128)
    );
    reader.read(outChannels, 128);
    expect(outChannels[0][0]).toBeCloseTo(0.25, 5);
    expect(outChannels[1][0]).toBeCloseTo(-0.25, 5);
    expect(outChannels[2][0]).toBeCloseTo(0.75, 5);
    expect(outChannels[INTERNAL_LOOPBACK_SLOT_INDEX][10]).toBeCloseTo(genOut[10], 5);

    // Pause processor: output should be zeroed and ring buffer should receive no new samples
    proc.port.onmessage?.({
      data: { type: 'pause', paused: true },
    } as MessageEvent);

    genOut.fill(0.9);
    proc.process([[ch0In], [ch1In], [ch2In]], [[genOut]]);
    expect(genOut.every((v) => v === 0)).toBe(true);
    expect(reader.availableRead()).toBe(0);
  });

  it('CaptureTapProcessor batches 1024-sample multi-channel fallback chunks when SharedArrayBuffer is unavailable', () => {
    const proc = new RegisteredProcessorCtor!();
    const ch0 = new Float32Array(128).fill(0.1);
    const ch1 = new Float32Array(128).fill(0.2);
    const genOut = new Float32Array(128);

    // 7 blocks of 128 = 896 samples (< 1024, no postMessage yet)
    for (let i = 0; i < 7; i++) {
      proc.process([[ch0], [ch1]], [[genOut]]);
    }
    expect(proc.port.postMessage).not.toHaveBeenCalled();

    // 8th block reaches 1024 samples -> emits 1 batched message with 9 channels
    proc.process([[ch0], [ch1]], [[genOut]]);
    expect(proc.port.postMessage).toHaveBeenCalledTimes(1);
    const payload = proc.port.postMessage.mock.calls[0][0];
    expect(payload.type).toBe('audio-chunk');
    expect(payload.channels).toHaveLength(TOTAL_RING_BUFFER_SLOTS);
    expect(payload.channels[0]).toHaveLength(1024);
  });

  it('dsp.worker manages multiple live measurement slots, per-slot calibration, delay estimation, and pause', async () => {
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

    const workerMod = await import('./dsp.worker.js');
    workerIntervalId = workerMod.intervalId;
    const selfObj = globalThis.self as unknown as {
      onmessage: (e: MessageEvent) => void;
    };

    const storage = createRingBufferStorage(4096, false, TOTAL_RING_BUFFER_SLOTS);
    const rb = new MultiChannelRingBuffer(storage);
    rb.write([new Float32Array(64).fill(1), new Float32Array(64).fill(1)], 64);

    selfObj.onmessage({
      data: { type: 'init', sampleRate: 48000, ringBufferStorage: storage },
    } as MessageEvent);

    // Synchronize 2 live slots mapped to physical channels 0, 1, and 18 (mapped to tap 2)
    selfObj.onmessage({
      data: {
        type: 'sync-live-slots',
        slots: [
          {
            id: 'live-measurement',
            name: 'FOH Center',
            color: '#38bdf8',
            visible: true,
            simulatorPreset: 'pa-room-modes',
            measurementChannel: 0,
            referenceChannel: 1,
            config: { ...DEFAULT_MEASUREMENT_CONFIG },
            activeCalibrationId: null,
          },
          {
            id: 'live-2',
            name: 'Front Fill (Ch 19)',
            color: '#10b981',
            visible: true,
            simulatorPreset: 'flat-delayed',
            measurementChannel: 18,
            referenceChannel: -1,
            config: { ...DEFAULT_MEASUREMENT_CONFIG },
            activeCalibrationId: null,
          },
        ],
        channelTapMap: { 0: 0, 1: 1, 18: 2 },
      },
    } as MessageEvent);

    // Switching to hardware mode clears stale ring buffer samples
    selfObj.onmessage({
      data: { type: 'set-input-mode', mode: 'hardware' },
    } as MessageEvent);
    expect(rb.availableRead()).toBe(0);

    // Updating measurement config on slot 'live-2' posts measurement-config-updated with slotId
    selfObj.onmessage({
      data: {
        type: 'update-measurement-config',
        slotId: 'live-2',
        config: { sampleRate: 44100, fftSize: 2048 },
      },
    } as MessageEvent);
    expect(
      postedMessages.some(
        (m) => m.type === 'measurement-config-updated' && m.slotId === 'live-2'
      )
    ).toBe(true);

    // Loading calibration on 'live-2' posts calibration-loaded with slotId
    selfObj.onmessage({
      data: {
        type: 'load-calibration',
        slotId: 'live-2',
        name: 'test.cal',
        text: '100 -1.5\n1000 0.0\n10000 2.0',
      },
    } as MessageEvent);
    expect(
      postedMessages.some(
        (m) => m.type === 'calibration-loaded' && m.slotId === 'live-2'
      )
    ).toBe(true);

    // Apply estimated delay & clear calibration on 'live-2'
    selfObj.onmessage({
      data: { type: 'find-delay', slotId: 'live-2' },
    } as MessageEvent);
    expect(
      postedMessages.some((m) => m.type === 'delay-found' && m.slotId === 'live-2')
    ).toBe(true);
    selfObj.onmessage({
      data: { type: 'apply-estimated-delay', slotId: 'live-2' },
    } as MessageEvent);
    selfObj.onmessage({
      data: { type: 'clear-calibration', slotId: 'live-2' },
    } as MessageEvent);

    // Pause clears ring buffer
    rb.write([new Float32Array(32).fill(0.5)], 32);
    selfObj.onmessage({ data: { type: 'pause', paused: true } } as MessageEvent);
    expect(rb.availableRead()).toBe(0);
  });
});
