// Copyright (C) 2026 WebSpeakerSim Contributors
// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Little-endian `GllByteReader`, block-bounded buffer iterator, AFMG `BitCompression`
 * delta decompressor, and Web Streams `zlib` inflator for binary `.gll` containers.
 */

export const GLL_MAGIC = 'EGLL';
export const GLL_FORMAT_ID = 'EASE_GLL';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

export class GllByteReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private pos = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.bytes = buffer;
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
  }

  public get length(): number {
    return this.bytes.byteLength;
  }

  public get offset(): number {
    return this.pos;
  }

  public get remaining(): number {
    return Math.max(0, this.bytes.byteLength - this.pos);
  }

  public seek(nextOffset: number): void {
    this.pos = Math.max(0, Math.min(this.bytes.byteLength, nextOffset));
  }

  public readByte(): number {
    if (this.pos + 1 > this.bytes.byteLength) {
      throw new RangeError('Unexpected EOF reading byte');
    }
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  public readBytes(count: number): Uint8Array {
    if (count < 0 || this.pos + count > this.bytes.byteLength) {
      throw new RangeError(`Unexpected EOF reading ${count} bytes at ${this.pos}`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  public readInt16(): number {
    if (this.pos + 2 > this.bytes.byteLength) {
      throw new RangeError('Unexpected EOF reading int16');
    }
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  public readUint16(): number {
    if (this.pos + 2 > this.bytes.byteLength) {
      throw new RangeError('Unexpected EOF reading uint16');
    }
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  public readInt32(): number {
    if (this.pos + 4 > this.bytes.byteLength) {
      throw new RangeError('Unexpected EOF reading int32');
    }
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  public readFloat32(): number {
    if (this.pos + 4 > this.bytes.byteLength) {
      throw new RangeError('Unexpected EOF reading float32');
    }
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  public readFloat64(): number {
    if (this.pos + 8 > this.bytes.byteLength) {
      throw new RangeError('Unexpected EOF reading float64');
    }
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  public readAscii(count: number): string {
    const raw = this.readBytes(count);
    return utf8Decoder.decode(raw).replace(/\0+$/g, '');
  }

  /** Reads an int16-length-prefixed string used throughout `EASE_GLL` blocks. */
  public readString(): string {
    const len = this.readInt16();
    if (len < 0) {
      throw new RangeError(`Negative string length: ${len}`);
    }
    if (len === 0) {
      return '';
    }
    return utf8Decoder.decode(this.readBytes(len)).replace(/\0+$/g, '');
  }

  public readVector3D(): { readonly x: number; readonly y: number; readonly z: number } {
    const x = this.readFloat64();
    const y = this.readFloat64();
    const z = this.readFloat64();
    return { x, y, z };
  }

  /** Skips a standard size-prefixed GLL block (`blockSize` includes its own 4 bytes). */
  public skipBlock(maxOffset: number = this.length): void {
    if (this.pos >= maxOffset) return;
    const blockSize = this.readInt32();
    if (blockSize <= 0) return;
    const endOffset = Math.min(maxOffset, this.pos + blockSize - 4);
    this.seek(endOffset);
  }
}

/**
 * Parses a standard GLL `ObjectLSCBuffer` (`blockSize(i32) + vcheck(i16) + sver(i16) + count(i32) + items...`),
 * guaranteeing the reader lands cleanly at `bufferEnd` even on unsupported versions or partial items.
 */
export function parseBufferItems<T>(
  br: GllByteReader,
  maxOffset: number,
  expectedVCheck: number,
  parseItem: (br: GllByteReader, bufferEnd: number) => T | null
): T[] {
  if (br.offset >= maxOffset) {
    return [];
  }
  const blockSize = br.readInt32();
  if (blockSize <= 0) {
    return [];
  }
  const bufferEnd = Math.min(br.offset + blockSize - 4, maxOffset);
  try {
    const vcheck = br.readInt16();
    if (vcheck !== expectedVCheck) {
      return [];
    }
    br.readInt16(); // subVersion
    const count = br.readInt32();
    if (count <= 0 || count > 100000) {
      return [];
    }
    const items: T[] = [];
    for (let i = 0; i < count; i++) {
      if (br.offset >= bufferEnd) break;
      try {
        const item = parseItem(br, bufferEnd);
        if (item !== null) {
          items.push(item);
        }
      } catch {
        break;
      }
    }
    return items;
  } finally {
    br.seek(bufferEnd);
  }
}

const SIGN_EXTEND_MASKS = new Int16Array([
  0, -32768, -16384, -8192, -4096, -2048, -1024, -512, -256,
  -128, -64, -32, -16, -8, -4, -2, -1,
]);

function readBitsFromBytes(data: Uint8Array, bitPos: number, nBits: number): number {
  let result = 0;
  for (let i = 0; i < nBits; i++) {
    const byteOffset = (bitPos + i) >>> 3;
    const bitOffset = (bitPos + i) & 7;
    if (byteOffset < data.byteLength && (data[byteOffset] & (1 << bitOffset)) !== 0) {
      result |= 1 << i;
    }
  }
  return (result << 16) >> 16; // int16
}

function signExtend16(value: number, bitDepth: number): number {
  if (bitDepth >= 16) {
    return (value << 16) >> 16;
  }
  const signBit = (1 << (bitDepth - 1)) << 16 >> 16;
  const mask = SIGN_EXTEND_MASKS[16 - bitDepth];
  if ((value & signBit) !== 0) {
    return ((value | mask) << 16) >> 16;
  }
  return ((value & ~mask) << 16) >> 16;
}

/**
 * Decompresses AFMG's `BitCompression` spectrum array (`4-bit` group bit-depth headers
 * across `fixedStepSize = 8` groups + optional 16-bit wrapping delta integration).
 */
export function decompressBitArray(
  compressedData: Uint8Array,
  sampleCount: number,
  differentiated: boolean = true,
  fixedStepSize: number = 8
): Int16Array {
  const out = new Int16Array(sampleCount);
  let bitPos = 0;

  for (let i = 0; i < sampleCount; i += fixedStepSize) {
    const groupSize = Math.min(fixedStepSize, sampleCount - i);
    const header = readBitsFromBytes(compressedData, bitPos, 4) & 0x0f;
    const bitDepth = header + 1;
    bitPos += 4;

    for (let j = 0; j < groupSize; j++) {
      const raw = readBitsFromBytes(compressedData, bitPos, bitDepth);
      bitPos += bitDepth;
      out[i + j] = signExtend16(raw, bitDepth);
    }
  }

  if (differentiated && sampleCount > 1) {
    for (let i = 1; i < sampleCount; i++) {
      let sum = out[i] + out[i - 1];
      if (sum > 32767) sum -= 65536;
      else if (sum < -32768) sum += 65536;
      out[i] = sum;
    }
  }

  return out;
}

/**
 * Decompresses a zlib-wrapped stream (`0x78 0x01 | 0x5E | 0x9C | 0xDA`) via standard
 * Web Streams `DecompressionStream('deflate')`.
 */
export async function inflateZlibBlock(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') {
    return null;
  }
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    void writer.write(new Uint8Array(compressed)).catch(() => {});
    void writer.close().catch(() => {});

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total > 32 * 1024 * 1024) break;
      }
    }
    const merged = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.byteLength;
    }
    return total > 0 ? merged : null;
  } catch {
    return null;
  }
}
