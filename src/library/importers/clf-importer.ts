/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Tab/whitespace-delimited `.clf` (Common Loudspeaker Format text) polar importer
 * (`src/library/importers/clf-importer.ts`).
 */

import type { DirectivityBalloon } from '../../physics/directivity-balloon.js';
import { DEG_TO_RAD } from '../../physics/transform3d.js';
import type { SpeakerCategory, SpeakerDefinition } from '../speaker-schema.js';

export function parseClfText(
  text: string,
  fallbackName: string = 'Imported CLF Speaker'
): SpeakerDefinition {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith(';'));

  let name = fallbackName.replace(/\.(clf|tab|txt)$/i, '');
  let manufacturer = 'Imported CLF';
  let sensitivity = 98;
  let maxSpl = 130;
  let category: SpeakerCategory = 'point-source';

  let freqs: number[] = [];
  let sensitivityByBand: number[] = [];
  const horizMap = new Map<number, number[]>(); // angleDeg -> attenuationDb[F]
  const vertMap = new Map<number, number[]>(); // angleDeg -> attenuationDb[F]

  let activeSection: 'none' | 'horizontal' | 'vertical' = 'none';

  for (const line of lines) {
    const tagMatch = line.match(/^<([A-Z0-9_-]+)>\s*(.*)$/i);
    if (tagMatch) {
      const tag = tagMatch[1].toUpperCase();
      const rest = tagMatch[2].trim();
      const nums = rest
        .split(/[\s,;]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));

      switch (tag) {
        case 'CABINET':
        case 'MODEL':
        case 'NAME':
          if (rest) name = rest;
          activeSection = 'none';
          break;
        case 'MANUFACTURER':
        case 'BRAND':
          if (rest) manufacturer = rest;
          activeSection = 'none';
          break;
        case 'TYPE':
        case 'CATEGORY':
          if (/sub/i.test(rest)) category = 'subwoofer';
          activeSection = 'none';
          break;
        case 'SENSITIVITY':
          if (nums.length === 1) sensitivity = nums[0];
          else if (nums.length > 1) sensitivityByBand = nums;
          activeSection = 'none';
          break;
        case 'MAXSPL':
        case 'MAX_SPL':
          if (nums.length >= 1) maxSpl = Math.max(...nums);
          activeSection = 'none';
          break;
        case 'FREQ':
        case 'FREQUENCIES':
        case 'BANDS':
          if (nums.length >= 2) freqs = nums;
          activeSection = 'none';
          break;
        case 'HORIZONTAL':
          activeSection = 'horizontal';
          break;
        case 'VERTICAL':
          activeSection = 'vertical';
          break;
        case 'END':
          activeSection = 'none';
          break;
      }
      continue;
    }

    if (activeSection === 'horizontal' || activeSection === 'vertical') {
      const parts = line
        .split(/[\s,;]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (parts.length >= 2) {
        const angle = Math.abs(parts[0]);
        const vals = parts.slice(1);
        const target = activeSection === 'horizontal' ? horizMap : vertMap;
        if (!target.has(angle)) {
          target.set(angle, vals);
        }
      }
    }
  }

  if (freqs.length < 2) {
    throw new Error('Invalid .clf text: missing <FREQ> band list.');
  }
  if (horizMap.size === 0 && vertMap.size === 0) {
    throw new Error('Invalid .clf text: missing <HORIZONTAL> or <VERTICAL> polar data.');
  }

  const F = freqs.length;
  const frequenciesHz = Float32Array.from(freqs);

  // Build on-axis magnitude response from <SENSITIVITY> per-band array if present
  const onAxisMagDb = new Float32Array(F);
  const onAxisPhaseRad = new Float32Array(F);
  if (sensitivityByBand.length === F) {
    const peak = Math.max(...sensitivityByBand);
    sensitivity = peak;
    for (let k = 0; k < F; k++) {
      onAxisMagDb[k] = sensitivityByBand[k] - peak;
    }
  }

  // Interpolate H and V curves onto uniform 5-degree polar grid [0..180] (37 points)
  // and quadrant meridian grid [0..90] in 10-degree steps (10 planes)
  const P = 37;
  const M = 10;
  const polarAnglesDeg = new Float32Array(P);
  for (let p = 0; p < P; p++) polarAnglesDeg[p] = p * 5;
  const meridianAnglesDeg = new Float32Array(M);
  for (let m = 0; m < M; m++) meridianAnglesDeg[m] = m * 10;

  const sortedH = sortAngleTable(horizMap, F);
  const sortedV = vertMap.size > 0 ? sortAngleTable(vertMap, F) : sortedH;

  const attenuationDb = new Float32Array(F * M * P);

  for (let k = 0; k < F; k++) {
    for (let m = 0; m < M; m++) {
      const gamma = meridianAnglesDeg[m] * DEG_TO_RAD;
      const cos2 = Math.cos(gamma) ** 2;
      const sin2 = Math.sin(gamma) ** 2;

      for (let p = 0; p < P; p++) {
        const beta = polarAnglesDeg[p];
        const attH = sampleAngleCurve(sortedH, beta, k);
        const attV = sampleAngleCurve(sortedV, beta, k);
        attenuationDb[(k * M + m) * P + p] = cos2 * attH + sin2 * attV;
      }
    }
  }

  const balloon: DirectivityBalloon = {
    frequenciesHz,
    symmetry: 'quadrant',
    polarAnglesDeg,
    meridianAnglesDeg,
    onAxisMagDb,
    onAxisPhaseRad,
    attenuationDb,
  };

  // Estimate -6 dB nominal beamwidth at ~2 kHz
  const k2k = findClosestFreqIdx(frequenciesHz, 2000);
  const hNom = estimateMinus6DbBeamwidth(sortedH, k2k);
  const vNom = estimateMinus6DbBeamwidth(sortedV, k2k);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    id: `clf-${slug || 'speaker'}-${Date.now().toString(36)}`,
    name,
    manufacturer,
    category,
    origin: 'clf',
    description: 'Imported from CLF polar text table',
    dimensionsMeters:
      category === 'subwoofer'
        ? { width: 0.56, height: 0.64, depth: 0.66 }
        : { width: 0.36, height: 0.6, depth: 0.35 },
    acousticCenterOffset: { x: 0, y: 0, z: 0 },
    nominalDispersionDeg: { horizontal: hNom, vertical: vNom },
    passbandHz: { low3dB: freqs[0], high3dB: freqs[F - 1] },
    sensitivity1W1mDbSpl: sensitivity,
    maxContinuousSpl1mDb: maxSpl,
    balloon,
  };
}

function sortAngleTable(
  map: ReadonlyMap<number, number[]>,
  bandCount: number
): Array<{ angle: number; values: number[] }> {
  const arr = Array.from(map.entries())
    .map(([angle, values]) => {
      const padded = new Array<number>(bandCount).fill(0);
      for (let i = 0; i < bandCount; i++) {
        padded[i] = values[Math.min(values.length - 1, i)] ?? 0;
      }
      return { angle, values: padded };
    })
    .sort((a, b) => a.angle - b.angle);

  if (arr[0]?.angle !== 0) {
    arr.unshift({ angle: 0, values: new Array<number>(bandCount).fill(0) });
  }
  return arr;
}

function sampleAngleCurve(
  table: ReadonlyArray<{ angle: number; values: number[] }>,
  angleDeg: number,
  bandIdx: number
): number {
  if (table.length === 0) return 0;
  if (angleDeg <= table[0].angle) return table[0].values[bandIdx];
  const last = table[table.length - 1];
  if (angleDeg >= last.angle) return last.values[bandIdx];

  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (angleDeg >= a.angle && angleDeg <= b.angle) {
      const t = (angleDeg - a.angle) / Math.max(1e-6, b.angle - a.angle);
      return a.values[bandIdx] + (b.values[bandIdx] - a.values[bandIdx]) * t;
    }
  }
  return 0;
}

function findClosestFreqIdx(freqs: Float32Array, targetHz: number): number {
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < freqs.length; i++) {
    const d = Math.abs(freqs[i] - targetHz);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

function estimateMinus6DbBeamwidth(
  table: ReadonlyArray<{ angle: number; values: number[] }>,
  bandIdx: number
): number {
  const ref = table[0]?.values[bandIdx] ?? 0;
  for (let deg = 5; deg <= 90; deg += 2.5) {
    const v = sampleAngleCurve(table, deg, bandIdx) - ref;
    if (v <= -6.0) {
      return Math.round(deg * 2);
    }
  }
  return 90;
}

