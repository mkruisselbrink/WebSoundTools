// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `.frd` / `.csv` frequency & polar response importer + `.wss-speaker.json` serializer
 * (`src/library/importers/frd-importer.ts`).
 */

import {
  FrdCurve,
  interpolateFrdCurveLogFreq,
  parseFrdCurveText,
} from '@foh/acoustics';
import { synthesizeParametricBalloon, type DirectivityBalloon } from '../../physics/directivity-balloon.js';
import type { SpeakerCategory, SpeakerDefinition } from '../speaker-schema.js';

export { type FrdCurve, parseFrdCurveText };

export interface FrdImportOptions {
  readonly name: string;
  readonly manufacturer?: string;
  readonly category?: SpeakerCategory;
  readonly horizontalDispersionDeg?: number;
  readonly verticalDispersionDeg?: number;
  readonly maxContinuousSpl1mDb?: number;
}

/**
 * Builds a `SpeakerDefinition` combining a measured `.frd` on-axis Magnitude + Phase curve
 * with a calibrated 3D constant-directivity / piston off-axis balloon.
 */
export function buildSpeakerFromFrdText(
  frdText: string,
  options: FrdImportOptions
): SpeakerDefinition {
  const curve = parseFrdCurveText(frdText);
  const category = options.category ?? 'point-source';
  const hDeg = category === 'subwoofer' ? 360 : (options.horizontalDispersionDeg ?? 90);
  const vDeg = category === 'subwoofer' ? 360 : (options.verticalDispersionDeg ?? 60);

  const baseBalloon = synthesizeParametricBalloon({
    category,
    horizontalDispersionDeg: hDeg,
    verticalDispersionDeg: vDeg,
    cabinetWidthM: category === 'subwoofer' ? 0.56 : 0.36,
    cabinetHeightM: category === 'subwoofer' ? 0.62 : 0.6,
    lowCutHz: curve.frequenciesHz[0],
    highCutHz: curve.frequenciesHz[curve.frequenciesHz.length - 1],
  });

  // Replace synthetic on-axis curve with actual measured .frd response (normalized to passband max = 0 dB)
  const F = baseBalloon.frequenciesHz.length;
  const onAxisMagDb = new Float32Array(F);
  const onAxisPhaseRad = new Float32Array(F);
  let maxDb = Number.NEGATIVE_INFINITY;

  for (let k = 0; k < F; k++) {
    const pt = interpolateFrdCurveLogFreq(curve, baseBalloon.frequenciesHz[k]);
    onAxisMagDb[k] = pt.magDb;
    onAxisPhaseRad[k] = pt.phaseRad;
    if (pt.magDb > maxDb) maxDb = pt.magDb;
  }
  for (let k = 0; k < F; k++) {
    onAxisMagDb[k] -= maxDb;
  }

  const balloon: DirectivityBalloon = {
    ...baseBalloon,
    onAxisMagDb,
    onAxisPhaseRad,
  };

  const slug = options.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    id: `frd-${slug || 'speaker'}-${Date.now().toString(36)}`,
    name: options.name,
    manufacturer: options.manufacturer ?? 'Imported FRD',
    category,
    origin: 'frd',
    description: 'Imported measured .frd magnitude & phase response',
    dimensionsMeters:
      category === 'subwoofer'
        ? { width: 0.56, height: 0.62, depth: 0.66 }
        : { width: 0.36, height: 0.6, depth: 0.35 },
    acousticCenterOffset: { x: 0, y: 0, z: 0 },
    nominalDispersionDeg: { horizontal: hDeg, vertical: vDeg },
    passbandHz: {
      low3dB: curve.frequenciesHz[0],
      high3dB: curve.frequenciesHz[curve.frequenciesHz.length - 1],
    },
    sensitivity1W1mDbSpl: Number.isFinite(maxDb) && maxDb > 60 && maxDb < 120 ? maxDb : 98,
    maxContinuousSpl1mDb: options.maxContinuousSpl1mDb ?? (category === 'subwoofer' ? 134 : 130),
    balloon,
  };
}

/** Lossless JSON serialization for custom/imported `SpeakerDefinition` objects. */
export function serializeSpeakerToJson(speaker: SpeakerDefinition): string {
  return JSON.stringify(
    {
      format: 'wss-speaker-v1',
      ...speaker,
      balloon: {
        frequenciesHz: Array.from(speaker.balloon.frequenciesHz),
        symmetry: speaker.balloon.symmetry,
        polarAnglesDeg: Array.from(speaker.balloon.polarAnglesDeg),
        meridianAnglesDeg: Array.from(speaker.balloon.meridianAnglesDeg),
        onAxisMagDb: Array.from(speaker.balloon.onAxisMagDb),
        onAxisPhaseRad: Array.from(speaker.balloon.onAxisPhaseRad),
        attenuationDb: Array.from(speaker.balloon.attenuationDb),
        offAxisPhaseRad: speaker.balloon.offAxisPhaseRad
          ? Array.from(speaker.balloon.offAxisPhaseRad)
          : undefined,
      },
    },
    null,
    2
  );
}

export function deserializeSpeakerFromJson(
  jsonText: string,
  preserveOrigin: boolean = false
): SpeakerDefinition {
  const raw = JSON.parse(jsonText) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.balloon) {
    throw new Error('Invalid .json speaker definition.');
  }
  const b = raw.balloon as Record<string, unknown>;
  const balloon: DirectivityBalloon = {
    frequenciesHz: Float32Array.from(b.frequenciesHz as number[]),
    symmetry: (b.symmetry as DirectivityBalloon['symmetry']) ?? 'quadrant',
    polarAnglesDeg: Float32Array.from(b.polarAnglesDeg as number[]),
    meridianAnglesDeg: Float32Array.from(b.meridianAnglesDeg as number[]),
    onAxisMagDb: Float32Array.from(b.onAxisMagDb as number[]),
    onAxisPhaseRad: Float32Array.from(b.onAxisPhaseRad as number[]),
    attenuationDb: Float32Array.from(b.attenuationDb as number[]),
    offAxisPhaseRad: Array.isArray(b.offAxisPhaseRad)
      ? Float32Array.from(b.offAxisPhaseRad as number[])
      : undefined,
  };

  const validOrigins = new Set(['builtin', 'spec-builder', 'gll', 'clf', 'frd', 'json']);
  const origin =
    preserveOrigin && typeof raw.origin === 'string' && validOrigins.has(raw.origin)
      ? (raw.origin as SpeakerDefinition['origin'])
      : 'json';

  return {
    id: typeof raw.id === 'string' ? raw.id : `json-spk-${Date.now().toString(36)}`,
    name: raw.name,
    manufacturer: typeof raw.manufacturer === 'string' ? raw.manufacturer : 'Custom JSON',
    category: raw.category === 'subwoofer' ? 'subwoofer' : 'point-source',
    origin,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    dimensionsMeters: (raw.dimensionsMeters as SpeakerDefinition['dimensionsMeters']) ?? {
      width: 0.36,
      height: 0.6,
      depth: 0.35,
    },
    acousticCenterOffset: (raw.acousticCenterOffset as SpeakerDefinition['acousticCenterOffset']) ?? {
      x: 0,
      y: 0,
      z: 0,
    },
    nominalDispersionDeg:
      (raw.nominalDispersionDeg as SpeakerDefinition['nominalDispersionDeg']) ?? {
        horizontal: 90,
        vertical: 60,
      },
    passbandHz: (raw.passbandHz as SpeakerDefinition['passbandHz']) ?? {
      low3dB: 50,
      high3dB: 20000,
    },
    sensitivity1W1mDbSpl:
      typeof raw.sensitivity1W1mDbSpl === 'number' ? raw.sensitivity1W1mDbSpl : 98,
    maxContinuousSpl1mDb:
      typeof raw.maxContinuousSpl1mDb === 'number' ? raw.maxContinuousSpl1mDb : 130,
    balloon,
  };
}
