// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * 3D direct-field + planar image-source complex acoustic summation solver for 2D Plan
 * and Side Section receptor grids.
 */

import {
  ISO_THIRD_OCTAVE_BANDS_HZ,
  computeAirAbsorptionTable,
  computeFrequencyWeightingDb,
  computeSpeedOfSoundMpS,
} from '@foh/acoustics';
import { evaluateCompiledDspAtFrequency } from '@foh/dsp';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type {
  AnalysisBandSelection,
  ProjectScene,
  SectionBounds2D,
  ViewportBounds2D,
} from '../model/project-types.js';
import {
  CELL_MASK_AUDIENCE,
  CELL_MASK_BACKGROUND,
  CELL_MASK_STAGE,
  computeCoverageStatistics,
  resolvePlanPointSurface,
  type CoverageStatistics,
} from './coverage-stats.js';
import { sampleDirectivityBalloon } from './directivity-balloon.js';
import { expandSceneRadiators, type ActiveRadiator } from './radiator-expander.js';
import { computeLocalDirection, type Vec3 } from './transform3d.js';

export {
  CELL_MASK_AUDIENCE,
  CELL_MASK_BACKGROUND,
  CELL_MASK_STAGE,
  computeCoverageStatistics,
  expandSceneRadiators,
  type ActiveRadiator,
  type CoverageStatistics,
};

const LN10_OVER_20 = Math.LN10 / 20;

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
  readonly energyWeights: Float32Array;
  readonly airAbsorptionDbPerM: Float32Array;
  readonly wavenumbersRadPerM: Float32Array;
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
  readonly onAxisDriveReIm: Float64Array;
  readonly offAxisLinGain: Float32Array;
  readonly hasOffAxisPhase: boolean;
}

function precomputeRadiatorTables(
  radiators: readonly ActiveRadiator[],
  frequenciesHz: Float32Array
): PrecomputedRadiatorFreqTable[] {
  const fCount = frequenciesHz.length;

  return radiators.map((rad) => {
    const balloon = rad.balloon;
    const mCount = balloon.meridianAnglesDeg.length;
    const pCount = balloon.polarAnglesDeg.length;
    const sliceSize = mCount * pCount;
    const driveLin = Math.exp(rad.drive1mDbSpl * LN10_OVER_20);

    const onAxisDriveReIm = new Float64Array(fCount * 2);
    const offAxisLinGain = new Float32Array(fCount * sliceSize);

    for (let k = 0; k < fCount; k++) {
      const freq = frequenciesHz[k];
      const hDsp = evaluateCompiledDspAtFrequency(rad.dspChain, freq);
      const onAxis = sampleDirectivityBalloon(balloon, 0, 0, freq);

      onAxisDriveReIm[k * 2] =
        (hDsp.re * onAxis.linearComplex.re - hDsp.im * onAxis.linearComplex.im) * driveLin;
      onAxisDriveReIm[k * 2 + 1] =
        (hDsp.re * onAxis.linearComplex.im + hDsp.im * onAxis.linearComplex.re) * driveLin;

      const bFreqs = balloon.frequenciesHz;
      const bN = bFreqs.length;
      let f0 = 0;
      let f1 = 0;
      let tf = 0;
      if (bN > 1 && freq > bFreqs[0]) {
        if (freq >= bFreqs[bN - 1]) {
          f0 = bN - 1;
          f1 = bN - 1;
        } else {
          let lo = 0;
          let hi = bN - 1;
          while (hi - lo > 1) {
            const mid = (lo + hi) >>> 1;
            if (bFreqs[mid] <= freq) lo = mid;
            else hi = mid;
          }
          f0 = lo;
          f1 = hi;
          const span = Math.log(bFreqs[hi] / bFreqs[lo]);
          tf = span > 1e-9 ? Math.log(freq / bFreqs[lo]) / span : 0;
        }
      }

      const base0 = f0 * sliceSize;
      const base1 = f1 * sliceSize;
      const dstBase = k * sliceSize;
      const att = balloon.attenuationDb;

      for (let idx = 0; idx < sliceSize; idx++) {
        const a0 = att[base0 + idx];
        const attDb = f0 === f1 ? a0 : a0 + (att[base1 + idx] - a0) * tf;
        offAxisLinGain[dstBase + idx] = Math.exp(attDb * LN10_OVER_20);
      }
    }

    return {
      radiator: rad,
      onAxisDriveReIm,
      offAxisLinGain,
      hasOffAxisPhase: Boolean(balloon.offAxisPhaseRad),
    };
  });
}

function findGridInterp(
  grid: Float32Array,
  val: number
): { i0: number; i1: number; t: number } {
  const n = grid.length;
  if (n <= 1 || val <= grid[0]) return { i0: 0, i1: 0, t: 0 };
  if (val >= grid[n - 1]) return { i0: n - 1, i1: n - 1, t: 0 };

  const step = (grid[n - 1] - grid[0]) / (n - 1);
  if (step > 1e-6) {
    const pos = (val - grid[0]) / step;
    const idx = Math.min(n - 2, Math.max(0, Math.floor(pos)));
    if (grid[idx] <= val && val <= grid[idx + 1]) {
      const span = grid[idx + 1] - grid[idx];
      return { i0: idx, i1: idx + 1, t: span > 1e-9 ? (val - grid[idx]) / span : 0 };
    }
  }

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (grid[mid] <= val) lo = mid;
    else hi = mid;
  }
  const span = grid[hi] - grid[lo];
  return { i0: lo, i1: hi, t: span > 1e-9 ? (val - grid[lo]) / span : 0 };
}

function accumulateRayContribution(
  entry: PrecomputedRadiatorFreqTable,
  distanceM: number,
  polarDeg: number,
  meridianDeg: number,
  reflectionScale: number,
  bands: EvaluationBands,
  sumScratchRe: Float64Array,
  sumScratchIm: Float64Array
): void {
  const rad = entry.radiator;
  const balloon = rad.balloon;
  const fCount = bands.frequenciesHz.length;
  const invDist = reflectionScale / distanceM;

  if (entry.hasOffAxisPhase) {
    const driveLin = Math.exp(rad.drive1mDbSpl * LN10_OVER_20);
    for (let k = 0; k < fCount; k++) {
      const freq = bands.frequenciesHz[k];
      const bSample = sampleDirectivityBalloon(balloon, polarDeg, meridianDeg, freq);
      const hDsp = evaluateCompiledDspAtFrequency(rad.dspChain, freq);
      const airGain = Math.exp(-bands.airAbsorptionDbPerM[k] * distanceM * LN10_OVER_20);
      const pathScale = invDist * airGain * driveLin;

      const kDist = -bands.wavenumbersRadPerM[k] * distanceM;
      const propRe = Math.cos(kDist) * pathScale;
      const propIm = Math.sin(kDist) * pathScale;

      const dhRe = bSample.linearComplex.re * hDsp.re - bSample.linearComplex.im * hDsp.im;
      const dhIm = bSample.linearComplex.re * hDsp.im + bSample.linearComplex.im * hDsp.re;
      sumScratchRe[k] += dhRe * propRe - dhIm * propIm;
      sumScratchIm[k] += dhRe * propIm + dhIm * propRe;
    }
    return;
  }

  const clampedPolar = Math.max(0, Math.min(180, polarDeg));
  const { i0: p0, i1: p1, t: tp } = findGridInterp(balloon.polarAnglesDeg, clampedPolar);

  let foldedM = meridianDeg % 360;
  if (foldedM < 0) foldedM += 360;
  if (balloon.symmetry === 'axial') {
    foldedM = 0;
  } else if (balloon.symmetry === 'quadrant') {
    if (foldedM > 270) foldedM = 360 - foldedM;
    else if (foldedM > 180) foldedM = foldedM - 180;
    else if (foldedM > 90) foldedM = 180 - foldedM;
  }

  const mGrid = balloon.meridianAnglesDeg;
  const mCount = mGrid.length;
  const pCount = balloon.polarAnglesDeg.length;
  let m0 = 0;
  let m1 = 0;
  let tm = 0;
  if (mCount > 1) {
    if (balloon.symmetry === 'none' && foldedM > mGrid[mCount - 1]) {
      m0 = mCount - 1;
      m1 = 0;
      const span = 360 - mGrid[mCount - 1] + mGrid[0];
      tm = span > 1e-9 ? (foldedM - mGrid[mCount - 1]) / span : 0;
    } else {
      const mb = findGridInterp(mGrid, foldedM);
      m0 = mb.i0;
      m1 = mb.i1;
      tm = mb.t;
    }
  }

  const w00 = (1 - tm) * (1 - tp);
  const w01 = (1 - tm) * tp;
  const w10 = tm * (1 - tp);
  const w11 = tm * tp;
  const off00 = m0 * pCount + p0;
  const off01 = m0 * pCount + p1;
  const off10 = m1 * pCount + p0;
  const off11 = m1 * pCount + p1;
  const sliceSize = mCount * pCount;

  const onAxisReIm = entry.onAxisDriveReIm;
  const offLin = entry.offAxisLinGain;

  for (let k = 0; k < fCount; k++) {
    const base = k * sliceSize;
    const dirGain =
      w00 * offLin[base + off00] +
      w01 * offLin[base + off01] +
      w10 * offLin[base + off10] +
      w11 * offLin[base + off11];

    const airGain = Math.exp(-bands.airAbsorptionDbPerM[k] * distanceM * LN10_OVER_20);
    const scale = invDist * airGain * dirGain;

    const phase = -bands.wavenumbersRadPerM[k] * distanceM;
    const propRe = Math.cos(phase) * scale;
    const propIm = Math.sin(phase) * scale;

    const sRe = onAxisReIm[k * 2];
    const sIm = onAxisReIm[k * 2 + 1];
    sumScratchRe[k] += sRe * propRe - sIm * propIm;
    sumScratchIm[k] += sRe * propIm + sIm * propRe;
  }
}

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

  const fCount = bands.frequenciesHz.length;
  sumScratchRe.fill(0);
  sumScratchIm.fill(0);

  for (let rIdx = 0; rIdx < tables.length; rIdx++) {
    const entry = tables[rIdx];
    const rad = entry.radiator;

    const dir = computeLocalDirection(rad.position, rad.basis, receptor);
    accumulateRayContribution(
      entry,
      dir.distanceM,
      dir.polarDeg,
      dir.meridianDeg,
      1.0,
      bands,
      sumScratchRe,
      sumScratchIm
    );

    for (let m = 0; m < rad.imagePoses.length; m++) {
      const img = rad.imagePoses[m];
      const imgDir = computeLocalDirection(img.pose.position, img.pose.basis, receptor);
      accumulateRayContribution(
        entry,
        imgDir.distanceM,
        imgDir.polarDeg,
        imgDir.meridianDeg,
        img.reflectionFactor,
        bands,
        sumScratchRe,
        sumScratchIm
      );
    }
  }

  let totalWeightedEnergy = 0;
  for (let k = 0; k < fCount; k++) {
    const magSq = sumScratchRe[k] * sumScratchRe[k] + sumScratchIm[k] * sumScratchIm[k];
    totalWeightedEnergy += magSq * bands.energyWeights[k];
  }

  if (totalWeightedEnergy <= 1e-18) {
    return -120;
  }
  return 10 * Math.log10(totalWeightedEnergy);
}

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
