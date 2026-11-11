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
 * Datasheet Spec Builder (`src/library/spec-builder.ts`) — synthesizes a complete
 * `SpeakerDefinition` with 3D `DirectivityBalloon` from published loudspeaker specifications.
 */

import { synthesizeParametricBalloon } from '../physics/directivity-balloon.js';
import type {
  CabinetDimensionsMeters,
  SpeakerCategory,
  SpeakerDefinition,
  SpeakerOriginKind,
  SpeakerPresetEntry,
} from './speaker-schema.js';

export interface DatasheetSpecInput {
  readonly id?: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly category: SpeakerCategory;
  readonly origin?: SpeakerOriginKind;
  readonly description?: string;
  readonly horizontalDispersionDeg?: number;
  readonly verticalDispersionDeg?: number;
  readonly asymmetricVerticalDeg?: { readonly upDeg: number; readonly downDeg: number };
  readonly low3dBHz: number;
  readonly high3dBHz: number;
  readonly maxContinuousSpl1mDb: number;
  readonly sensitivity1W1mDbSpl?: number;
  readonly lfPattern?: 'omni' | 'cardioid';
  readonly dimensionsMeters?: CabinetDimensionsMeters;
  readonly hornControlHz?: number;
  readonly presets?: readonly SpeakerPresetEntry[];
}

function slugifyId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `spk-${base || 'custom'}`;
}

export function buildSpeakerFromSpec(spec: DatasheetSpecInput): SpeakerDefinition {
  const isSub = spec.category === 'subwoofer';
  const defaultDims: CabinetDimensionsMeters = isSub
    ? { width: 0.58, height: 0.62, depth: 0.68 }
    : { width: 0.36, height: 0.6, depth: 0.35 };
  const dims = spec.dimensionsMeters ?? defaultDims;

  const hDeg = isSub ? 360 : Math.max(15, Math.min(180, spec.horizontalDispersionDeg ?? 90));
  const vDeg = isSub ? 360 : Math.max(10, Math.min(180, spec.verticalDispersionDeg ?? 60));

  const low3dB = Math.max(18, Math.min(500, spec.low3dBHz));
  const high3dB = Math.max(low3dB + 30, Math.min(24000, spec.high3dBHz));

  const balloon = synthesizeParametricBalloon({
    category: spec.category,
    horizontalDispersionDeg: hDeg,
    verticalDispersionDeg: vDeg,
    asymmetricVerticalDeg: spec.asymmetricVerticalDeg,
    cabinetWidthM: dims.width,
    cabinetHeightM: dims.height,
    lowCutHz: low3dB,
    highCutHz: high3dB,
    lfPattern: spec.lfPattern ?? 'omni',
    hornControlHz: spec.hornControlHz,
  });

  return {
    id: spec.id ?? slugifyId(spec.name),
    name: spec.name.trim() || 'Custom Loudspeaker',
    manufacturer: spec.manufacturer?.trim() || 'Generic',
    category: spec.category,
    origin: spec.origin ?? 'spec-builder',
    description: spec.description,
    dimensionsMeters: dims,
    acousticCenterOffset: { x: 0, y: 0, z: 0 },
    nominalDispersionDeg: {
      horizontal: hDeg,
      vertical: vDeg,
      asymmetricVertical: spec.asymmetricVerticalDeg,
    },
    passbandHz: { low3dB, high3dB },
    sensitivity1W1mDbSpl: spec.sensitivity1W1mDbSpl ?? (isSub ? 97 : 98),
    maxContinuousSpl1mDb: spec.maxContinuousSpl1mDb,
    presets: spec.presets,
    balloon,
  };
}
