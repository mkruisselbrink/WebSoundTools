/**
 * Real-time AudioWorkletProcessor that taps [Measurement, Reference] audio inputs
 * and writes them into a lock-free DualChannelRingBuffer (or posts chunks if fallback).
 */

import { DualChannelRingBuffer, RingBufferStorage } from '../ring-buffer.js';

class CaptureTapProcessor extends AudioWorkletProcessor {
  private ringBuffer: DualChannelRingBuffer | null = null;
  private readonly zeroFallback = new Float32Array(128);
  private readonly batchSize = 1024;
  private readonly batchM = new Float32Array(this.batchSize);
  private readonly batchR = new Float32Array(this.batchSize);
  private batchOffset = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg && msg.type === 'init-ring-buffer' && msg.storage) {
        this.ringBuffer = new DualChannelRingBuffer(msg.storage as RingBufferStorage);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inputM = inputs[0]?.[0] ?? this.zeroFallback;
    const inputR = inputs[1]?.[0] ?? inputs[0]?.[1] ?? this.zeroFallback;

    // Pass-through generator signal to output if connected
    if (outputs[0] && outputs[0][0] && inputs[1]?.[0]) {
      outputs[0][0].set(inputs[1][0]);
    }

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
