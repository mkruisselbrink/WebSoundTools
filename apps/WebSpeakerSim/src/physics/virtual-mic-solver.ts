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
 * High-resolution virtual measurement microphone solver (`src/physics/virtual-mic-solver.ts`).
 * Computes 20 Hz - 20 kHz complex pressure response, wrapped phase (normalized to first arrival),
 * group delay, broadband SPL, and discrete ray arrival impulses.
 */

import {
  computeAWeightingDb,
  computeAirAbsorptionTable,
  computeCWeightingDb,
  computeSpeedOfSoundMpS,
  createLogFrequencyGrid,
  serializeFrdText,
} from '@foh/acoustics';
import { computeGroupDelayFromPhasorsMs, evaluateCompiledDspAtFrequency } from '@foh/dsp';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { ProjectScene, VirtualMicInstance } from '../model/project-types.js';
import { sampleDirectivityBalloon } from './directivity-balloon.js';
import { expandSceneRadiators, type ActiveRadiator } from './summation-solver.js';
import { RAD_TO_DEG, computeLocalDirection } from './transform3d.js';

export interface DiscreteArrivalImpulse {
  readonly radiatorId: string;
  readonly label: string;
  readonly dspGroupId: string;
  readonly isReflection: boolean;
  readonly arrivalTimeMs: number;
  readonly distanceM: number;
  /** Broadband 1 kHz / passband arrival level in dB SPL. */
  readonly levelDbSpl: number;
  readonly polaritySign: 1 | -1;
}

export interface VirtualMicResponse {
  readonly micId: string;
  readonly micName: string;
  readonly frequenciesHz: Float32Array;
  /** Predicted SPL per bin in dB. */
  readonly magnitudeDbSpl: Float32Array;
  /** Phase in [-180, 180] degrees compensated for `referenceDelayMs` (first arrival time) so curves are readable without steep flight-time wrap! */
  readonly phaseDeg: Float32Array;
  /** Group delay in ms relative to `referenceDelayMs`. */
  readonly groupDelayMs: Float32Array;
  /** Time-of-flight + electronic delay of the earliest arriving wave in ms (used as phase reference t = 0). */
  readonly referenceDelayMs: number;
  readonly broadbandSplZDb: number;
  readonly broadbandSplADb: number;
  readonly broadbandSplCDb: number;
  readonly arrivals: readonly DiscreteArrivalImpulse[];
}

export const DEFAULT_VIRTUAL_MIC_BIN_COUNT = 241;

export function evaluateVirtualMic(
  mic: VirtualMicInstance,
  scene: ProjectScene,
  speakerMap: ReadonlyMap<string, SpeakerDefinition>,
  frequenciesHz: Float32Array = createLogFrequencyGrid(DEFAULT_VIRTUAL_MIC_BIN_COUNT, 20, 20000)
): VirtualMicResponse {
  const radiators = expandSceneRadiators(scene, speakerMap);
  return evaluateVirtualMicFromRadiators(mic, scene, radiators, frequenciesHz);
}

export function evaluateVirtualMicFromRadiators(
  mic: VirtualMicInstance,
  scene: ProjectScene,
  radiators: readonly ActiveRadiator[],
  frequenciesHz: Float32Array = createLogFrequencyGrid(DEFAULT_VIRTUAL_MIC_BIN_COUNT, 20, 20000)
): VirtualMicResponse {
  const F = frequenciesHz.length;
  const magnitudeDbSpl = new Float32Array(F);
  const phaseDeg = new Float32Array(F);
  const groupDelayMs = new Float32Array(F);

  if (radiators.length === 0) {
    magnitudeDbSpl.fill(-120);
    return {
      micId: mic.id,
      micName: mic.name,
      frequenciesHz,
      magnitudeDbSpl,
      phaseDeg,
      groupDelayMs,
      referenceDelayMs: 0,
      broadbandSplZDb: -120,
      broadbandSplADb: -120,
      broadbandSplCDb: -120,
      arrivals: [],
    };
  }

  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  const airAlpha = computeAirAbsorptionTable(frequenciesHz, scene.atmosphere);

  const arrivals: DiscreteArrivalImpulse[] = [];
  let minArrivalSec = Number.POSITIVE_INFINITY;

  // Pre-collect paths (direct + reflections) for this mic
  interface RayPath {
    readonly rad: ActiveRadiator;
    readonly distanceM: number;
    readonly polarDeg: number;
    readonly meridianDeg: number;
    readonly scaleFactor: number;
    readonly flightSec: number;
    readonly isReflection: boolean;
    readonly label: string;
  }

  const paths: RayPath[] = [];

  for (const rad of radiators) {
    const dir = computeLocalDirection(rad.position, rad.basis, mic.position);
    const flightSec = dir.distanceM / c;
    const totalArrivalSec = flightSec + rad.dspChain.delaySeconds;
    if (totalArrivalSec < minArrivalSec) {
      minArrivalSec = totalArrivalSec;
    }

    paths.push({
      rad,
      distanceM: dir.distanceM,
      polarDeg: dir.polarDeg,
      meridianDeg: dir.meridianDeg,
      scaleFactor: 1 / dir.distanceM,
      flightSec,
      isReflection: false,
      label: rad.label,
    });

    // Representative passband frequency (80 Hz for sub, 1000 Hz for top) for impulse stem readout
    const repFreq = rad.speaker.category === 'subwoofer' ? 63 : 1000;
    const repBalloon = sampleDirectivityBalloon(rad.balloon, dir.polarDeg, dir.meridianDeg, repFreq);
    const repDsp = evaluateCompiledDspAtFrequency(rad.dspChain, repFreq);
    const repDspMagDb = 20 * Math.log10(Math.max(1e-9, Math.hypot(repDsp.re, repDsp.im)));
    const repAirLossDb = airAlpha[Math.floor(F / 2)] * dir.distanceM;
    const repSpl =
      rad.drive1mDbSpl +
      repBalloon.magnitudeDb +
      repDspMagDb -
      20 * Math.log10(dir.distanceM) -
      repAirLossDb;

    arrivals.push({
      radiatorId: rad.id,
      label: rad.label,
      dspGroupId: rad.dspGroupId,
      isReflection: false,
      arrivalTimeMs: totalArrivalSec * 1000,
      distanceM: dir.distanceM,
      levelDbSpl: repSpl,
      polaritySign: rad.dspChain.linearGainSigned < 0 ? -1 : 1,
    });

    for (const img of rad.imagePoses) {
      const imgDir = computeLocalDirection(img.pose.position, img.pose.basis, mic.position);
      const imgFlightSec = imgDir.distanceM / c;
      const imgTotalSec = imgFlightSec + rad.dspChain.delaySeconds;
      if (imgTotalSec < minArrivalSec) {
        minArrivalSec = imgTotalSec;
      }

      paths.push({
        rad,
        distanceM: imgDir.distanceM,
        polarDeg: imgDir.polarDeg,
        meridianDeg: imgDir.meridianDeg,
        scaleFactor: img.reflectionFactor / imgDir.distanceM,
        flightSec: imgFlightSec,
        isReflection: true,
        label: `${rad.label} (${img.reflectorId})`,
      });

      const imgBalloon = sampleDirectivityBalloon(
        rad.balloon,
        imgDir.polarDeg,
        imgDir.meridianDeg,
        repFreq
      );
      const imgSpl =
        rad.drive1mDbSpl +
        imgBalloon.magnitudeDb +
        repDspMagDb +
        20 * Math.log10(img.reflectionFactor / imgDir.distanceM);

      arrivals.push({
        radiatorId: rad.id,
        label: `${rad.label} (ground)`,
        dspGroupId: rad.dspGroupId,
        isReflection: true,
        arrivalTimeMs: imgTotalSec * 1000,
        distanceM: imgDir.distanceM,
        levelDbSpl: imgSpl,
        polaritySign: rad.dspChain.linearGainSigned < 0 ? -1 : 1,
      });
    }
  }

  arrivals.sort((a, b) => a.arrivalTimeMs - b.arrivalTimeMs);
  const refSec = Number.isFinite(minArrivalSec) ? minArrivalSec : 0;

  const totalRe = new Float64Array(F);
  const totalIm = new Float64Array(F);

  for (let pIdx = 0; pIdx < paths.length; pIdx++) {
    const path = paths[pIdx];
    const driveLin = Math.pow(10, path.rad.drive1mDbSpl / 20) * path.scaleFactor;

    for (let k = 0; k < F; k++) {
      const freq = frequenciesHz[k];
      const bSample = sampleDirectivityBalloon(
        path.rad.balloon,
        path.polarDeg,
        path.meridianDeg,
        freq
      );
      const hDsp = evaluateCompiledDspAtFrequency(path.rad.dspChain, freq);
      const airGain = Math.pow(10, (-airAlpha[k] * path.distanceM) / 20);

      // Compensate propagation phase by earliest arrival `refSec` (equivalent to measurement delay sync!)
      // Note: hDsp already includes `-2*pi*f*delaySeconds`, so compensate flight by `(path.flightSec - refSec)`!
      const relFlightPhase = -2 * Math.PI * freq * (path.flightSec - refSec);
      const pRe = Math.cos(relFlightPhase) * driveLin * airGain;
      const pIm = Math.sin(relFlightPhase) * driveLin * airGain;

      const dRe = bSample.linearComplex.re * hDsp.re - bSample.linearComplex.im * hDsp.im;
      const dIm = bSample.linearComplex.re * hDsp.im + bSample.linearComplex.im * hDsp.re;

      totalRe[k] += dRe * pRe - dIm * pIm;
      totalIm[k] += dRe * pIm + dIm * pRe;
    }
  }

  let sumZ = 0;
  let sumA = 0;
  let sumC = 0;
  const invBinNorm = 1 / F;

  for (let k = 0; k < F; k++) {
    const re = totalRe[k];
    const im = totalIm[k];
    const magSq = re * re + im * im;
    magnitudeDbSpl[k] = magSq > 1e-18 ? 10 * Math.log10(magSq) : -120;
    phaseDeg[k] = Math.atan2(im, re) * RAD_TO_DEG;

    const wA = Math.pow(10, computeAWeightingDb(frequenciesHz[k]) / 10);
    const wC = Math.pow(10, computeCWeightingDb(frequenciesHz[k]) / 10);
    sumZ += magSq * invBinNorm;
    sumA += magSq * wA * invBinNorm;
    sumC += magSq * wC * invBinNorm;
  }

  computeGroupDelayFromPhasorsMs(frequenciesHz, totalRe, totalIm, groupDelayMs);

  return {
    micId: mic.id,
    micName: mic.name,
    frequenciesHz,
    magnitudeDbSpl,
    phaseDeg,
    groupDelayMs,
    referenceDelayMs: refSec * 1000,
    broadbandSplZDb: sumZ > 1e-18 ? 10 * Math.log10(sumZ) : -120,
    broadbandSplADb: sumA > 1e-18 ? 10 * Math.log10(sumA) : -120,
    broadbandSplCDb: sumC > 1e-18 ? 10 * Math.log10(sumC) : -120,
    arrivals,
  };
}

/**
 * Exports a `VirtualMicResponse` as standard 3-column `.frd` text (`FreqHz\tMagDb\tPhaseDeg`)
 * so predicted responses can be imported directly into WebSoundMeter as Stored Traces.
 */
export function exportVirtualMicToFrd(micResponse: VirtualMicResponse): string {
  return serializeFrdText(
    micResponse.frequenciesHz,
    micResponse.magnitudeDbSpl,
    micResponse.phaseDeg,
    `WebSpeakerSim Predicted Response — ${micResponse.micName} (ref arrival ${micResponse.referenceDelayMs.toFixed(2)} ms, ${micResponse.broadbandSplADb.toFixed(1)} dBA)`
  );
}

