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
 * Built-in parametric PA loudspeaker library (`src/library/builtin-speakers.ts`).
 */

import type { SpeakerDefinition } from './speaker-schema.js';
import { buildSpeakerFromSpec } from './spec-builder.js';

export const BUILTIN_SPEAKER_SPECS = [
  {
    id: 'builtin-top-8-90x70',
    name: 'Compact 8" 2-Way Active Top (90°×70°)',
    manufacturer: 'Built-in Library',
    category: 'point-source' as const,
    origin: 'builtin' as const,
    description: 'Compact 8-inch + 1-inch front-fill / distributed delay enclosure.',
    horizontalDispersionDeg: 90,
    verticalDispersionDeg: 70,
    low3dBHz: 65,
    high3dBHz: 20000,
    maxContinuousSpl1mDb: 125,
    sensitivity1W1mDbSpl: 95,
    dimensionsMeters: { width: 0.25, height: 0.43, depth: 0.25 },
    hornControlHz: 1400,
  },
  {
    id: 'builtin-top-10-90x60',
    name: 'Standard 10" 2-Way Active Top (90°×60°)',
    manufacturer: 'Built-in Library',
    category: 'point-source' as const,
    origin: 'builtin' as const,
    description: 'Versatile 10-inch + 1.4-inch active loudspeaker for small clubs and fills.',
    horizontalDispersionDeg: 90,
    verticalDispersionDeg: 60,
    low3dBHz: 58,
    high3dBHz: 20000,
    maxContinuousSpl1mDb: 128,
    sensitivity1W1mDbSpl: 97,
    dimensionsMeters: { width: 0.31, height: 0.53, depth: 0.31 },
    hornControlHz: 1150,
  },
  {
    id: 'builtin-top-12-90x60',
    name: 'High-Output 12" 2-Way Active Top (90°×60°)',
    manufacturer: 'Built-in Library',
    category: 'point-source' as const,
    origin: 'builtin' as const,
    description: '12-inch + 1.4-inch constant-directivity horn main PA enclosure.',
    horizontalDispersionDeg: 90,
    verticalDispersionDeg: 60,
    low3dBHz: 50,
    high3dBHz: 20000,
    maxContinuousSpl1mDb: 132,
    sensitivity1W1mDbSpl: 99,
    dimensionsMeters: { width: 0.37, height: 0.62, depth: 0.36 },
    hornControlHz: 950,
  },
  {
    id: 'builtin-top-15-60x40',
    name: 'Long-Throw 15" 2-Way Active Top (60°×40°)',
    manufacturer: 'Built-in Library',
    category: 'point-source' as const,
    origin: 'builtin' as const,
    description: 'Narrow-dispersion 15-inch + 3-inch voice-coil compression driver long-throw top.',
    horizontalDispersionDeg: 60,
    verticalDispersionDeg: 40,
    low3dBHz: 45,
    high3dBHz: 20000,
    maxContinuousSpl1mDb: 135,
    sensitivity1W1mDbSpl: 100,
    dimensionsMeters: { width: 0.44, height: 0.71, depth: 0.43 },
    hornControlHz: 800,
  },
  {
    id: 'builtin-sub-15-reflex',
    name: 'Compact 15" Bass-Reflex Subwoofer',
    manufacturer: 'Built-in Library',
    category: 'subwoofer' as const,
    origin: 'builtin' as const,
    description: 'Portable 15-inch direct-radiating active subwoofer.',
    low3dBHz: 40,
    high3dBHz: 120,
    maxContinuousSpl1mDb: 130,
    sensitivity1W1mDbSpl: 96,
    dimensionsMeters: { width: 0.46, height: 0.56, depth: 0.58 },
  },
  {
    id: 'builtin-sub-18-reflex',
    name: 'Touring 18" Bass-Reflex Subwoofer',
    manufacturer: 'Built-in Library',
    category: 'subwoofer' as const,
    origin: 'builtin' as const,
    description: 'High-excursion 18-inch bass-reflex subwoofer for live music and arrays.',
    low3dBHz: 34,
    high3dBHz: 115,
    maxContinuousSpl1mDb: 135,
    sensitivity1W1mDbSpl: 98,
    dimensionsMeters: { width: 0.56, height: 0.69, depth: 0.7 },
  },
  {
    id: 'builtin-sub-218-reflex',
    name: 'High-SPL Dual-18" Bass-Reflex Subwoofer',
    manufacturer: 'Built-in Library',
    category: 'subwoofer' as const,
    origin: 'builtin' as const,
    description: 'Touring dual-18-inch ground-stack subwoofer for outdoor stages and arenas.',
    low3dBHz: 30,
    high3dBHz: 105,
    maxContinuousSpl1mDb: 141,
    sensitivity1W1mDbSpl: 101,
    dimensionsMeters: { width: 1.18, height: 0.58, depth: 0.78 },
  },
] as const;

let cachedBuiltinSpeakers: Map<string, SpeakerDefinition> | null = null;

export function getBuiltinSpeakerMap(): ReadonlyMap<string, SpeakerDefinition> {
  if (!cachedBuiltinSpeakers) {
    cachedBuiltinSpeakers = new Map();
    for (const spec of BUILTIN_SPEAKER_SPECS) {
      cachedBuiltinSpeakers.set(spec.id, buildSpeakerFromSpec(spec));
    }
  }
  return cachedBuiltinSpeakers;
}

export function getBuiltinSpeakers(): SpeakerDefinition[] {
  return Array.from(getBuiltinSpeakerMap().values());
}

export function getBuiltinSpeakerById(id: string): SpeakerDefinition | undefined {
  return getBuiltinSpeakerMap().get(id);
}

