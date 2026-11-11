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
 * 3D direct-field + planar image-source complex acoustic summation solver for 2D Plan
 * and Side Section receptor grids (`src/physics/summation-solver.ts`).
 */

import type { SpeakerDefinition } from '../library/speaker-schema.js';
import {
  evaluateSurfaceListenerZ,
  type AnalysisBandSelection,
  type AudienceSurface,
  type DspGroup,
  type ProjectScene,
  type SectionBounds2D,
  type ViewportBounds2D,
} from '../model/project-types.js';
import {
  ISO_THIRD_OCTAVE_BANDS_HZ,
  computeAirAbsorptionTable,
  computeFrequencyWeightingDb,
  computeSpeedOfSoundMpS,
} from './atmosphere.js';
import {
  DEFAULT_SOURCE_DSP_CONFIG,
  compileDspChain,
  evaluateCompiledDspAtFrequency,
  type CompiledDspChain,
} from './biquad.js';
import { sampleDirectivityBalloon, type DirectivityBalloon } from './directivity-balloon.js';
import { expandSubwooferArray } from './sub-array-designer.js';
import {
  buildOrientationMatrix,
  computeLocalDirection,
  localToWorldVec3,
  reflectPoseAcrossPlane,
  type Mat3,
  type PlanarReflector,
  type ReflectedPose,
  type Vec3,
} from './transform3d.js';

export interface ActiveRadiator {
  readonly id: string;
  readonly label: string;
  readonly dspGroupId: string;
  readonly speaker: SpeakerDefinition;
  readonly balloon: DirectivityBalloon;
  /** World acoustic center position in meters. */
  readonly position: Vec3;
  readonly basis: Mat3;
  /** Pre-mirrored poses across all active planar reflectors. */
  readonly imagePoses: ReadonlyArray<{
    readonly reflectorId: string;
    readonly reflectionFactor: number;
    readonly pose: ReflectedPose;
  }>;
  /** Reference 1-meter nominal drive SPL in dB (`maxContinuousSpl1mDb + scene.driveOffsetDb`). */
  readonly drive1mDbSpl: number;
  readonly dspChain: CompiledDspChain;
}

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

export interface PlanGridResult {
  readonly cols: number;
  readonly rows: number;
  readonly bounds: ViewportBounds2D;
  readonly stepM: number;
  /** Row-major `[row * cols + col]` SPL in dB (`row = 0` at `yMin`, `col = 0` at `xMin`). */
  readonly splDb: Float32Array;
  /** Row-major cell classification (`0` background, `1` audience, `2` stage). */
  readonly surfaceMask: Uint8Array;
  readonly stats: CoverageStatistics;
}

export interface SectionGridResult {
  readonly cols: number;
  readonly rows: number;
  readonly bounds: SectionBounds2D;
  readonly stepM: number;
  /** Row-major `[row * cols + col]` SPL in dB (`row = 0` at `zMin`, `col = 0` at `xMin`). */
  readonly splDb: Float32Array;
}

interface EvaluationBands {
  readonly frequenciesHz: Float32Array;
  /** Linear energy weights `10^((W_prog + W_IEC) / 10)` normalized so unweighted flat 0 dB sums sensibly. */
  readonly energyWeights: Float32Array;
  readonly airAbsorptionDbPerM: Float32Array;
  readonly wavenumbersRadPerM: Float32Array;
}

/**
 * Expands all non-muted point sources (including L/R mirrored twins) and subwoofer arrays
 * into ready-to-evaluate 3D radiators with precomputed orientation & image-source matrices.
 */
export function expandSceneRadiators(
  scene: ProjectScene,
  speakerMap: ReadonlyMap<string, SpeakerDefinition>
): ActiveRadiator[] {
  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  const groupMap = new Map<string, DspGroup>();
  for (const g of scene.dspGroups) {
    groupMap.set(g.id, g);
  }

  const activeReflectors: PlanarReflector[] = scene.reflectors.filter(
    (r) => r.enabled && r.reflectionFactor > 1e-4
  );

  const radiators: ActiveRadiator[] = [];

  const pushRadiator = (params: {
    id: string;
    label: string;
    speakerId: string;
    dspGroupId: string;
    rawPosition: Vec3;
    azimuthDeg: number;
    tiltDeg: number;
    rollDeg: number;
    trimGainDb: number;
    trimDelayMs: number;
    invertPolarity: boolean;
    muted: boolean;
  }): void => {
    if (params.muted) return;
    const speaker = speakerMap.get(params.speakerId);
    if (!speaker) return;

    const groupDsp = groupMap.get(params.dspGroupId)?.dsp ?? DEFAULT_SOURCE_DSP_CONFIG;
    const dspChain = compileDspChain(groupDsp, {
      gainDb: params.trimGainDb,
      delayMs: params.trimDelayMs,
      invertPolarity: params.invertPolarity,
      muted: params.muted,
    });
    if (dspChain.muted) return;

    const basis = buildOrientationMatrix({
      azimuthDeg: params.azimuthDeg,
      tiltDeg: params.tiltDeg,
      rollDeg: params.rollDeg,
    });
    const offsetWorld = localToWorldVec3(basis, speaker.acousticCenterOffset);
    const position: Vec3 = {
      x: params.rawPosition.x + offsetWorld.x,
      y: params.rawPosition.y + offsetWorld.y,
      z: params.rawPosition.z + offsetWorld.z,
    };

    const imagePoses = activeReflectors.map((ref) => ({
      reflectorId: ref.id,
      reflectionFactor: ref.reflectionFactor,
      pose: reflectPoseAcrossPlane(position, basis, ref),
    }));

    radiators.push({
      id: params.id,
      label: params.label,
      dspGroupId: params.dspGroupId,
      speaker,
      balloon: speaker.balloon,
      position,
      basis,
      imagePoses,
      drive1mDbSpl: speaker.maxContinuousSpl1mDb + scene.driveOffsetDb,
      dspChain,
    });
  };

  for (const ps of scene.pointSources) {
    pushRadiator({
      id: ps.id,
      label: ps.name,
      speakerId: ps.speakerId,
      dspGroupId: ps.dspGroupId,
      rawPosition: ps.position,
      azimuthDeg: ps.orientation.azimuthDeg,
      tiltDeg: ps.orientation.tiltDeg,
      rollDeg: ps.orientation.rollDeg,
      trimGainDb: ps.trimGainDb,
      trimDelayMs: ps.trimDelayMs,
      invertPolarity: ps.invertPolarity,
      muted: ps.muted,
    });

    if (ps.mirrorLeftRight && Math.abs(ps.position.y) > 1e-3) {
      pushRadiator({
        id: `${ps.id}:mirror`,
        label: `${ps.name} (R)`,
        speakerId: ps.speakerId,
        dspGroupId: ps.dspGroupId,
        rawPosition: { x: ps.position.x, y: -ps.position.y, z: ps.position.z },
        azimuthDeg: -ps.orientation.azimuthDeg,
        tiltDeg: ps.orientation.tiltDeg,
        rollDeg: -ps.orientation.rollDeg,
        trimGainDb: ps.trimGainDb,
        trimDelayMs: ps.trimDelayMs,
        invertPolarity: ps.invertPolarity,
        muted: ps.muted,
      });
    }
  }

  for (const sa of scene.subArrays) {
    const cabs = expandSubwooferArray(sa, c);
    for (const cab of cabs) {
      pushRadiator({
        id: cab.id,
        label: cab.label,
        speakerId: cab.speakerId,
        dspGroupId: cab.dspGroupId,
        rawPosition: cab.position,
        azimuthDeg: cab.orientation.azimuthDeg,
        tiltDeg: cab.orientation.tiltDeg,
        rollDeg: cab.orientation.rollDeg,
        trimGainDb: cab.trimGainDb,
        trimDelayMs: cab.trimDelayMs,
        invertPolarity: cab.invertPolarity,
        muted: cab.muted,
      });
    }
  }

  return radiators;
}

function buildEvaluationBands(
  selection: AnalysisBandSelection,
  scene: ProjectScene
): EvaluationBands {
  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  let freqs: number[];
  let weights: number[];

  if (selection.kind === 'single') {
    freqs = [selection.frequencyHz];
    weights = [1.0];
  } else {
    freqs = ISO_THIRD_OCTAVE_BANDS_HZ.filter(
      (f) => f >= selection.minHz * 0.98 && f <= selection.maxHz * 1.02
    );
    if (freqs.length === 0) {
      freqs = [1000];
    }
    // Normalize program energy across N bands so broadband total equals single-source broadband rating
    const bandNorm = 1 / freqs.length;
    weights = freqs.map((f) => {
      let progDb = 0;
      if (selection.spectrumShape === 'music') {
        if (f <= 100) progDb = 3.0;
        else if (f > 2000) progDb = -3.0 * Math.log2(f / 2000);
      }
      const iecDb = computeFrequencyWeightingDb(f, selection.weighting);
      return bandNorm * Math.pow(10, (progDb + iecDb) / 10);
    });
  }

  const frequenciesHz = Float32Array.from(freqs);
  const energyWeights = Float32Array.from(weights);
  const airAbsorptionDbPerM = computeAirAbsorptionTable(frequenciesHz, scene.atmosphere);
  const wavenumbersRadPerM = new Float32Array(frequenciesHz.length);
  for (let k = 0; k < frequenciesHz.length; k++) {
    wavenumbersRadPerM[k] = (2 * Math.PI * frequenciesHz[k]) / c;
  }

  return {
    frequenciesHz,
    energyWeights,
    airAbsorptionDbPerM,
    wavenumbersRadPerM,
  };
}

interface PrecomputedRadiatorFreqTable {
  readonly radiator: ActiveRadiator;
  /** Complex `P_drive_1m * H_DSP(f_k)` per evaluation frequency [2 * F]. */
  readonly driveDspReIm: Float64Array;
}

function precomputeRadiatorTables(
  radiators: readonly ActiveRadiator[],
  frequenciesHz: Float32Array
): PrecomputedRadiatorFreqTable[] {
  const F = frequenciesHz.length;
  return radiators.map((rad) => {
    const driveLin = Math.pow(10, rad.drive1mDbSpl / 20);
    const driveDspReIm = new Float64Array(F * 2);
    for (let k = 0; k < F; k++) {
      const h = evaluateCompiledDspAtFrequency(rad.dspChain, frequenciesHz[k]);
      driveDspReIm[k * 2] = h.re * driveLin;
      driveDspReIm[k * 2 + 1] = h.im * driveLin;
    }
    return { radiator: rad, driveDspReIm };
  });
}

/**
 * Evaluates weighted SPL (in dB) at a single 3D point `receptor` across precomputed bands.
 */
export function evaluatePointSplDb(
  receptor: Vec3,
  tables: readonly PrecomputedRadiatorFreqTable[],
  bands: EvaluationBands,
  sumScratchRe: Float64Array,
  sumScratchIm: Float64Array
): number {
  if (tables.length === 0) {
    return -120;
  }

  const F = bands.frequenciesHz.length;
  sumScratchRe.fill(0);
  sumScratchIm.fill(0);

  for (let rIdx = 0; rIdx < tables.length; rIdx++) {
    const entry = tables[rIdx];
    const rad = entry.radiator;
    const dspReIm = entry.driveDspReIm;

    // 1. Direct path
    const dir = computeLocalDirection(rad.position, rad.basis, receptor);
    const invDist = 1 / dir.distanceM;

    for (let k = 0; k < F; k++) {
      const freq = bands.frequenciesHz[k];
      const bSample = sampleDirectivityBalloon(rad.balloon, dir.polarDeg, dir.meridianDeg, freq);
      const airGain = Math.pow(10, (-bands.airAbsorptionDbPerM[k] * dir.distanceM) / 20);
      const pathScale = invDist * airGain;

      const kDist = -bands.wavenumbersRadPerM[k] * dir.distanceM;
      const propRe = Math.cos(kDist) * pathScale;
      const propIm = Math.sin(kDist) * pathScale;

      // D * prop
      const dRe = bSample.linearComplex.re;
      const dIm = bSample.linearComplex.im;
      const dpRe = dRe * propRe - dIm * propIm;
      const dpIm = dRe * propIm + dIm * propRe;

      // * (drive * H_DSP)
      const sRe = dspReIm[k * 2];
      const sIm = dspReIm[k * 2 + 1];
      sumScratchRe[k] += dpRe * sRe - dpIm * sIm;
      sumScratchIm[k] += dpRe * sIm + dpIm * sRe;
    }

    // 2. Planar image-source reflections (e.g. ground bounce)
    for (let m = 0; m < rad.imagePoses.length; m++) {
      const img = rad.imagePoses[m];
      const imgDir = computeLocalDirection(img.pose.position, img.pose.basis, receptor);
      const imgInvDist = img.reflectionFactor / imgDir.distanceM;

      for (let k = 0; k < F; k++) {
        const freq = bands.frequenciesHz[k];
        const bSample = sampleDirectivityBalloon(
          rad.balloon,
          imgDir.polarDeg,
          imgDir.meridianDeg,
          freq
        );
        const airGain = Math.pow(10, (-bands.airAbsorptionDbPerM[k] * imgDir.distanceM) / 20);
        const pathScale = imgInvDist * airGain;

        const kDist = -bands.wavenumbersRadPerM[k] * imgDir.distanceM;
        const propRe = Math.cos(kDist) * pathScale;
        const propIm = Math.sin(kDist) * pathScale;

        const dRe = bSample.linearComplex.re;
        const dIm = bSample.linearComplex.im;
        const dpRe = dRe * propRe - dIm * propIm;
        const dpIm = dRe * propIm + dIm * propRe;

        const sRe = dspReIm[k * 2];
        const sIm = dspReIm[k * 2 + 1];
        sumScratchRe[k] += dpRe * sRe - dpIm * sIm;
        sumScratchIm[k] += dpRe * sIm + dpIm * sRe;
      }
    }
  }

  let totalWeightedEnergy = 0;
  for (let k = 0; k < F; k++) {
    const magSq = sumScratchRe[k] * sumScratchRe[k] + sumScratchIm[k] * sumScratchIm[k];
    totalWeightedEnergy += magSq * bands.energyWeights[k];
  }

  if (totalWeightedEnergy <= 1e-18) {
    return -120;
  }
  return 10 * Math.log10(totalWeightedEnergy);
}

function resolvePlanPointSurface(
  surfaces: readonly AudienceSurface[],
  x: number,
  y: number,
  defaultZ: number
): { z: number; mask: number } {
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

/**
 * Evaluates the 2D Plan View (Top-down X-Y) SPL field across audience/stage surfaces.
 */
export function evaluatePlanGrid(
  scene: ProjectScene,
  speakerMap: ReadonlyMap<string, SpeakerDefinition>,
  stepM: number = 0.5
): PlanGridResult {
  const safeStep = Math.max(0.1, stepM);
  const { xMin, xMax, yMin, yMax } = scene.planBounds;
  const cols = Math.max(2, Math.floor((xMax - xMin) / safeStep) + 1);
  const rows = Math.max(2, Math.floor((yMax - yMin) / safeStep) + 1);

  const radiators = expandSceneRadiators(scene, speakerMap);
  const bands = buildEvaluationBands(scene.bandSelection, scene);
  const tables = precomputeRadiatorTables(radiators, bands.frequenciesHz);

  const splDb = new Float32Array(rows * cols);
  const surfaceMask = new Uint8Array(rows * cols);
  const scratchRe = new Float64Array(bands.frequenciesHz.length);
  const scratchIm = new Float64Array(bands.frequenciesHz.length);

  for (let r = 0; r < rows; r++) {
    const y = yMin + (r / (rows - 1)) * (yMax - yMin);
    for (let c = 0; c < cols; c++) {
      const x = xMin + (c / (cols - 1)) * (xMax - xMin);
      const { z, mask } = resolvePlanPointSurface(
        scene.surfaces,
        x,
        y,
        scene.defaultListenerHeightM
      );
      const idx = r * cols + c;
      surfaceMask[idx] = mask;
      splDb[idx] = evaluatePointSplDb({ x, y, z }, tables, bands, scratchRe, scratchIm);
    }
  }

  return {
    cols,
    rows,
    bounds: scene.planBounds,
    stepM: safeStep,
    splDb,
    surfaceMask,
    stats: computeCoverageStatistics(splDb, surfaceMask),
  };
}

/**
 * Evaluates the 2D Side Section View (X-Z vertical cut at `scene.sectionBounds.sliceYM`).
 */
export function evaluateSectionGrid(
  scene: ProjectScene,
  speakerMap: ReadonlyMap<string, SpeakerDefinition>,
  stepM: number = 0.5
): SectionGridResult {
  const safeStep = Math.max(0.1, stepM);
  const { xMin, xMax, zMin, zMax, sliceYM } = scene.sectionBounds;
  const cols = Math.max(2, Math.floor((xMax - xMin) / safeStep) + 1);
  const rows = Math.max(2, Math.floor((zMax - zMin) / safeStep) + 1);

  const radiators = expandSceneRadiators(scene, speakerMap);
  const bands = buildEvaluationBands(scene.bandSelection, scene);
  const tables = precomputeRadiatorTables(radiators, bands.frequenciesHz);

  const splDb = new Float32Array(rows * cols);
  const scratchRe = new Float64Array(bands.frequenciesHz.length);
  const scratchIm = new Float64Array(bands.frequenciesHz.length);

  for (let r = 0; r < rows; r++) {
    const z = zMin + (r / (rows - 1)) * (zMax - zMin);
    for (let c = 0; c < cols; c++) {
      const x = xMin + (c / (cols - 1)) * (xMax - xMin);
      splDb[r * cols + c] = evaluatePointSplDb(
        { x, y: sliceYM, z },
        tables,
        bands,
        scratchRe,
        scratchIm
      );
    }
  }

  return {
    cols,
    rows,
    bounds: scene.sectionBounds,
    stepM: safeStep,
    splDb,
  };
}
