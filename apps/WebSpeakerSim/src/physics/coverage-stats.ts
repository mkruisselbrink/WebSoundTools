// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Audience/stage surface Z-elevation lookup and SPL coverage homogeneity / rejection statistics.
 */

import { evaluateSurfaceListenerZ, type AudienceSurface } from '../model/project-types.js';

export interface CoverageStatistics {
  readonly audienceSampleCount: number;
  readonly meanAudienceSplDb: number;
  readonly minAudienceSplDb: number;
  readonly maxAudienceSplDb: number;
  readonly stdDevAudienceDb: number;
  /** Percentage of audience receptor cells within +/- 3 dB of `meanAudienceSplDb`. */
  readonly homogeneityPlusMinus3DbPercent: number;
  readonly stageSampleCount: number;
  readonly meanStageSplDb: number | null;
  /** `meanAudienceSplDb - meanStageSplDb` in dB when a stage surface is present. */
  readonly audienceToStageRejectionDb: number | null;
}

/** Surface classification per grid cell: 0 = background floor, 1 = audience zone, 2 = stage zone. */
export const CELL_MASK_BACKGROUND = 0;
export const CELL_MASK_AUDIENCE = 1;
export const CELL_MASK_STAGE = 2;

export function resolvePlanPointSurface(
  surfaces: readonly AudienceSurface[],
  x: number,
  y: number,
  defaultZ: number
): { readonly z: number; readonly mask: number } {
  let chosenZ = defaultZ;
  let chosenMask = CELL_MASK_BACKGROUND;
  let highestAudienceZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < surfaces.length; i++) {
    const surf = surfaces[i];
    const z = evaluateSurfaceListenerZ(surf, x, y);
    if (z === null) continue;

    if (surf.role === 'audience') {
      if (z >= highestAudienceZ) {
        highestAudienceZ = z;
        chosenZ = z;
        chosenMask = CELL_MASK_AUDIENCE;
      }
    } else if (chosenMask === CELL_MASK_BACKGROUND) {
      chosenZ = z;
      chosenMask = CELL_MASK_STAGE;
    }
  }

  return { z: chosenZ, mask: chosenMask };
}

export function computeCoverageStatistics(
  splDb: Float32Array,
  surfaceMask: Uint8Array
): CoverageStatistics {
  let audCount = 0;
  let audSum = 0;
  let audMin = Number.POSITIVE_INFINITY;
  let audMax = Number.NEGATIVE_INFINITY;

  let stgCount = 0;
  let stgSum = 0;

  for (let i = 0; i < splDb.length; i++) {
    const val = splDb[i];
    if (val <= -115) continue;
    const mask = surfaceMask[i];
    if (mask === CELL_MASK_AUDIENCE) {
      audCount++;
      audSum += val;
      if (val < audMin) audMin = val;
      if (val > audMax) audMax = val;
    } else if (mask === CELL_MASK_STAGE) {
      stgCount++;
      stgSum += val;
    }
  }

  if (audCount === 0) {
    return {
      audienceSampleCount: 0,
      meanAudienceSplDb: 0,
      minAudienceSplDb: 0,
      maxAudienceSplDb: 0,
      stdDevAudienceDb: 0,
      homogeneityPlusMinus3DbPercent: 0,
      stageSampleCount: stgCount,
      meanStageSplDb: stgCount > 0 ? stgSum / stgCount : null,
      audienceToStageRejectionDb: null,
    };
  }

  const meanAud = audSum / audCount;
  let sqDiffSum = 0;
  let within3Db = 0;

  for (let i = 0; i < splDb.length; i++) {
    if (surfaceMask[i] !== CELL_MASK_AUDIENCE || splDb[i] <= -115) continue;
    const diff = splDb[i] - meanAud;
    sqDiffSum += diff * diff;
    if (Math.abs(diff) <= 3.0) {
      within3Db++;
    }
  }

  const meanStage = stgCount > 0 ? stgSum / stgCount : null;

  return {
    audienceSampleCount: audCount,
    meanAudienceSplDb: meanAud,
    minAudienceSplDb: audMin,
    maxAudienceSplDb: audMax,
    stdDevAudienceDb: Math.sqrt(sqDiffSum / audCount),
    homogeneityPlusMinus3DbPercent: (within3Db / audCount) * 100,
    stageSampleCount: stgCount,
    meanStageSplDb: meanStage,
    audienceToStageRejectionDb: meanStage !== null ? meanAud - meanStage : null,
  };
}
