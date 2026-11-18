// Copyright (C) 2026 WebSpeakerSim Contributors
// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sampleDirectivityBalloon } from '../../../physics/directivity-balloon.js';
import { parseGllBuffer } from '../gll-importer.js';
import { decompressBitArray } from './gll-binary-reader.js';
import { GllSystemType, parseGllContainer } from './gll-container-parser.js';
import {
  GllSymmetryType,
  gllMeridianCount,
  gllParallelCount,
  gllResponseIndex,
  sampleGllBalloonComplexAtWssAngles,
} from './gll-spectrum-parser.js';

class BinaryBuilder {
  private readonly bytes: number[] = [];

  public u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }

  public i16(v: number): this {
    const buf = new ArrayBuffer(2);
    new DataView(buf).setInt16(0, v, true);
    this.raw(new Uint8Array(buf));
    return this;
  }

  public i32(v: number): this {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, v, true);
    this.raw(new Uint8Array(buf));
    return this;
  }

  public f64(v: number): this {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, true);
    this.raw(new Uint8Array(buf));
    return this;
  }

  public vec3(x: number, y: number, z: number): this {
    return this.f64(x).f64(y).f64(z);
  }

  public ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i) & 0xff);
    return this;
  }

  public str(s: string): this {
    const encoded = new TextEncoder().encode(s);
    this.i16(encoded.byteLength);
    this.raw(encoded);
    return this;
  }

  public raw(arr: Uint8Array | readonly number[]): this {
    for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i] & 0xff);
    return this;
  }

  public toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function wrapBlock(inner: BinaryBuilder | Uint8Array): Uint8Array {
  const payload = inner instanceof Uint8Array ? inner : inner.toUint8Array();
  return new BinaryBuilder().i32(payload.byteLength + 4).raw(payload).toUint8Array();
}

function wrapObjectBuffer(items: readonly Uint8Array[], vcheck = 0, sver = 0): Uint8Array {
  if (items.length === 0) {
    return new BinaryBuilder().i32(0).toUint8Array();
  }
  const b = new BinaryBuilder().i16(vcheck).i16(sver).i32(items.length);
  for (const item of items) b.raw(item);
  return wrapBlock(b);
}

/** Encodes an Int16Array with AFMG's 8-sample group `BitCompression` + delta differentiation. */
function compressBitArray(samples: Int16Array, stepSize = 8): Uint8Array {
  const deltas = new Int16Array(samples.length);
  if (samples.length > 0) {
    deltas[0] = samples[0];
    for (let i = 1; i < samples.length; i++) {
      deltas[i] = ((samples[i] - samples[i - 1]) << 16) >> 16;
    }
  }

  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let b = 0; b < count; b++) {
      bits.push((val >>> b) & 1);
    }
  };

  for (let i = 0; i < deltas.length; i += stepSize) {
    const groupLen = Math.min(stepSize, deltas.length - i);
    // Compute required signed bitDepth in 1..16
    let maxDepth = 1;
    for (let j = 0; j < groupLen; j++) {
      const v = deltas[i + j];
      for (let d = 1; d <= 16; d++) {
        const minV = d === 16 ? -32768 : -(1 << (d - 1));
        const maxV = d === 16 ? 32767 : (1 << (d - 1)) - 1;
        if (v >= minV && v <= maxV) {
          if (d > maxDepth) maxDepth = d;
          break;
        }
      }
    }
    pushBits(maxDepth - 1, 4);
    for (let j = 0; j < groupLen; j++) {
      pushBits(deltas[i + j] & 0xffff, maxDepth);
    }
  }

  // Pad to 16-bit word boundary because GLL stores compressedLen in int16 words
  const wordCount = Math.ceil(bits.length / 16);
  const out = new Uint8Array(wordCount * 2);
  for (let idx = 0; idx < bits.length; idx++) {
    if (bits[idx]) {
      out[idx >>> 3] |= 1 << (idx & 7);
    }
  }
  return out;
}

function buildRecordBlock(values: Int16Array, compressed: boolean): Uint8Array {
  const b = new BinaryBuilder().i16(0).i16(0);
  if (!compressed) {
    b.i32(0).i32(values.length);
    for (let i = 0; i < values.length; i++) b.i16(values[i]);
  } else {
    const compBytes = compressBitArray(values, 8);
    b.i32(1).i32(values.length).i32(compBytes.byteLength / 2).raw(compBytes);
  }
  return wrapBlock(b);
}

function buildTransferFunctionLsPs(
  bandsPerOctave: number,
  startFreqHz: number,
  levelDb: readonly number[],
  phaseRad: readonly number[],
  compressed = true
): Uint8Array {
  const n = levelDb.length;
  const lvl16 = new Int16Array(n);
  const ph16 = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    lvl16[i] = Math.round(levelDb[i] / 0.01);
    ph16[i] = Math.round((phaseRad[i] ?? 0) / 0.001);
  }

  const seq = wrapBlock(
    new BinaryBuilder()
      .i16(0)
      .i16(0)
      .raw(buildRecordBlock(lvl16, compressed))
      .raw(buildRecordBlock(ph16, compressed))
  );

  return wrapBlock(
    new BinaryBuilder()
      .i16(0)
      .i16(0)
      .i32(bandsPerOctave)
      .f64(startFreqHz)
      .i32(n)
      .raw(seq)
      .f64(0.0) // delay
  );
}

describe('GLL structured EASE_GLL binary parser & speaker builder', () => {
  it('round-trips AFMG 8-sample BitCompression with sign extension and wrapping delta integration', () => {
    const original = new Int16Array([
      0, -25, -80, -210, -450, -900, -1420, -2100, -2050, -1800, 32760, -32760,
    ]);
    const compressed = compressBitArray(original, 8);
    const decoded = decompressBitArray(compressed, original.length, true, 8);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('deduplicates North/South poles and maps WSS horizontal/vertical meridians to GLL coordinates', () => {
    // Quarter symmetry (code 1 -> GllSymmetryType.Quarter): merStep=45 (M=3: 0=Top, 45, 90=Right), parStep=90 (P=3: 0, 90, 180)
    const merCount = gllMeridianCount(45, GllSymmetryType.Quarter);
    const parCount = gllParallelCount(90, false);
    expect(merCount).toBe(3);
    expect(parCount).toBe(3);

    // Total responses = P (for mer=0: 0,1,2) + (M-1)*(P-2) (for mer=1: idx 3; mer=2: idx 4) = 5
    expect(gllResponseIndex(0, 0, parCount, false)).toBe(0);
    expect(gllResponseIndex(1, 0, parCount, false)).toBe(0); // shared North pole
    expect(gllResponseIndex(2, 2, parCount, false)).toBe(2); // shared South pole
    expect(gllResponseIndex(1, 1, parCount, false)).toBe(3);
    expect(gllResponseIndex(2, 1, parCount, false)).toBe(4);

    const def = { bandsPerOctave: 1, startFreqHz: 1000, pointCount: 1 };
    const mkTf = (db: number) => ({
      definition: def,
      levelDb: Float64Array.of(db),
      phaseRad: Float64Array.of(0),
      delaySec: 0,
    });

    // Make GLL Top (mer=0, par=90 => idx 1) = -12 dB (narrow vertical) and GLL Right (mer=90, par=90 => idx 4) = -3 dB (wide horizontal)
    const balloon = {
      flags: 0,
      angularResolution: {
        symmetry: GllSymmetryType.Quarter,
        frontHalfOnly: false,
        meridianStepDeg: 45,
        parallelStepDeg: 90,
      },
      responseCount: 5,
      responseVersion: 1,
      responses: [mkTf(0), mkTf(-12), mkTf(-20), mkTf(-7), mkTf(-3)],
    };

    const re = new Float64Array(1);
    const im = new Float64Array(1);

    // WSS horizontal (wssMer = 0 => +y_L left) must map to GLL horizontal (-3 dB)
    sampleGllBalloonComplexAtWssAngles(balloon, 0, 90, re, im);
    expect(20 * Math.log10(Math.hypot(re[0], im[0]))).toBeCloseTo(-3.0, 2);

    // WSS vertical (wssMer = 90 => +z_L top) must map to GLL vertical (-12 dB)
    sampleGllBalloonComplexAtWssAngles(balloon, 90, 90, re, im);
    expect(20 * Math.log10(Math.hypot(re[0], im[0]))).toBeCloseTo(-12.0, 2);
  });

  it('parses a complete EASE_GLL v6 two-way loudspeaker with CaseGeometry, FilterGroups, and BitCompressed balloons', async () => {
    // 10 octave bands: 31.25 Hz .. 16000 Hz
    const BPO = 1;
    const START_HZ = 31.25;
    const BANDS = 10;

    // Quarter symmetry: merStep=45 (M=3: 0=vert, 45=diag, 90=horiz), parStep=45 (P=5: 0,45,90,135,180)
    // Total stored responses = 5 + 2 * (5 - 2) = 11
    const buildHornBalloon = (isHf: boolean): Uint8Array => {
      const responses: Uint8Array[] = [];
      const merCount = 3;
      const parCount = 5;
      for (let m = 0; m < merCount; m++) {
        for (let p = 0; p < parCount; p++) {
          if (m > 0 && (p === 0 || p === parCount - 1)) continue;
          const parDeg = p * 45;
          const merDeg = m * 45; // 0 = vertical (narrower 60 deg), 90 = horizontal (wider 90 deg)
          const halfBeam = merDeg === 0 ? 30 : merDeg === 90 ? 45 : 37.5;
          const levels = Array.from({ length: BANDS }, (_, b) => {
            const f = START_HZ * Math.pow(2, b);
            const directivityScale = isHf || f >= 500 ? 1.0 : 0.25;
            return -6.0 * directivityScale * Math.pow(parDeg / halfBeam, 2);
          });
          const phases = new Array<number>(BANDS).fill(0);
          responses.push(buildTransferFunctionLsPs(BPO, START_HZ, levels, phases, true));
        }
      }

      const resBlock = wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(0)
          .i32(1) // on-disk 1 => Quarter symmetry
          .i32(0) // frontHalfOnly = false
          .f64(45) // meridianStep
          .f64(45) // parallelStep
      );

      const b = new BinaryBuilder()
        .i16(1) // vcheck = 1 (TransferFunctionLsPs)
        .i16(0)
        .i32(0) // flags
        .raw(resBlock)
        .i32(responses.length);
      for (const r of responses) b.raw(r);
      return wrapBlock(b);
    };

    const buildSourceDefItem = (
      key: string,
      label: string,
      lowHz: number,
      highHz: number,
      isHf: boolean
    ): Uint8Array => {
      const onAxisLevels = new Array<number>(BANDS).fill(97.5);
      const onAxisPhases = new Array<number>(BANDS).fill(0);
      const onAxisTf = buildTransferFunctionLsPs(BPO, START_HZ, onAxisLevels, onAxisPhases, true);

      const defBlock = wrapBlock(
        new BinaryBuilder()
          .i16(4) // versionCheck >= 4 -> TransferFunctionLsPs for OnAxisSpectrum
          .i16(0)
          .str(label)
          .str('AcousticWorks GmbH')
          .str(`${label} driver`)
          .f64(lowHz)
          .f64(highHz)
          .i32(1) // 1/3 oct
          .raw(buildHornBalloon(isHf))
          .i32(0) // onAxisFlags = 0
          .f64(97.5) // onAxisLevel
          .raw(onAxisTf)
      );

      return wrapBlock(new BinaryBuilder().i16(0).i16(0).str(key).raw(defBlock));
    };

    const buildIirFilterGroup = (
      key: string,
      label: string,
      filterType: number,
      freqHz: number
    ): Uint8Array => {
      const baseHeader = wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(0)
          .i32(0) // reserved
          .i32(0) // bypass = false
          .i32(0) // invert = false
          .f64(0) // gain
          .f64(0) // delay
          .str(label)
          .str(`${key}-f1`)
      );
      const iirParams = wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(0)
          .i32(filterType) // 0=LP, 1=HP
          .i32(1) // 1=LinkwitzRiley
          .i32(4) // 4th order (LR24)
          .f64(freqHz)
          .i32(2) // -6 dB alignment
          .f64(0) // reserved
          .f64(0.707)
          .f64(0)
      );
      const iirFilter = new BinaryBuilder()
        .i32(1) // FilterKindIIR = 1
        .raw(wrapBlock(new BinaryBuilder().i16(0).i16(0).raw(baseHeader).raw(iirParams)))
        .toUint8Array();

      const bank = wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(1) // sver = 1
          .i32(0) // reserved
          .i32(0) // bypass
          .i32(0) // invert
          .f64(0) // gain
          .f64(0) // delay
          .raw(wrapObjectBuffer([iirFilter]))
          .i32(0) // muteInput = false
      );

      const filterDef = wrapBlock(
        new BinaryBuilder().i16(0).i16(0).str(label).str(`${key}-def`).raw(bank)
      );
      return wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(1)
          .str(label)
          .str(key)
          .raw(wrapObjectBuffer([filterDef]))
          .i16(1)
      );
    };

    // CaseGeometry with vertices in millimeters: depth=340mm (X), width=360mm (Y), height=600mm (Z)
    const mkVertex = (x: number, y: number, z: number) =>
      wrapBlock(new BinaryBuilder().i16(0).i16(0).i32(0).vec3(x, y, z).str('').u8(0));
    const caseGeom = wrapBlock(
      new BinaryBuilder()
        .i16(0)
        .i16(0)
        .i32(0) // isSymmetric = false
        .f64(0)
        .raw(
          wrapObjectBuffer([
            mkVertex(-170, -180, -300),
            mkVertex(170, 180, 300),
            mkVertex(-170, 180, -300),
            mkVertex(170, -180, 300),
          ])
        )
        .raw(wrapObjectBuffer([])) // edges
    );

    const mkPlacement = (key: string, label: string, defKey: string, zMm: number) =>
      wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(0)
          .str(defKey)
          .vec3(0, 0, zMm)
          .vec3(0, 0, 0)
          .str(label)
          .str(key)
      );

    const boxInput = wrapBlock(
      new BinaryBuilder()
        .i16(0)
        .i16(1)
        .str('NL4 Passive')
        .i32(2)
        .str('src-lf')
        .str('fg-lp')
        .str('src-hf')
        .str('fg-hp')
        .f64(8.0)
    );
    const inputCfg = wrapBlock(
      wrapBlock(
        new BinaryBuilder()
          .i16(0)
          .i16(0)
          .str('Passive')
          .str('ic-passive')
          .raw(wrapObjectBuffer([boxInput]))
      )
    );

    const boxType = wrapBlock(
      new BinaryBuilder()
        .i16(0)
        .i16(1) // sver = 1 (includes opening angles)
        .str('AW-122 90x60')
        .str('bx-aw122')
        .raw(
          wrapObjectBuffer([
            mkPlacement('src-lf', 'LF 12"', 'sd-lf', -80),
            mkPlacement('src-hf', 'HF 1.4"', 'sd-hf', 140),
          ])
        )
        .raw(inputCfg)
        .raw(caseGeom)
        .vec3(0, 0, 0) // nextPivot
        .vec3(0, 0, 0) // referencePoint
        .vec3(0, 0, 0) // centerOfMass
        .f64(19.5) // weightKg
        .f64(60.0) // verticalOpeningAngle
        .f64(90.0) // horizontalOpeningAngle
    );

    const dbBlock = wrapBlock(
      new BinaryBuilder()
        .i16(0)
        .i16(3)
        .i32(0)
        .i32(0)
        .i32(0) // 1. DataFiles count = 0
        .raw(wrapObjectBuffer([boxType])) // 2. BoxTypes
        .i32(0) // 3. Frames empty
        .i32(0) // 4. Connectors empty
        .i32(0) // 5. Limits empty
        .raw(
          wrapObjectBuffer([
            buildSourceDefItem('sd-lf', 'LF 12"', 48, 1800, false),
            buildSourceDefItem('sd-hf', 'HF 1.4"', 1100, 20000, true),
          ])
        ) // 6. SourceDefinitions
        .i32(0) // 7. Warnings empty
        .raw(
          wrapObjectBuffer([
            buildIirFilterGroup('fg-lp', 'LF LP 1.3k', 0, 1300),
            buildIirFilterGroup('fg-hp', 'HF HP 1.3k', 1, 1300),
          ])
        ) // 8. FilterGroups
    );

    const genSystem = wrapBlock(
      new BinaryBuilder()
        .i16(0)
        .i16(1)
        .str('AW-122')
        .f64(2.0)
        .str('sys-aw122')
        .i32(GllSystemType.Loudspeaker)
        .str('AcousticWorks GmbH')
        .str('Compact 12-inch two-way point-source loudspeaker')
        .str('(c) 2026 AcousticWorks')
        .str('')
        .str('https://acousticworks.example')
        .str('')
        .i32(0)
        .raw(dbBlock)
        .i32(0) // flags
    );

    const gllBytes = new BinaryBuilder()
      .ascii('EGLL')
      .i32(0)
      .str('EASE_GLL')
      .i16(6) // formatVersion = 6
      .i16(0)
      .raw([0xde, 0xad, 0xbe, 0xef]) // checksum
      .i32(4) // hashLen = 4
      .raw([1, 2, 3, 4])
      .raw(genSystem)
      .toUint8Array();

    const container = parseGllContainer(gllBytes);
    expect(container).not.toBeNull();
    expect(container!.company).toBe('AcousticWorks GmbH');
    expect(container!.boxTypes).toHaveLength(1);
    expect(container!.sourceDefinitions).toHaveLength(2);
    expect(container!.filterGroups).toHaveLength(2);

    const speakers = await parseGllBuffer(gllBytes, 'AW-122.gll');
    expect(speakers).toHaveLength(1);
    const spk = speakers[0];
    expect(spk.manufacturer).toBe('AcousticWorks GmbH');
    expect(spk.name).toContain('AW-122');
    expect(spk.dimensionsMeters).toEqual({ width: 0.36, height: 0.6, depth: 0.34 });
    expect(spk.nominalDispersionDeg).toEqual({ horizontal: 90, vertical: 60 });
    expect(spk.sensitivity1W1mDbSpl).toBeGreaterThan(95);

    // Verify 3D balloon directional attenuation: wider in horizontal (mer=0) than vertical (mer=90) at 4 kHz!
    const h45 = sampleDirectivityBalloon(spk.balloon, 45, 0, 4000);
    const v45 = sampleDirectivityBalloon(spk.balloon, 45, 90, 4000);
    expect(h45.magnitudeDb).toBeCloseTo(-6.0, 0);
    expect(v45.magnitudeDb).toBeLessThan(h45.magnitudeDb - 4.0);
  });
});
