// Copyright (C) 2026 WebSpeakerSim Contributors
// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * GLL `LogSpectrumDefinition`, `CLogSpectrumLP` / `TransferFunctionLsPs` record decoders,
 * `BalloonData` pole-deduplicated spherical grid indexing, and complex-pressure interpolation.
 */

import { GllByteReader, decompressBitArray } from './gll-binary-reader.js';

export const LEVEL_SCALE_FACTOR = 0.01; // int16 * 0.01 = dB
export const PHASE_SCALE_FACTOR = 0.001; // int16 * 0.001 = radians

export const enum GllSymmetryType {
  None = 0,
  Vertical = 1,
  Horizontal = 2,
  Quarter = 3,
  Axial = 4,
}

export interface GllLogSpectrumDef {
  readonly bandsPerOctave: number;
  readonly startFreqHz: number;
  readonly pointCount: number;
}

export interface GllTransferFunction {
  readonly definition: GllLogSpectrumDef;
  readonly levelDb: Float64Array;
  readonly phaseRad: Float64Array;
  readonly delaySec: number;
}

export interface GllResolutionDescriptor {
  readonly symmetry: GllSymmetryType;
  readonly frontHalfOnly: boolean;
  readonly meridianStepDeg: number;
  readonly parallelStepDeg: number;
}

export interface GllBalloonData {
  readonly flags: number;
  readonly angularResolution: GllResolutionDescriptor;
  readonly responseCount: number;
  readonly responseVersion: number;
  readonly responses: readonly GllTransferFunction[];
}

export function getSpectrumFrequencyHz(def: GllLogSpectrumDef, bandIndex: number): number {
  return def.startFreqHz * Math.pow(2, bandIndex / def.bandsPerOctave);
}

export function buildSpectrumFrequenciesHz(def: GllLogSpectrumDef): Float64Array {
  const n = Math.max(0, def.pointCount);
  const out = new Float64Array(n);
  if (n === 0 || def.bandsPerOctave <= 0) return out;
  for (let i = 0; i < n; i++) {
    out[i] = def.startFreqHz * Math.pow(2, i / def.bandsPerOctave);
  }
  return out;
}

export function parseLogSpectrumDefinition(br: GllByteReader): GllLogSpectrumDef {
  const bandsPerOctave = br.readInt32();
  const startFreqHz = br.readFloat64();
  const pointCount = br.readInt32();
  return { bandsPerOctave, startFreqHz, pointCount };
}

export function parseRecord(br: GllByteReader): Int16Array {
  const blockSize = br.readInt32();
  if (blockSize <= 0) {
    throw new Error(`Invalid record block size: ${blockSize}`);
  }
  const endOffset = br.offset + blockSize - 4;
  try {
    const vcheck = br.readInt16();
    if (vcheck !== 0) {
      throw new Error(`Unsupported record version: ${vcheck}`);
    }
    br.readInt16(); // subVersion
    const compressionType = br.readInt32();
    const elementCount = br.readInt32();
    if (elementCount < 0 || elementCount > 100000) {
      throw new Error(`Invalid record element count: ${elementCount}`);
    }

    if (compressionType === 0) {
      const out = new Int16Array(elementCount);
      for (let i = 0; i < elementCount; i++) {
        out[i] = br.readInt16();
      }
      return out;
    }
    if (compressionType === 1) {
      const compressedWords = br.readInt32();
      const compressedBytes = br.readBytes(compressedWords * 2);
      return decompressBitArray(compressedBytes, elementCount, true, 8);
    }
    throw new Error(`Unknown record compression type: ${compressionType}`);
  } finally {
    br.seek(endOffset);
  }
}

export function parseCLogSpectrumLP(br: GllByteReader): GllTransferFunction {
  const blockSize = br.readInt32();
  if (blockSize <= 0) {
    throw new Error(`Invalid CLogSpectrumLP block size: ${blockSize}`);
  }
  const endOffset = br.offset + blockSize - 4;
  try {
    const vcheck = br.readInt16();
    if (vcheck < 0 || vcheck > 1) {
      throw new Error(`Unsupported CLogSpectrumLP version: ${vcheck}`);
    }
    br.readInt16(); // subVersion
    const definition = parseLogSpectrumDefinition(br);
    const compressionType = br.readInt32();

    let levelRaw: Int16Array;
    let phaseRaw: Int16Array;

    if (compressionType === 0) {
      const levelCount = br.readInt32();
      levelRaw = new Int16Array(Math.max(0, levelCount));
      for (let i = 0; i < levelCount; i++) levelRaw[i] = br.readInt16();

      const phaseCount = br.readInt32();
      phaseRaw = new Int16Array(Math.max(0, phaseCount));
      for (let i = 0; i < phaseCount; i++) phaseRaw[i] = br.readInt16();
    } else if (compressionType === 1) {
      const levelCount = br.readInt32();
      const compLevelWords = br.readInt32();
      const compLevelBytes = br.readBytes(compLevelWords * 2);
      levelRaw = decompressBitArray(compLevelBytes, levelCount, true, 8);

      const phaseCount = br.readInt32();
      const compPhaseWords = br.readInt32();
      const compPhaseBytes = br.readBytes(compPhaseWords * 2);
      phaseRaw = decompressBitArray(compPhaseBytes, phaseCount, true, 8);
    } else {
      throw new Error(`Unknown CLogSpectrumLP compression type: ${compressionType}`);
    }

    const delaySec = br.offset + 8 <= endOffset ? br.readFloat64() : 0;
    const levelDb = new Float64Array(levelRaw.length);
    for (let i = 0; i < levelRaw.length; i++) levelDb[i] = levelRaw[i] * LEVEL_SCALE_FACTOR;
    const phaseRad = new Float64Array(phaseRaw.length);
    for (let i = 0; i < phaseRaw.length; i++) phaseRad[i] = phaseRaw[i] * PHASE_SCALE_FACTOR;

    return { definition, levelDb, phaseRad, delaySec };
  } finally {
    br.seek(endOffset);
  }
}

export function parseTransferFunctionLsPs(br: GllByteReader): GllTransferFunction {
  const blockSize = br.readInt32();
  if (blockSize <= 0) {
    throw new Error(`Invalid TransferFunctionLsPs block size: ${blockSize}`);
  }
  const endOffset = br.offset + blockSize - 4;
  try {
    const vcheck = br.readInt16();
    if (vcheck !== 0) {
      throw new Error(`Unsupported TransferFunctionLsPs version: ${vcheck}`);
    }
    br.readInt16(); // subVersion
    const definition = parseLogSpectrumDefinition(br);

    // ComplexSequence wrapper
    const seqBlockSize = br.readInt32();
    if (seqBlockSize <= 0) {
      throw new Error(`Invalid ComplexSequence block size: ${seqBlockSize}`);
    }
    const seqEnd = br.offset + seqBlockSize - 4;
    let levelRaw: Int16Array;
    let phaseRaw: Int16Array;
    try {
      const seqVCheck = br.readInt16();
      if (seqVCheck !== 0) {
        throw new Error(`Unsupported ComplexSequence version: ${seqVCheck}`);
      }
      br.readInt16();
      levelRaw = parseRecord(br);
      phaseRaw = parseRecord(br);
    } finally {
      br.seek(seqEnd);
    }

    const delaySec = br.offset + 8 <= endOffset ? br.readFloat64() : 0;
    const levelDb = new Float64Array(levelRaw.length);
    for (let i = 0; i < levelRaw.length; i++) levelDb[i] = levelRaw[i] * LEVEL_SCALE_FACTOR;
    const phaseRad = new Float64Array(phaseRaw.length);
    for (let i = 0; i < phaseRaw.length; i++) phaseRad[i] = phaseRaw[i] * PHASE_SCALE_FACTOR;

    return { definition, levelDb, phaseRad, delaySec };
  } finally {
    br.seek(endOffset);
  }
}

/** Converts on-disk symmetry code (`0=Axial, 1=Quarter, 2=Vertical, 3=Horizontal, 4=None`) to `GllSymmetryType`. */
export function mapOnDiskSymmetryCode(code: number): GllSymmetryType {
  switch (code) {
    case 0:
      return GllSymmetryType.Axial;
    case 1:
      return GllSymmetryType.Quarter;
    case 2:
      return GllSymmetryType.Vertical;
    case 3:
      return GllSymmetryType.Horizontal;
    case 4:
    default:
      return GllSymmetryType.None;
  }
}

export function parseBalloonData(br: GllByteReader, maxOffset: number): GllBalloonData | null {
  if (br.offset >= maxOffset) return null;
  const blockSize = br.readInt32();
  if (blockSize <= 0) return null;
  const balloonEnd = Math.min(maxOffset, br.offset + blockSize - 4);
  try {
    const vcheck = br.readInt16();
    if (vcheck < 0 || vcheck > 1) return null;
    br.readInt16(); // subVersion
    const flags = br.readInt32();

    // ResolutionDescriptor block (size = 32)
    const resSize = br.readInt32();
    if (resSize !== 32) return null;
    const resVCheck = br.readInt16();
    if (resVCheck !== 0) return null;
    br.readInt16();
    const symmetry = mapOnDiskSymmetryCode(br.readInt32());
    const frontHalfOnly = br.readInt32() !== 0;
    const meridianStepDeg = br.readFloat64();
    const parallelStepDeg = br.readFloat64();

    const responseCount = br.readInt32();
    const responses: GllTransferFunction[] = [];
    if (responseCount > 0 && responseCount <= 65536) {
      for (let i = 0; i < responseCount; i++) {
        if (br.offset >= balloonEnd) break;
        const tf =
          vcheck === 0 ? parseCLogSpectrumLP(br) : parseTransferFunctionLsPs(br);
        responses.push(tf);
      }
    }

    return {
      flags,
      angularResolution: {
        symmetry,
        frontHalfOnly,
        meridianStepDeg,
        parallelStepDeg,
      },
      responseCount,
      responseVersion: vcheck,
      responses,
    };
  } catch {
    return null;
  } finally {
    br.seek(balloonEnd);
  }
}

export function gllMeridianCount(stepDeg: number, symmetry: GllSymmetryType): number {
  if (stepDeg <= 0) return 1;
  switch (symmetry) {
    case GllSymmetryType.Axial:
      return 1;
    case GllSymmetryType.Quarter:
      return Math.trunc(90 / stepDeg) + 1;
    case GllSymmetryType.Vertical:
    case GllSymmetryType.Horizontal:
      return Math.trunc(180 / stepDeg) + 1;
    default:
      return Math.trunc(360 / stepDeg);
  }
}

export function gllParallelCount(stepDeg: number, frontHalfOnly: boolean): number {
  if (stepDeg <= 0) return 1;
  return frontHalfOnly ? Math.trunc(90 / stepDeg) + 1 : Math.trunc(180 / stepDeg) + 1;
}

export function foldGllMeridianDeg(merDeg: number, symmetry: GllSymmetryType): number {
  let m = ((merDeg % 360) + 360) % 360;
  switch (symmetry) {
    case GllSymmetryType.Axial:
      return 0;
    case GllSymmetryType.Quarter:
      if (m >= 270) return 360 - m;
      if (m >= 180) return m - 180;
      if (m >= 90) return 180 - m;
      return m;
    case GllSymmetryType.Vertical:
      return m >= 180 ? 360 - m : m;
    case GllSymmetryType.Horizontal: {
      m -= 90;
      if (m < 0) return -m;
      if (m >= 180) return 360 - m;
      return m;
    }
    default:
      return m;
  }
}

/** Meridian-major flat response index with North (`parIdx=0`) and South (`parIdx=parCount-1`) pole deduplication. */
export function gllResponseIndex(
  merIdx: number,
  parIdx: number,
  parCount: number,
  frontHalfOnly: boolean
): number {
  const isFrontPole = parIdx === 0;
  const isBackPole = parIdx === parCount - 1 && !frontHalfOnly;
  if (isFrontPole || isBackPole || merIdx === 0) {
    return parIdx;
  }
  const skippedPerMer = frontHalfOnly ? 1 : 2;
  const pointsPerMer = parCount - skippedPerMer;
  return parCount + (merIdx - 1) * pointsPerMer + (parIdx - 1);
}

/**
 * Evaluates a `GllBalloonData` at `WebSpeakerSim` spherical angles:
 *  - `wssPolarDeg` in `[0, 180]` (`0 = +x_L` front, `180 = -x_L` rear)
 *  - `wssMeridianDeg` in `[0, 360)` (`0 = +y_L` left, `90 = +z_L` top, `180 = -y_L` right, `270 = -z_L` bottom)
 * mapped to GLL's meridian frame (`0 = +Z` top, `90 = +Y` right => `gllMer = (wssMer + 270) % 360`).
 */
export function sampleGllBalloonComplexAtWssAngles(
  balloon: GllBalloonData,
  wssMeridianDeg: number,
  wssPolarDeg: number,
  outRe: Float64Array,
  outIm: Float64Array
): boolean {
  if (balloon.responses.length === 0) return false;
  const res = balloon.angularResolution;
  const merCount = gllMeridianCount(res.meridianStepDeg, res.symmetry);
  const parCount = gllParallelCount(res.parallelStepDeg, res.frontHalfOnly);
  if (merCount <= 0 || parCount <= 0) return false;

  const gllMer = foldGllMeridianDeg((wssMeridianDeg + 270) % 360, res.symmetry);
  let gllPar = Math.max(0, Math.min(180, wssPolarDeg));
  if (res.frontHalfOnly && gllPar > 90) {
    // Attenuate rear hemisphere smoothly when balloon only stores front hemisphere
    gllPar = 90;
  }

  const merFloat = res.meridianStepDeg > 0 ? gllMer / res.meridianStepDeg : 0;
  const parFloat = res.parallelStepDeg > 0 ? gllPar / res.parallelStepDeg : 0;

  const m0 = Math.min(merCount - 1, Math.max(0, Math.floor(merFloat)));
  let m1 = Math.ceil(merFloat);
  if (res.symmetry === GllSymmetryType.None && merCount > 1) {
    m1 %= merCount;
  } else if (m1 >= merCount) {
    m1 = merCount - 1;
  }

  const p0 = Math.min(parCount - 1, Math.max(0, Math.floor(parFloat)));
  const p1 = Math.min(parCount - 1, Math.max(0, Math.ceil(parFloat)));

  const maxIdx = balloon.responses.length - 1;
  const r00 = balloon.responses[Math.min(maxIdx, gllResponseIndex(m0, p0, parCount, res.frontHalfOnly))];
  const r01 = balloon.responses[Math.min(maxIdx, gllResponseIndex(m1, p0, parCount, res.frontHalfOnly))];
  const r10 = balloon.responses[Math.min(maxIdx, gllResponseIndex(m0, p1, parCount, res.frontHalfOnly))];
  const r11 = balloon.responses[Math.min(maxIdx, gllResponseIndex(m1, p1, parCount, res.frontHalfOnly))];

  const mFrac = merFloat - Math.floor(merFloat);
  const pFrac = parFloat - Math.floor(parFloat);
  const w00 = (1 - mFrac) * (1 - pFrac);
  const w01 = mFrac * (1 - pFrac);
  const w10 = (1 - mFrac) * pFrac;
  const w11 = mFrac * pFrac;

  const rearRollOffLinear =
    res.frontHalfOnly && wssPolarDeg > 90
      ? Math.pow(10, (-(wssPolarDeg - 90) * (18 / 90)) / 20)
      : 1.0;

  const n = Math.min(outRe.length, r00.levelDb.length);
  for (let b = 0; b < n; b++) {
    let re = 0;
    let im = 0;
    const corners: ReadonlyArray< readonly [number, GllTransferFunction] > = [
      [w00, r00],
      [w01, r01],
      [w10, r10],
      [w11, r11],
    ];
    for (const [w, tf] of corners) {
      if (w === 0 || b >= tf.levelDb.length) continue;
      const mag = w * Math.pow(10, tf.levelDb[b] / 20) * rearRollOffLinear;
      const ph = b < tf.phaseRad.length ? tf.phaseRad[b] - 2 * Math.PI * getSpectrumFrequencyHz(tf.definition, b) * tf.delaySec : 0;
      re += mag * Math.cos(ph);
      im += mag * Math.sin(ph);
    }
    outRe[b] = re;
    outIm[b] = im;
  }
  return true;
}
