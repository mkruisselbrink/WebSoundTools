// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sampleDirectivityBalloon } from '../../physics/directivity-balloon.js';
import { buildSpeakerFromSpec } from '../spec-builder.js';
import {
  buildSpeakerFromFrdText,
  deserializeSpeakerFromJson,
  importSpeakerArrayBuffer,
  inflateZlibBlock,
  parseClfText,
  parseFrdCurveText,
  parseGllBuffer,
  serializeSpeakerToJson,
} from './index.js';

async function deflateZlibBlock(raw: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(new Uint8Array(raw));
  void writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

function buildSyntheticBalloonRecord(): Uint8Array {
  const freqs = [100, 500, 2000, 8000];
  const meridians = [0, 45, 90];
  const polars = [0, 30, 60, 90, 120, 150, 180];
  const F = freqs.length;
  const M = meridians.length;
  const P = polars.length;

  const headerSize = 4 + 2 + 1 + 1 + 2 + 2 + 2; // 'BALL' + version + sym + res + F + M + P = 14 bytes
  const floatCount = F + M + P + F + F + F * M * P;
  const buf = new ArrayBuffer(headerSize + floatCount * 4);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // 'BALL'
  bytes.set([0x42, 0x41, 0x4c, 0x4c], 0);
  view.setUint16(4, 1, true); // version 1
  view.setUint8(6, 2); // quadrant symmetry
  view.setUint8(7, 0);
  view.setUint16(8, F, true);
  view.setUint16(10, M, true);
  view.setUint16(12, P, true);

  let off = 14;
  const writeF32 = (v: number) => {
    view.setFloat32(off, v, true);
    off += 4;
  };

  for (const f of freqs) writeF32(f);
  for (const m of meridians) writeF32(m);
  for (const p of polars) writeF32(p);
  // onAxisMagDb
  for (let k = 0; k < F; k++) writeF32(k === 2 ? 0 : -1.5);
  // onAxisPhaseRad
  for (let k = 0; k < F; k++) writeF32(-0.25 * k);
  // attenuationDb: -0.15 dB per degree off-axis horizontally, steeper vertically
  for (let k = 0; k < F; k++) {
    for (let m = 0; m < M; m++) {
      const slope = m === 2 ? -0.22 : -0.12;
      for (let p = 0; p < P; p++) {
        writeF32(polars[p] * slope);
      }
    }
  }
  return bytes;
}

describe('Loudspeaker Importers (.gll, .clf, .frd, .json)', () => {
  it('inflates zlib blocks and parses a binary EGLL file with compressed 3D balloon chunk', async () => {
    const rawBalloon = buildSyntheticBalloonRecord();
    const compressedBalloon = await deflateZlibBlock(rawBalloon);

    const roundTrip = await inflateZlibBlock(compressedBalloon);
    expect(roundTrip).not.toBeNull();
    expect(roundTrip!.byteLength).toBe(rawBalloon.byteLength);

    // Construct synthetic EGLL container:
    // "EGLL" + version + metadata strings ("TT 12-A 90x60 133 dB\0RCF S.p.A.\0") + u32 len + zlib chunk
    const metaBytes = new TextEncoder().encode(
      '\x00\x04\x00\x00TT 12-A 90x60 133 dB\x00RCF S.p.A.\x00'
    );
    const totalLen = 4 + metaBytes.byteLength + 4 + compressedBalloon.byteLength + 16;
    const gllBuf = new ArrayBuffer(totalLen);
    const gllBytes = new Uint8Array(gllBuf);
    const gllView = new DataView(gllBuf);

    gllBytes.set([0x45, 0x47, 0x4c, 0x4c], 0); // "EGLL"
    gllBytes.set(metaBytes, 4);
    const lenPos = 4 + metaBytes.byteLength;
    gllView.setUint32(lenPos, compressedBalloon.byteLength, true);
    gllBytes.set(compressedBalloon, lenPos + 4);

    const speakers = await parseGllBuffer(gllBuf, 'TT12A.gll');
    expect(speakers).toHaveLength(1);
    const spk = speakers[0];
    expect(spk.origin).toBe('gll');
    expect(spk.name).toContain('TT 12-A');
    expect(spk.manufacturer).toContain('RCF');
    expect(spk.category).toBe('point-source');
    expect(spk.nominalDispersionDeg.horizontal).toBe(90);
    expect(spk.nominalDispersionDeg.vertical).toBe(60);
    expect(spk.maxContinuousSpl1mDb).toBe(133);
    expect(Array.from(spk.balloon.frequenciesHz)).toEqual([100, 500, 2000, 8000]);

    // Verify 60 deg horizontal off-axis attenuation matches synthetic balloon (-0.12 * 60 = -7.2 dB at 2000 Hz)
    const sample = sampleDirectivityBalloon(spk.balloon, 60, 0, 2000);
    expect(sample.magnitudeDb).toBeCloseTo(-7.2, 1);
  });

  it('rejects non-EGLL buffers and falls back to calibrated parametric balloon for metadata-only GLLs', async () => {
    const bad = new TextEncoder().encode('NOT_A_GLL_FILE_HEADER_12345').buffer;
    await expect(parseGllBuffer(bad)).rejects.toThrow(/Invalid \.gll header/);

    const metaSub = new TextEncoder().encode(
      'EGLL\x01\x00\x00\x00SUB 8004-AS 18" Subwoofer 136 dB\x00RCF Audio\x00\x00\x00\x00'
    ).buffer;
    const parsed = await importSpeakerArrayBuffer('SUB8004.gll', metaSub);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].category).toBe('subwoofer');
    expect(parsed[0].maxContinuousSpl1mDb).toBe(136);
    expect(parsed[0].balloon.frequenciesHz.length).toBeGreaterThan(20);
  });

  it('parses .clf horizontal and vertical polar tables and estimates -6 dB beamwidths', () => {
    const clfText = `
# Sample CLF polar table
<CABINET> Compact 80x50 Top
<MANUFACTURER> Generic Pro Audio
<SENSITIVITY> 96 98 99 98
<MAXSPL> 131
<FREQ> 250 1000 2000 8000
<HORIZONTAL>
0   0.0   0.0   0.0   0.0
20 -1.2  -1.5  -1.5  -2.0
40 -3.5  -5.5  -6.0  -7.5
60 -7.0 -11.0 -12.5 -15.0
90 -12.0 -18.0 -20.0 -24.0
<VERTICAL>
0   0.0   0.0   0.0   0.0
25 -2.0  -5.0  -6.0  -8.0
50 -6.0 -12.0 -14.0 -18.0
90 -14.0 -20.0 -22.0 -26.0
<END>
`;
    const spk = parseClfText(clfText, 'compact.clf');
    expect(spk.origin).toBe('clf');
    expect(spk.name).toBe('Compact 80x50 Top');
    expect(spk.manufacturer).toBe('Generic Pro Audio');
    expect(spk.sensitivity1W1mDbSpl).toBe(99);
    expect(spk.maxContinuousSpl1mDb).toBe(131);
    expect(spk.nominalDispersionDeg.horizontal).toBe(80);
    expect(spk.nominalDispersionDeg.vertical).toBe(50);
  });

  it('parses .frd frequency/magnitude/phase curves and round-trips .json speaker definitions', () => {
    const frdText = `
* Freq(Hz) Mag(dB) Phase(deg)
50    91.0   90.0
100   97.0   35.0
1000  99.0    0.0
4000  98.5  -45.0
16000 94.0 -130.0
`;
    const curve = parseFrdCurveText(frdText);
    expect(curve.frequenciesHz).toHaveLength(5);
    expect(curve.magnitudeDb[2]).toBeCloseTo(99.0, 2);

    const spk = buildSpeakerFromFrdText(frdText, {
      name: 'Measured 12-inch Top',
      horizontalDispersionDeg: 90,
      verticalDispersionDeg: 60,
      maxContinuousSpl1mDb: 132,
    });
    expect(spk.origin).toBe('frd');
    expect(spk.sensitivity1W1mDbSpl).toBeCloseTo(99.0, 1);

    // Lossless JSON serialization round-trip
    const specSpeaker = buildSpeakerFromSpec({
      name: 'Custom Spec 10"',
      category: 'point-source',
      horizontalDispersionDeg: 100,
      verticalDispersionDeg: 60,
      low3dBHz: 60,
      high3dBHz: 18000,
      maxContinuousSpl1mDb: 129,
    });
    const json = serializeSpeakerToJson(specSpeaker);
    const restoredExternal = deserializeSpeakerFromJson(json, false);
    const restoredInternal = deserializeSpeakerFromJson(json, true);

    expect(restoredExternal.origin).toBe('json');
    expect(restoredInternal.origin).toBe('spec-builder');
    expect(restoredInternal.name).toBe('Custom Spec 10"');
    expect(restoredInternal.balloon.attenuationDb.length).toBe(
      specSpeaker.balloon.attenuationDb.length
    );
  });
});
