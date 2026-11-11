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
 * Unified loudspeaker file import dispatcher (`src/library/importers/index.ts`).
 */

import type { SpeakerDefinition } from '../speaker-schema.js';
import { parseClfText } from './clf-importer.js';
import {
  buildSpeakerFromFrdText,
  deserializeSpeakerFromJson,
  parseFrdCurveText,
  serializeSpeakerToJson,
  type FrdImportOptions,
} from './frd-importer.js';
import { GLL_MAGIC, inflateZlibBlock, parseGllBuffer } from './gll-importer.js';

export {
  GLL_MAGIC,
  inflateZlibBlock,
  parseGllBuffer,
  parseClfText,
  parseFrdCurveText,
  buildSpeakerFromFrdText,
  serializeSpeakerToJson,
  deserializeSpeakerFromJson,
  type FrdImportOptions,
};

/**
 * Dispatches a loudspeaker file (`ArrayBuffer`) by extension or header magic into
 * one or more `SpeakerDefinition` models.
 */
export async function importSpeakerArrayBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  frdOptions?: Partial<FrdImportOptions>
): Promise<SpeakerDefinition[]> {
  const lower = fileName.toLowerCase();
  const bytes = new Uint8Array(buffer);

  // Detect binary EGLL magic regardless of case/extension
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x45 && // 'E'
    bytes[1] === 0x47 && // 'G'
    bytes[2] === 0x4c && // 'L'
    bytes[3] === 0x4c // 'L'
  ) {
    return parseGllBuffer(buffer, fileName);
  }

  if (lower.endsWith('.gll')) {
    return parseGllBuffer(buffer, fileName);
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  if (lower.endsWith('.json')) {
    return [deserializeSpeakerFromJson(text, false)];
  }

  if (lower.endsWith('.clf') || lower.endsWith('.tab') || /<(FREQ|HORIZONTAL|CABINET)>/i.test(text)) {
    return [parseClfText(text, fileName)];
  }

  const cleanName = fileName.replace(/\.(frd|csv|txt)$/i, '').trim() || 'Imported FRD Speaker';
  return [
    buildSpeakerFromFrdText(text, {
      name: frdOptions?.name ?? cleanName,
      manufacturer: frdOptions?.manufacturer,
      category: frdOptions?.category,
      horizontalDispersionDeg: frdOptions?.horizontalDispersionDeg,
      verticalDispersionDeg: frdOptions?.verticalDispersionDeg,
      maxContinuousSpl1mDb: frdOptions?.maxContinuousSpl1mDb,
    }),
  ];
}
