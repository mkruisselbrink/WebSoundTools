// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Loudspeaker data structures (`src/library/speaker-schema.ts`).
 */

import type { SourceDspConfig } from '@foh/dsp';
import type { DirectivityBalloon } from '../physics/directivity-balloon.js';
import type { Vec3 } from '../physics/transform3d.js';

export type SpeakerCategory = 'point-source' | 'subwoofer';

export type SpeakerOriginKind = 'builtin' | 'spec-builder' | 'gll' | 'clf' | 'frd' | 'json';

export interface CabinetDimensionsMeters {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface NominalDispersionDeg {
  readonly horizontal: number;
  readonly vertical: number;
  readonly asymmetricVertical?: {
    readonly upDeg: number;
    readonly downDeg: number;
  };
}

export interface SpeakerPassbandHz {
  readonly low3dB: number;
  readonly high3dB: number;
}

export interface SpeakerPresetEntry {
  readonly id: string;
  readonly label: string;
  readonly dsp: Partial<SourceDspConfig>;
}

export interface SpeakerDefinition {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly category: SpeakerCategory;
  readonly origin: SpeakerOriginKind;
  readonly description?: string;
  readonly dimensionsMeters: CabinetDimensionsMeters;
  readonly acousticCenterOffset: Vec3;
  readonly nominalDispersionDeg: NominalDispersionDeg;
  readonly passbandHz: SpeakerPassbandHz;
  /** Free-field (or half-space normalized to 1 m) sensitivity at 1 W / 2.83 V in dB SPL. */
  readonly sensitivity1W1mDbSpl: number;
  /** Maximum continuous broadband output level at 1 m in dB SPL (used as nominal reference drive ceiling). */
  readonly maxContinuousSpl1mDb: number;
  readonly presets?: readonly SpeakerPresetEntry[];
  readonly balloon: DirectivityBalloon;
}

