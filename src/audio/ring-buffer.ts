/**
 * Lock-free Single-Producer Single-Consumer (SPSC) Ring Buffer
 * backed by SharedArrayBuffer (or standard ArrayBuffer in single-threaded tests)
 * for streaming interleaved or planar [Measurement, Reference] float32 audio frames
 * from the real-time AudioWorklet thread to the DSP Worker thread with zero allocations.
 */

const WRITE_INDEX_OFFSET = 0;
const READ_INDEX_OFFSET = 1;
const HEADER_INTS = 2; // writeIndex, readIndex (Int32Array with Atomics)

export interface RingBufferStorage {
  readonly headerBuffer: SharedArrayBuffer | ArrayBuffer;
  readonly dataBufferM: SharedArrayBuffer | ArrayBuffer;
  readonly dataBufferR: SharedArrayBuffer | ArrayBuffer;
  readonly capacity: number;
}

export function createRingBufferStorage(
  capacity: number,
  useSharedMemory: boolean = typeof SharedArrayBuffer !== 'undefined'
): RingBufferStorage {
  if ((capacity & (capacity - 1)) !== 0 || capacity <= 0) {
    throw new Error(`RingBuffer capacity must be a positive power of 2, got ${capacity}`);
  }
  const BufferCtor = useSharedMemory ? SharedArrayBuffer : ArrayBuffer;
  return {
    headerBuffer: new BufferCtor(HEADER_INTS * Int32Array.BYTES_PER_ELEMENT),
    dataBufferM: new BufferCtor(capacity * Float32Array.BYTES_PER_ELEMENT),
    dataBufferR: new BufferCtor(capacity * Float32Array.BYTES_PER_ELEMENT),
    capacity,
  };
}

export class DualChannelRingBuffer {
  readonly capacity: number;
  private readonly mask: number;
  private readonly indices: Int32Array;
  private readonly dataM: Float32Array;
  private readonly dataR: Float32Array;
  private readonly isShared: boolean;

  constructor(storage: RingBufferStorage) {
    if ((storage.capacity & (storage.capacity - 1)) !== 0 || storage.capacity <= 0) {
      throw new Error(`RingBuffer capacity must be a positive power of 2, got ${storage.capacity}`);
    }
    this.capacity = storage.capacity;
    this.mask = storage.capacity - 1;
    this.indices = new Int32Array(storage.headerBuffer);
    this.dataM = new Float32Array(storage.dataBufferM);
    this.dataR = new Float32Array(storage.dataBufferR);
    this.isShared =
      typeof SharedArrayBuffer !== 'undefined' &&
      storage.headerBuffer instanceof SharedArrayBuffer;
  }

  private loadIndex(offset: number): number {
    return this.isShared ? Atomics.load(this.indices, offset) : this.indices[offset];
  }

  private storeIndex(offset: number, value: number): void {
    if (this.isShared) {
      Atomics.store(this.indices, offset, value);
    } else {
      this.indices[offset] = value;
    }
  }

  /** Number of samples currently available to read. */
  availableRead(): number {
    const writeIdx = this.loadIndex(WRITE_INDEX_OFFSET);
    const readIdx = this.loadIndex(READ_INDEX_OFFSET);
    return (writeIdx - readIdx) | 0;
  }

  /** Number of free sample slots available to write. */
  availableWrite(): number {
    return this.capacity - this.availableRead();
  }

  /**
   * Producer (AudioWorklet): Writes up to `length` samples from `inputM` and `inputR`.
   * Returns the number of samples actually written.
   */
  write(inputM: Float32Array, inputR: Float32Array, length: number = inputM.length): number {
    const avail = this.availableWrite();
    const toWrite = Math.min(length, avail, inputM.length, inputR.length);
    if (toWrite <= 0) {
      return 0;
    }

    const writeIdx = this.loadIndex(WRITE_INDEX_OFFSET);
    const pos = writeIdx & this.mask;
    const firstChunk = Math.min(toWrite, this.capacity - pos);

    this.dataM.set(inputM.subarray(0, firstChunk), pos);
    this.dataR.set(inputR.subarray(0, firstChunk), pos);

    const secondChunk = toWrite - firstChunk;
    if (secondChunk > 0) {
      this.dataM.set(inputM.subarray(firstChunk, toWrite), 0);
      this.dataR.set(inputR.subarray(firstChunk, toWrite), 0);
    }

    this.storeIndex(WRITE_INDEX_OFFSET, (writeIdx + toWrite) | 0);
    return toWrite;
  }

  /**
   * Consumer (DSP Worker): Reads up to `length` samples into `outputM` and `outputR`.
   * Returns the number of samples actually read.
   */
  read(outputM: Float32Array, outputR: Float32Array, length: number = outputM.length): number {
    const avail = this.availableRead();
    const toRead = Math.min(length, avail, outputM.length, outputR.length);
    if (toRead <= 0) {
      return 0;
    }

    const readIdx = this.loadIndex(READ_INDEX_OFFSET);
    const pos = readIdx & this.mask;
    const firstChunk = Math.min(toRead, this.capacity - pos);

    outputM.set(this.dataM.subarray(pos, pos + firstChunk), 0);
    outputR.set(this.dataR.subarray(pos, pos + firstChunk), 0);

    const secondChunk = toRead - firstChunk;
    if (secondChunk > 0) {
      outputM.set(this.dataM.subarray(0, secondChunk), firstChunk);
      outputR.set(this.dataR.subarray(0, secondChunk), firstChunk);
    }

    this.storeIndex(READ_INDEX_OFFSET, (readIdx + toRead) | 0);
    return toRead;
  }

  /** Resets read and write pointers to 0. */
  clear(): void {
    this.storeIndex(WRITE_INDEX_OFFSET, 0);
    this.storeIndex(READ_INDEX_OFFSET, 0);
  }
}
