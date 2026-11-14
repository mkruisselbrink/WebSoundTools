// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Real-time AudioWorkletProcessor that taps up to 8 active hardware input channels
 * plus the internal SignalGenerator loopback output and writes them sample-synchronously
 * into a lock-free MultiChannelRingBuffer (or posts batched multi-channel chunks if fallback).
 */

import {
  SignalGenerator,
  SignalGeneratorConfig,
} from '../../dsp/signal-generator.js';
import {
  INTERNAL_LOOPBACK_SLOT_INDEX,
  MAX_CAPTURE_TAP_SLOTS,
  MultiChannelRingBuffer,
  RingBufferStorage,
  TOTAL_RING_BUFFER_SLOTS,
} from '../ring-buffer.js';

declare const sampleRate: number;

class CaptureTapProcessor extends AudioWorkletProcessor {
  private ringBuffer: MultiChannelRingBuffer | null = null;
  private readonly generator: SignalGenerator;
  private isPaused = false;
  private readonly zeroFallback = new Float32Array(128);
  private readonly genScratch = new Float32Array(128);
  private readonly tapInputs: Float32Array[] = new Array(TOTAL_RING_BUFFER_SLOTS);
  private readonly batchSize = 1024;
  private readonly batchChannels: Float32Array[];
  private batchOffset = 0;

  constructor() {
    super();
    const sr = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.generator = new SignalGenerator(sr);
    this.batchChannels = Array.from(
      { length: TOTAL_RING_BUFFER_SLOTS },
      () => new Float32Array(this.batchSize)
    );

    this.port.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'init-ring-buffer' && msg.storage) {
        this.ringBuffer = new MultiChannelRingBuffer(msg.storage as RingBufferStorage);
      } else if (msg.type === 'update-generator-config' && msg.config) {
        this.generator.updateConfig(msg.config as Partial<SignalGeneratorConfig>);
      } else if (msg.type === 'pause') {
        this.isPaused = Boolean(msg.paused);
        this.batchOffset = 0;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.isPaused) {
      const genOut = outputs[0]?.[0];
      if (genOut) {
        genOut.fill(0);
      }
      return true;
    }

    const firstIn = inputs[0]?.[0];
    const frameLen = firstIn && firstIn.length > 0 ? firstIn.length : 128;

    const genOut = outputs[0]?.[0];
    const genBuf =
      genOut && genOut.length === frameLen
        ? genOut
        : this.genScratch.length >= frameLen
          ? this.genScratch.subarray(0, frameLen)
          : new Float32Array(frameLen);

    // Synthesize test signal into output buffer (0 when generator is disabled)
    this.generator.fillBuffer(genBuf, frameLen);
    if (genOut && genBuf !== genOut) {
      genOut.set(genBuf);
    }

    const zeroSlice =
      this.zeroFallback.length === frameLen
        ? this.zeroFallback
        : this.zeroFallback.subarray(0, frameLen);

    for (let tap = 0; tap < MAX_CAPTURE_TAP_SLOTS; tap++) {
      const chData = inputs[tap]?.[0];
      this.tapInputs[tap] =
        chData && chData.length === frameLen ? chData : zeroSlice;
    }
    this.tapInputs[INTERNAL_LOOPBACK_SLOT_INDEX] = genBuf;

    if (this.ringBuffer) {
      this.ringBuffer.write(this.tapInputs, frameLen);
    } else if (frameLen > 0) {
      if (this.batchOffset + frameLen > this.batchSize) {
        this.port.postMessage({
          type: 'audio-chunk',
          channels: this.batchChannels.map((b) => b.slice(0, this.batchOffset)),
        });
        this.batchOffset = 0;
      }
      for (let ch = 0; ch < TOTAL_RING_BUFFER_SLOTS; ch++) {
        this.batchChannels[ch].set(this.tapInputs[ch], this.batchOffset);
      }
      this.batchOffset += frameLen;
      if (this.batchOffset >= this.batchSize) {
        this.port.postMessage({
          type: 'audio-chunk',
          channels: this.batchChannels.map((b) => b.slice(0, this.batchOffset)),
        });
        this.batchOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor('capture-tap-processor', CaptureTapProcessor);
