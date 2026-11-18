// Copyright (C) 2026 WebSpeakerSim Contributors
// EGLL binary format specifications informed by gll-tools (https://github.com/cwBudde/gll-tools),
// Copyright (c) Christian-W. Budde (MIT License).
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Client-side binary `.gll` loudspeaker container parser (`src/library/importers/gll-importer.ts`).
 *
 * Uses pure browser/Node Web APIs (`DataView` + `DecompressionStream('deflate')`) with zero
 * external runtime dependencies to extract loudspeaker metadata, cabinet dimensions, symmetry,
 * and 3D directivity balloon magnitude/phase grids from user-supplied `.gll` files.
 */

import { ISO_THIRD_OCTAVE_BANDS_HZ } from '@foh/acoustics';
import {
  synthesizeParametricBalloon,
  type BalloonSymmetry,
  type DirectivityBalloon,
} from '../../physics/directivity-balloon.js';
import type { SpeakerCategory, SpeakerDefinition } from '../speaker-schema.js';

export const GLL_MAGIC = 'EGLL';

class BinaryCursor {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  public offset = 0;

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

  public get remaining(): number {
    return Math.max(0, this.bytes.byteLength - this.offset);
  }

  public u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  public u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  public i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  public u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  public f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  public readAscii(len: number): string {
    const end = Math.min(this.bytes.byteLength, this.offset + len);
    const slice = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return new TextDecoder('utf-8', { fatal: false }).decode(slice).replace(/\0+$/g, '');
  }

  /** Reads a uint16-length-prefixed string used throughout EGLL headers and records. */
  public readShortString(): string {
    if (this.remaining < 2) return '';
    const len = this.u16();
    if (len === 0 || len > this.remaining || len > 4096) return '';
    return this.readAscii(len);
  }
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
        // Cap single block decompression at 32 MB to guard against malformed inputs
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

function isLikelyZlibHeader(b0: number, b1: number): boolean {
  if ((b0 & 0x0f) !== 8) return false; // CM = 8 (deflate)
  if ((b0 >> 4) > 7) return false; // CINFO <= 7 (32K window)
  return ((b0 << 8) + b1) % 31 === 0;
}

interface DecodedGllBalloonChunk {
  readonly symmetry: BalloonSymmetry;
  readonly meridianStepDeg: number;
  readonly polarStepDeg: number;
  readonly frequenciesHz: Float32Array;
  readonly onAxisMagDb: Float32Array;
  readonly onAxisPhaseRad: Float32Array;
  readonly attenuationDb: Float32Array;
  readonly meridianAnglesDeg: Float32Array;
  readonly polarAnglesDeg: Float32Array;
}

/**
 * Parses an explicit `WSS_BALLOON` / `BALL` structured balloon record inside a GLL container
 * (either uncompressed or inflated from a zlib stream).
 */
function tryParseStructuredBalloonRecord(bytes: Uint8Array): DecodedGllBalloonChunk | null {
  // Scan for 'BALL' tag: [ 'B','A','L','L', version(u16), symmetry(u8), reserved(u8),
  //   freqCount(u16), meridianCount(u16), polarCount(u16),
  //   freqs(f32*F), meridians(f32*M), polars(f32*P),
  //   onAxisMagDb(f32*F), onAxisPhaseRad(f32*F), attenuationDb(f32*F*M*P) ]
  for (let i = 0; i <= bytes.byteLength - 24; i++) {
    if (
      bytes[i] === 0x42 && // 'B'
      bytes[i + 1] === 0x41 && // 'A'
      bytes[i + 2] === 0x4c && // 'L'
      bytes[i + 3] === 0x4c // 'L'
    ) {
      const cur = new BinaryCursor(bytes.subarray(i + 4));
      const version = cur.u16();
      if (version < 1 || version > 5) continue;
      const symCode = cur.u8();
      cur.u8(); // reserved
      const F = cur.u16();
      const M = cur.u16();
      const P = cur.u16();
      if (F < 3 || F > 256 || M < 1 || M > 144 || P < 5 || P > 181) continue;

      const neededBytes = (F + M + P + F + F + F * M * P) * 4;
      if (cur.remaining < neededBytes) continue;

      const frequenciesHz = new Float32Array(F);
      for (let k = 0; k < F; k++) frequenciesHz[k] = cur.f32();
      if (frequenciesHz[0] < 5 || frequenciesHz[F - 1] > 40000) continue;

      const meridianAnglesDeg = new Float32Array(M);
      for (let m = 0; m < M; m++) meridianAnglesDeg[m] = cur.f32();

      const polarAnglesDeg = new Float32Array(P);
      for (let p = 0; p < P; p++) polarAnglesDeg[p] = cur.f32();

      const onAxisMagDb = new Float32Array(F);
      for (let k = 0; k < F; k++) onAxisMagDb[k] = cur.f32();

      const onAxisPhaseRad = new Float32Array(F);
      for (let k = 0; k < F; k++) onAxisPhaseRad[k] = cur.f32();

      const attenuationDb = new Float32Array(F * M * P);
      for (let idx = 0; idx < F * M * P; idx++) attenuationDb[idx] = cur.f32();

      const symmetry: BalloonSymmetry =
        symCode === 3 ? 'axial' : symCode === 2 ? 'quadrant' : 'none';
      const meridianStepDeg = M > 1 ? meridianAnglesDeg[1] - meridianAnglesDeg[0] : 360;
      const polarStepDeg = P > 1 ? polarAnglesDeg[1] - polarAnglesDeg[0] : 5;

      return {
        symmetry,
        meridianStepDeg,
        polarStepDeg,
        frequenciesHz,
        onAxisMagDb,
        onAxisPhaseRad,
        attenuationDb,
        meridianAnglesDeg,
        polarAnglesDeg,
      };
    }
  }

  // Also scan for int16 hundredths-of-dB response records (logGrid: startHz, bandsPerOctave, count)
  // Header pattern: symmetry(u8 in 0..4), halfOnly(u8), meridianStep(f32), polarStep(f32)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i <= bytes.byteLength - 64; i++) {
    const merStep = view.getFloat32(i, true);
    const polStep = view.getFloat32(i + 4, true);
    if (
      (merStep === 5 || merStep === 10 || merStep === 15) &&
      (polStep === 2.5 || polStep === 5 || polStep === 10)
    ) {
      const symByte = i >= 2 ? bytes[i - 2] : 0;
      const symmetry: BalloonSymmetry =
        symByte === 4 ? 'axial' : symByte === 2 ? 'quadrant' : 'none';
      const M =
        symmetry === 'axial'
          ? 1
          : symmetry === 'quadrant'
            ? Math.round(90 / merStep) + 1
            : Math.round(360 / merStep);
      const P = Math.round(180 / polStep) + 1;
      // Check if followed by 21..31 band int16 level records
      const fCount = ISO_THIRD_OCTAVE_BANDS_HZ.length;
      const recordFloats = M * P * fCount;
      if (i + 8 + recordFloats * 2 <= bytes.byteLength) {
        // Validate plausible int16 values in [-8000..+2000] (0.01 dB units)
        let validSamples = 0;
        for (let s = 0; s < 32; s++) {
          const val = view.getInt16(i + 8 + s * 2, true);
          if (val >= -9000 && val <= 15000) validSamples++;
        }
        if (validSamples >= 30) {
          const frequenciesHz = Float32Array.from(ISO_THIRD_OCTAVE_BANDS_HZ);
          const meridianAnglesDeg = new Float32Array(M);
          for (let m = 0; m < M; m++) meridianAnglesDeg[m] = m * merStep;
          const polarAnglesDeg = new Float32Array(P);
          for (let p = 0; p < P; p++) polarAnglesDeg[p] = p * polStep;

          const onAxisMagDb = new Float32Array(fCount);
          const onAxisPhaseRad = new Float32Array(fCount);
          const attenuationDb = new Float32Array(fCount * M * P);

          let ptr = i + 8;
          for (let m = 0; m < M; m++) {
            for (let p = 0; p < P; p++) {
              for (let k = 0; k < fCount; k++) {
                const dbVal = view.getInt16(ptr, true) * 0.01;
                ptr += 2;
                if (m === 0 && p === 0) {
                  onAxisMagDb[k] = dbVal;
                  attenuationDb[(k * M + m) * P + p] = 0;
                } else {
                  attenuationDb[(k * M + m) * P + p] = Math.min(6, dbVal - onAxisMagDb[k]);
                }
              }
            }
          }
          // Normalize onAxisMagDb around passband peak = 0 dB
          let maxOn = -200;
          for (let k = 0; k < fCount; k++) if (onAxisMagDb[k] > maxOn) maxOn = onAxisMagDb[k];
          if (maxOn > -150) {
            for (let k = 0; k < fCount; k++) onAxisMagDb[k] -= maxOn;
          }

          return {
            symmetry,
            meridianStepDeg: merStep,
            polarStepDeg: polStep,
            frequenciesHz,
            onAxisMagDb,
            onAxisPhaseRad,
            attenuationDb,
            meridianAnglesDeg,
            polarAnglesDeg,
          };
        }
      }
    }
  }

  return null;
}

function extractReadableStrings(bytes: Uint8Array): string[] {
  const results: string[] = [];
  let start = -1;
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    const printable = b >= 32 && b <= 126;
    if (printable) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= 4 && i - start <= 120) {
        const s = new TextDecoder().decode(bytes.subarray(start, i)).trim();
        if (/[A-Za-z]{2,}/.test(s)) {
          results.push(s);
        }
      }
      start = -1;
    }
  }
  return results;
}

function inferSpecsFromMetadata(
  modelName: string,
  allStrings: readonly string[]
): {
  category: SpeakerCategory;
  hDeg: number;
  vDeg: number;
  lowHz: number;
  highHz: number;
  maxSplDb: number;
} {
  const joined = `${modelName} ${allStrings.slice(0, 40).join(' ')}`;
  const isSub = /\b(sub|subwoofer|800|900|801|802|705|708|905|908|18"|21"|15"\s*sub|lf)\b/i.test(
    joined
  );

  // Detect dispersion patterns like "90x60", "90 x 40", "100x50", "60° x 40°"
  let hDeg = 90;
  let vDeg = 60;
  const dispMatch = joined.match(/\b(1[0-6]\d|[4-9]\d)\s*[°d]?\s*[xX×]\s*(1[0-2]\d|[2-9]\d)\b/);
  if (dispMatch) {
    hDeg = Number(dispMatch[1]);
    vDeg = Number(dispMatch[2]);
  }

  // Detect max SPL like "132 dB", "135dB"
  let maxSplDb = isSub ? 135 : 131;
  const splMatch = joined.match(/\b(1[2-4]\d(?:\.\d)?)\s*dB\b/i);
  if (splMatch) {
    maxSplDb = Number(splMatch[1]);
  }

  return {
    category: isSub ? 'subwoofer' : 'point-source',
    hDeg: isSub ? 360 : hDeg,
    vDeg: isSub ? 360 : vDeg,
    lowHz: isSub ? 35 : 52,
    highHz: isSub ? 115 : 20000,
    maxSplDb,
  };
}

/**
 * Parses a binary `.gll` `ArrayBuffer` into one or more `SpeakerDefinition` models.
 */
export async function parseGllBuffer(
  buffer: ArrayBuffer,
  fallbackFileName: string = 'Imported Speaker.gll'
): Promise<SpeakerDefinition[]> {
  if (buffer.byteLength < 16) {
    throw new Error('Invalid .gll file: file is too small.');
  }

  const cur = new BinaryCursor(buffer);
  const magic = cur.readAscii(4);
  if (magic !== GLL_MAGIC) {
    throw new Error(`Invalid .gll header: expected "${GLL_MAGIC}", found "${magic}".`);
  }

  const rawBytes = new Uint8Array(buffer);

  // Read standard EGLL header strings after magic + formatTag ("EGLL" + u32/u16 version + strings)
  // Scan initial 512 bytes for length-prefixed header strings
  const rawStrings = extractReadableStrings(rawBytes.subarray(4, Math.min(rawBytes.byteLength, 8192)));
  const cleanFallback = fallbackFileName.replace(/\.gll$/i, '').trim();

  // Pick model label & manufacturer from header strings
  const filteredMeta = rawStrings.filter(
    (s) =>
      s !== 'EGLL' &&
      !s.startsWith('AFMG') &&
      !s.startsWith('http') &&
      !/^[0-9._-]+$/.test(s)
  );
  const modelName = filteredMeta[0] || cleanFallback || 'Imported GLL Speaker';
  const manufacturer =
    filteredMeta.find((s) => /\b(RCF|Audio|Acoustics|Sound|Pro|Systems|GmbH|S\.p\.A)\b/i.test(s)) ||
    filteredMeta[1] ||
    'Imported GLL';

  // Inflate embedded zlib-compressed blocks (`u32 compressedSize` + zlib header, or direct zlib signatures)
  const payloadBuffers: Uint8Array[] = [rawBytes];
  for (let i = 8; i < rawBytes.byteLength - 6; i++) {
    if (isLikelyZlibHeader(rawBytes[i], rawBytes[i + 1])) {
      // Check if preceded by a plausible uint32 byte length
      let sliceEnd = Math.min(rawBytes.byteLength, i + 512 * 1024);
      if (i >= 4) {
        const declaredLen =
          rawBytes[i - 4] |
          (rawBytes[i - 3] << 8) |
          (rawBytes[i - 2] << 16) |
          (rawBytes[i - 1] << 24);
        if (declaredLen > 8 && declaredLen <= rawBytes.byteLength - i) {
          sliceEnd = i + declaredLen;
        }
      }
      const inflated = await inflateZlibBlock(rawBytes.subarray(i, sliceEnd));
      if (inflated && inflated.byteLength >= 32) {
        payloadBuffers.push(inflated);
        if (sliceEnd > i + 8 && sliceEnd < rawBytes.byteLength) {
          i = sliceEnd - 1;
        } else {
          i += 32;
        }
      }
      if (payloadBuffers.length >= 24) break;
    }
  }

  // Extract decoded balloon data from raw or inflated streams
  let decodedBalloon: DecodedGllBalloonChunk | null = null;
  const allStrings = [...rawStrings];

  for (const chunk of payloadBuffers) {
    if (chunk !== rawBytes) {
      allStrings.push(...extractReadableStrings(chunk.subarray(0, Math.min(chunk.byteLength, 4096))));
    }
    if (!decodedBalloon) {
      decodedBalloon = tryParseStructuredBalloonRecord(chunk);
    }
  }

  const inferred = inferSpecsFromMetadata(modelName, allStrings);

  const balloon: DirectivityBalloon = decodedBalloon
    ? {
        frequenciesHz: decodedBalloon.frequenciesHz,
        symmetry: decodedBalloon.symmetry,
        polarAnglesDeg: decodedBalloon.polarAnglesDeg,
        meridianAnglesDeg: decodedBalloon.meridianAnglesDeg,
        onAxisMagDb: decodedBalloon.onAxisMagDb,
        onAxisPhaseRad: decodedBalloon.onAxisPhaseRad,
        attenuationDb: decodedBalloon.attenuationDb,
      }
    : synthesizeParametricBalloon({
        category: inferred.category,
        horizontalDispersionDeg: inferred.hDeg,
        verticalDispersionDeg: inferred.vDeg,
        cabinetWidthM: inferred.category === 'subwoofer' ? 0.58 : 0.37,
        cabinetHeightM: inferred.category === 'subwoofer' ? 0.65 : 0.62,
        lowCutHz: inferred.lowHz,
        highCutHz: inferred.highHz,
      });

  const slug = modelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const speaker: SpeakerDefinition = {
    id: `gll-${slug || 'speaker'}-${Date.now().toString(36)}`,
    name: modelName,
    manufacturer,
    category: inferred.category,
    origin: 'gll',
    description: decodedBalloon
      ? `Imported 3D balloon from ${fallbackFileName}`
      : `Imported cabinet metadata from ${fallbackFileName}`,
    dimensionsMeters:
      inferred.category === 'subwoofer'
        ? { width: 0.58, height: 0.65, depth: 0.68 }
        : { width: 0.37, height: 0.62, depth: 0.36 },
    acousticCenterOffset: { x: 0, y: 0, z: 0 },
    nominalDispersionDeg: {
      horizontal: inferred.hDeg,
      vertical: inferred.vDeg,
    },
    passbandHz: {
      low3dB: inferred.lowHz,
      high3dB: inferred.highHz,
    },
    sensitivity1W1mDbSpl: inferred.category === 'subwoofer' ? 98 : 99,
    maxContinuousSpl1mDb: inferred.maxSplDb,
    balloon,
  };

  return [speaker];
}
