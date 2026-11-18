// Copyright (C) 2026 WebSpeakerSim Contributors
// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Client-side binary `.gll` (`EGLL` / `EASE_GLL`) loudspeaker container importer
 * (`src/library/importers/gll-importer.ts`).
 *
 * Decodes structured `EASE_GLL` v3–v6 containers (`GenSystem`, `Database`, `BoxTypes`,
 * `CaseGeometry`, `BoxInputConfig`, `SourceDefinitions`, bit-compressed & uncompressed
 * `BalloonData` / `OnAxisSpectrum` transfer functions, and `FilterGroups`) via
 * `src/library/importers/gll/*`, with fallback support for synthetic/minimal `EGLL` blobs.
 */

import {
  synthesizeParametricBalloon,
  type BalloonSymmetry,
  type DirectivityBalloon,
} from '../../physics/directivity-balloon.js';
import type { SpeakerCategory, SpeakerDefinition } from '../speaker-schema.js';
import {
  GLL_FORMAT_ID,
  GLL_MAGIC,
  GllByteReader,
  decompressBitArray,
  inflateZlibBlock,
} from './gll/gll-binary-reader.js';
import {
  type GllContainer,
  parseGllContainer,
} from './gll/gll-container-parser.js';
import { buildSpeakersFromGllContainer } from './gll/gll-speaker-builder.js';

export {
  GLL_FORMAT_ID,
  GLL_MAGIC,
  decompressBitArray,
  inflateZlibBlock,
  parseGllContainer,
  type GllContainer,
};

function isLikelyZlibHeader(b0: number, b1: number): boolean {
  if ((b0 & 0x0f) !== 8) return false;
  if (b0 >> 4 > 7) return false;
  return ((b0 << 8) + b1) % 31 === 0;
}

function tryParseSyntheticBallChunk(bytes: Uint8Array): DirectivityBalloon | null {
  for (let i = 0; i <= bytes.byteLength - 24; i++) {
    if (
      bytes[i] === 0x42 &&
      bytes[i + 1] === 0x41 &&
      bytes[i + 2] === 0x4c &&
      bytes[i + 3] === 0x4c
    ) {
      try {
        const cur = new GllByteReader(bytes.subarray(i + 4));
        const version = cur.readUint16();
        if (version < 1 || version > 5) continue;
        const symCode = cur.readByte();
        cur.readByte();
        const F = cur.readUint16();
        const M = cur.readUint16();
        const P = cur.readUint16();
        if (F < 3 || F > 256 || M < 1 || M > 144 || P < 5 || P > 181) continue;
        const neededBytes = (F + M + P + F + F + F * M * P) * 4;
        if (cur.remaining < neededBytes) continue;

        const frequenciesHz = new Float32Array(F);
        for (let k = 0; k < F; k++) frequenciesHz[k] = cur.readFloat32();
        if (frequenciesHz[0] < 5 || frequenciesHz[F - 1] > 40000) continue;

        const meridianAnglesDeg = new Float32Array(M);
        for (let m = 0; m < M; m++) meridianAnglesDeg[m] = cur.readFloat32();
        const polarAnglesDeg = new Float32Array(P);
        for (let p = 0; p < P; p++) polarAnglesDeg[p] = cur.readFloat32();
        const onAxisMagDb = new Float32Array(F);
        for (let k = 0; k < F; k++) onAxisMagDb[k] = cur.readFloat32();
        const onAxisPhaseRad = new Float32Array(F);
        for (let k = 0; k < F; k++) onAxisPhaseRad[k] = cur.readFloat32();
        const attenuationDb = new Float32Array(F * M * P);
        for (let idx = 0; idx < F * M * P; idx++) attenuationDb[idx] = cur.readFloat32();

        const symmetry: BalloonSymmetry =
          symCode === 3 ? 'axial' : symCode === 2 ? 'quadrant' : 'none';
        return {
          frequenciesHz,
          symmetry,
          polarAnglesDeg,
          meridianAnglesDeg,
          onAxisMagDb,
          onAxisPhaseRad,
          attenuationDb,
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function extractReadableStrings(bytes: Uint8Array): string[] {
  const results: string[] = [];
  let start = -1;
  const decoder = new TextDecoder();
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= 4 && i - start <= 120) {
        const s = decoder.decode(bytes.subarray(start, i)).trim();
        if (/[A-Za-z]{2,}/.test(s)) results.push(s);
      }
      start = -1;
    }
  }
  return results;
}

/**
 * Parses a binary `.gll` `ArrayBuffer` into one or more `SpeakerDefinition` models.
 */
export async function parseGllBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fallbackFileName: string = 'Imported Speaker.gll'
): Promise<SpeakerDefinition[]> {
  if (buffer.byteLength < 16) {
    throw new Error('Invalid .gll file: file is too small.');
  }

  const reader = new GllByteReader(buffer);
  const magic = reader.readAscii(4);
  if (magic !== GLL_MAGIC) {
    throw new Error(`Invalid .gll header: expected "${GLL_MAGIC}", found "${magic}".`);
  }

  // 1. Primary path: structured EASE_GLL v3-v6 container parser
  const container = parseGllContainer(buffer);
  if (container) {
    const built = buildSpeakersFromGllContainer(container, fallbackFileName);
    if (built.length > 0) {
      return built;
    }
  }

  // 2. Fallback path: header-only EASE_GLL containers (0 sources) or minimal synthetic EGLL fixtures
  const rawBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const rawStrings = extractReadableStrings(
    rawBytes.subarray(4, Math.min(rawBytes.byteLength, 8192))
  );
  const cleanFallback = fallbackFileName.replace(/\.gll$/i, '').trim();
  const filteredMeta = rawStrings.filter(
    (s) =>
      s !== GLL_MAGIC &&
      s !== GLL_FORMAT_ID &&
      !s.startsWith('AFMG') &&
      !s.startsWith('http') &&
      !/^[0-9._-]+$/.test(s)
  );

  const modelName = container?.label || filteredMeta[0] || cleanFallback || 'Imported GLL Speaker';
  const manufacturer =
    container?.company ||
    filteredMeta.find((s) => /\b(RCF|Audio|Acoustics|Sound|Pro|Systems|GmbH|S\.p\.A)\b/i.test(s)) ||
    filteredMeta[1] ||
    'Imported GLL';

  const payloadBuffers: Uint8Array[] = [rawBytes];
  for (let i = 8; i < rawBytes.byteLength - 6; i++) {
    if (isLikelyZlibHeader(rawBytes[i], rawBytes[i + 1])) {
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
        i = sliceEnd > i + 8 && sliceEnd < rawBytes.byteLength ? sliceEnd - 1 : i + 32;
      }
      if (payloadBuffers.length >= 24) break;
    }
  }

  let decodedBalloon: DirectivityBalloon | null = null;
  for (const chunk of payloadBuffers) {
    decodedBalloon = tryParseSyntheticBallChunk(chunk);
    if (decodedBalloon) break;
  }

  const joined = `${modelName} ${container?.infoText ?? ''} ${rawStrings.slice(0, 40).join(' ')}`;
  const hasHighDriver = /\b(hf|mhf|2-way|two-way|3-way|three-way|compression|tweeter)\b/i.test(joined);
  const isSub = !hasHighDriver && /\b(sub|subwoofer|18"|21")\b/i.test(joined);
  const dispMatch = joined.match(/\b(1[0-6]\d|[4-9]\d)\s*[°d]?\s*[xX×]\s*(1[0-2]\d|[2-9]\d)\b/);
  const hDeg = isSub ? 360 : dispMatch ? Number(dispMatch[1]) : 90;
  const vDeg = isSub ? 360 : dispMatch ? Number(dispMatch[2]) : 60;
  const splMatch = joined.match(/\b(1[2-4]\d(?:\.\d)?)\s*dB\b/i);
  const maxSplDb = splMatch ? Number(splMatch[1]) : isSub ? 135 : 131;
  const category: SpeakerCategory = isSub ? 'subwoofer' : 'point-source';
  const lowHz = isSub ? 35 : 52;
  const highHz = isSub ? 115 : 20000;

  const balloon =
    decodedBalloon ??
    synthesizeParametricBalloon({
      category,
      horizontalDispersionDeg: hDeg,
      verticalDispersionDeg: vDeg,
      cabinetWidthM: isSub ? 0.58 : 0.37,
      cabinetHeightM: isSub ? 0.65 : 0.62,
      lowCutHz: lowHz,
      highCutHz: highHz,
    });

  const slug = modelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return [
    {
      id: `gll-${slug || 'speaker'}-1`,
      name: modelName,
      manufacturer,
      category,
      origin: 'gll',
      description: decodedBalloon
        ? `Imported 3D balloon from ${fallbackFileName}`
        : `Imported cabinet metadata from ${fallbackFileName}`,
      dimensionsMeters: isSub
        ? { width: 0.58, height: 0.65, depth: 0.68 }
        : { width: 0.37, height: 0.62, depth: 0.36 },
      acousticCenterOffset: { x: 0, y: 0, z: 0 },
      nominalDispersionDeg: { horizontal: hDeg, vertical: vDeg },
      passbandHz: { low3dB: lowHz, high3dB: highHz },
      sensitivity1W1mDbSpl: isSub ? 98 : 99,
      maxContinuousSpl1mDb: maxSplDb,
      balloon,
    },
  ];
}
