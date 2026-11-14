// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Lock-free Single-Producer Single-Consumer (SPSC) Multi-Channel Ring Buffer
 * backed by SharedArrayBuffer (or standard ArrayBuffer in single-threaded tests)
 * for streaming sample-synchronous multi-channel float32 audio frames
 * (up to 8 active hardware tap channels + 1 internal generator loopback channel)
 * from the real-time AudioWorklet thread to the DSP Worker thread with zero allocations.
 */

const WRITE_INDEX_OFFSET = 0;
const READ_INDEX_OFFSET = 1;
const HEADER_INTS = 2; // writeIndex, readIndex (Uint32Array with Atomics)

export const MAX_CAPTURE_TAP_SLOTS = 8;
export const INTERNAL_LOOPBACK_SLOT_INDEX = MAX_CAPTURE_TAP_SLOTS; // Slot 8
export const TOTAL_RING_BUFFER_SLOTS = MAX_CAPTURE_TAP_SLOTS + 1; // 9 slots total

export interface RingBufferStorage {
  readonly headerBuffer: SharedArrayBuffer | ArrayBuffer;
  readonly channelBuffers: readonly (SharedArrayBuffer | ArrayBuffer)[];
  readonly capacity: number;
  readonly channelCount: number;
}

export function createRingBufferStorage(
  capacity: number,
  useSharedMemory: boolean = typeof SharedArrayBuffer !== 'undefined',
  channelCount: number = TOTAL_RING_BUFFER_SLOTS
): RingBufferStorage {
  if ((capacity & (capacity - 1)) !== 0 || capacity <= 0) {
    throw new Error(`RingBuffer capacity must be a positive power of 2, got ${capacity}`);
  }
  if (channelCount <= 0) {
    throw new Error(`RingBuffer channelCount must be positive, got ${channelCount}`);
  }
  const BufferCtor = useSharedMemory ? SharedArrayBuffer : ArrayBuffer;
  const channelBuffers: (SharedArrayBuffer | ArrayBuffer)[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    channelBuffers.push(new BufferCtor(capacity * Float32Array.BYTES_PER_ELEMENT));
  }
  return {
    headerBuffer: new BufferCtor(HEADER_INTS * Uint32Array.BYTES_PER_ELEMENT),
    channelBuffers,
    capacity,
    channelCount,
  };
}

export class MultiChannelRingBuffer {
  readonly capacity: number;
  readonly channelCount: number;
  private readonly mask: number;
  private readonly indices: Uint32Array;
  private readonly channels: Float32Array[];
  private readonly isShared: boolean;

  constructor(storage: RingBufferStorage) {
    if ((storage.capacity & (storage.capacity - 1)) !== 0 || storage.capacity <= 0) {
      throw new Error(
        `RingBuffer capacity must be a positive power of 2, got ${storage.capacity}`
      );
    }
    this.capacity = storage.capacity;
    this.channelCount = storage.channelBuffers.length;
    this.mask = storage.capacity - 1;
    this.indices = new Uint32Array(storage.headerBuffer);
    this.channels = storage.channelBuffers.map((buf) => new Float32Array(buf));
    this.isShared =
      typeof SharedArrayBuffer !== 'undefined' &&
      storage.headerBuffer instanceof SharedArrayBuffer;
  }

  private loadIndex(offset: number): number {
    return (this.isShared ? Atomics.load(this.indices, offset) : this.indices[offset]) >>> 0;
  }

  private storeIndex(offset: number, value: number): void {
    const uVal = value >>> 0;
    if (this.isShared) {
      Atomics.store(this.indices, offset, uVal);
    } else {
      this.indices[offset] = uVal;
    }
  }

  /** Number of sample frames currently available to read across all channels. */
  availableRead(): number {
    const writeIdx = this.loadIndex(WRITE_INDEX_OFFSET);
    const readIdx = this.loadIndex(READ_INDEX_OFFSET);
    return (writeIdx - readIdx) >>> 0;
  }

  /** Number of free sample frame slots available to write. */
  availableWrite(): number {
    return this.capacity - this.availableRead();
  }

  /**
   * Producer (AudioWorklet): Writes up to `length` sample frames across `inputs`.
   * Returns the number of sample frames actually written.
   */
  write(inputs: readonly Float32Array[], length?: number): number {
    if (inputs.length === 0) return 0;
    const requestedLen = length ?? inputs[0].length;
    const avail = this.availableWrite();
    let maxInputLen = requestedLen;
    for (let ch = 0; ch < Math.min(inputs.length, this.channelCount); ch++) {
      if (inputs[ch].length < maxInputLen) {
        maxInputLen = inputs[ch].length;
      }
    }
    const toWrite = Math.min(requestedLen, avail, maxInputLen);
    if (toWrite <= 0) {
      return 0;
    }

    const writeIdx = this.loadIndex(WRITE_INDEX_OFFSET);
    const pos = (writeIdx & this.mask) >>> 0;
    const firstChunk = Math.min(toWrite, this.capacity - pos);
    const secondChunk = toWrite - firstChunk;

    for (let ch = 0; ch < this.channelCount; ch++) {
      const dst = this.channels[ch];
      const src = inputs[ch];
      if (src) {
        dst.set(src.subarray(0, firstChunk), pos);
        if (secondChunk > 0) {
          dst.set(src.subarray(firstChunk, toWrite), 0);
        }
      } else {
        dst.fill(0, pos, pos + firstChunk);
        if (secondChunk > 0) {
          dst.fill(0, 0, secondChunk);
        }
      }
    }

    this.storeIndex(WRITE_INDEX_OFFSET, (writeIdx + toWrite) >>> 0);
    return toWrite;
  }

  /**
   * Consumer (DSP Worker): Reads up to `length` sample frames into `outputs`.
   * Returns the number of sample frames actually read.
   */
  read(outputs: readonly Float32Array[], length?: number): number {
    if (outputs.length === 0) return 0;
    const requestedLen = length ?? outputs[0].length;
    const avail = this.availableRead();
    let maxOutputLen = requestedLen;
    for (let ch = 0; ch < Math.min(outputs.length, this.channelCount); ch++) {
      if (outputs[ch].length < maxOutputLen) {
        maxOutputLen = outputs[ch].length;
      }
    }
    const toRead = Math.min(requestedLen, avail, maxOutputLen);
    if (toRead <= 0) {
      return 0;
    }

    const readIdx = this.loadIndex(READ_INDEX_OFFSET);
    const pos = (readIdx & this.mask) >>> 0;
    const firstChunk = Math.min(toRead, this.capacity - pos);
    const secondChunk = toRead - firstChunk;

    const chLimit = Math.min(outputs.length, this.channelCount);
    for (let ch = 0; ch < chLimit; ch++) {
      const src = this.channels[ch];
      const dst = outputs[ch];
      dst.set(src.subarray(pos, pos + firstChunk), 0);
      if (secondChunk > 0) {
        dst.set(src.subarray(0, secondChunk), firstChunk);
      }
    }

    this.storeIndex(READ_INDEX_OFFSET, (readIdx + toRead) >>> 0);
    return toRead;
  }

  /** Resets read and write pointers to 0. */
  clear(): void {
    this.storeIndex(WRITE_INDEX_OFFSET, 0);
    this.storeIndex(READ_INDEX_OFFSET, 0);
  }
}
