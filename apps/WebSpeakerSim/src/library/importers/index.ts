// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

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

