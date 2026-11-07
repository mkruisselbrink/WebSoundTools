/**
 * Real-time AudioWorkletProcessor that taps [Measurement, Reference] audio inputs
 * and writes them into a lock-free DualChannelRingBuffer (or posts chunks if fallback).
 */

import { DualChannelRingBuffer, RingBufferStorage } from '../ring-buffer.js';

class CaptureTapProcessor extends AudioWorkletProcessor {
  private ringBuffer: DualChannelRingBuffer | null = null;
  private readonly zeroFallback = new Float32Array(128);

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
      this.port.postMessage({
        type: 'audio-chunk',
        m: inputM.slice(),
        r: inputR.slice(),
      });
    }

    return true;
  }
}

registerProcessor('capture-tap-processor', CaptureTapProcessor);
