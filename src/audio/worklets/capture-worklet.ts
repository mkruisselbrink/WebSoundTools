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

/**
 * Real-time AudioWorkletProcessor that taps [Measurement, Reference] audio inputs
 * and writes them into a lock-free DualChannelRingBuffer (or posts chunks if fallback).
 */

import {
  SignalGenerator,
  SignalGeneratorConfig,
} from '../../dsp/signal-generator.js';
import { DualChannelRingBuffer, RingBufferStorage } from '../ring-buffer.js';

declare const sampleRate: number;

class CaptureTapProcessor extends AudioWorkletProcessor {
  private ringBuffer: DualChannelRingBuffer | null = null;
  private readonly generator: SignalGenerator;
  private useInternalGenAsRef = false;
  private isPaused = false;
  private readonly zeroFallback = new Float32Array(128);
  private readonly genScratch = new Float32Array(128);
  private readonly batchSize = 1024;
  private readonly batchM = new Float32Array(this.batchSize);
  private readonly batchR = new Float32Array(this.batchSize);
  private batchOffset = 0;

  constructor() {
    super();
    const sr = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.generator = new SignalGenerator(sr);

    this.port.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'init-ring-buffer' && msg.storage) {
        this.ringBuffer = new DualChannelRingBuffer(msg.storage as RingBufferStorage);
      } else if (msg.type === 'update-generator-config' && msg.config) {
        this.generator.updateConfig(msg.config as Partial<SignalGeneratorConfig>);
      } else if (msg.type === 'set-ref-loopback') {
        this.useInternalGenAsRef = Boolean(msg.useInternalGenAsRef);
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

    const inputM = inputs[0]?.[0] ?? this.zeroFallback;
    const frameLen = inputM.length || 128;

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

    const inputR = this.useInternalGenAsRef
      ? genBuf
      : (inputs[1]?.[0] ?? inputs[0]?.[1] ?? this.zeroFallback);

    if (this.ringBuffer) {
      this.ringBuffer.write(inputM, inputR, inputM.length);
    } else if (inputM.length > 0) {
      const len = inputM.length;
      if (this.batchOffset + len > this.batchSize) {
        this.port.postMessage({
          type: 'audio-chunk',
          m: this.batchM.slice(0, this.batchOffset),
          r: this.batchR.slice(0, this.batchOffset),
        });
        this.batchOffset = 0;
      }
      this.batchM.set(inputM, this.batchOffset);
      this.batchR.set(inputR, this.batchOffset);
      this.batchOffset += len;
      if (this.batchOffset >= this.batchSize) {
        this.port.postMessage({
          type: 'audio-chunk',
          m: this.batchM.slice(0, this.batchOffset),
          r: this.batchR.slice(0, this.batchOffset),
        });
        this.batchOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor('capture-tap-processor', CaptureTapProcessor);
