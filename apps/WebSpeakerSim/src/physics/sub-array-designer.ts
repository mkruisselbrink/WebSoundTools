// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Subwoofer array synthesis (Broadside, Cardioid CSA, End-Fire, Electronic Delay Arc)
 * and inter-group arrival / crossover phase alignment (`src/physics/sub-array-designer.ts`).
 */

import type { SubArrayInstance } from '../model/project-types.js';
import { DEG_TO_RAD, distanceVec3, type EulerOrientationDeg, type Vec3 } from './transform3d.js';

export interface GeneratedSubCabinet {
  readonly id: string;
  readonly label: string;
  readonly speakerId: string;
  readonly dspGroupId: string;
  readonly position: Vec3;
  readonly orientation: EulerOrientationDeg;
  readonly trimGainDb: number;
  readonly trimDelayMs: number;
  readonly invertPolarity: boolean;
  readonly muted: boolean;
}

export interface TimeAlignmentRecommendation {
  readonly referenceMeanArrivalMs: number;
  readonly targetMeanArrivalMs: number;
  /** Recommended total delay in ms to apply to the target group (`>= 0` when target is closer than reference; negative indicates reference should be delayed instead). */
  readonly recommendedDeltaDelayMs: number;
  readonly recommendedInvertPolarity: boolean;
}

/** Quarter-wavelength spacing lambda / 4 = c / (4 * f_tune) for 2-element gradient/end-fire nulling. */
export function computeQuarterWaveSpacingM(
  tuningFrequencyHz: number,
  speedOfSoundMpS: number = 343.2
): number {
  const safeFreq = Math.max(20, Math.min(250, tuningFrequencyHz));
  return speedOfSoundMpS / (4 * safeFreq);
}

/**
 * Expands a parameterized `SubArrayInstance` into individual 3D subwoofer cabinets with
 * exact positions, orientations, polarities, gain trims, and electronic steering delays.
 */
export function expandSubwooferArray(
  subArray: SubArrayInstance,
  speedOfSoundMpS: number = 343.2
): GeneratedSubCabinet[] {
  const count = Math.max(1, Math.min(32, Math.round(subArray.boxCount)));
  const c = Math.max(250, speedOfSoundMpS);
  const azRad = subArray.azimuthDeg * DEG_TO_RAD;
  const fwdX = Math.cos(azRad);
  const fwdY = Math.sin(azRad);
  // Local lateral +Y_arr unit vector: (-sin(az), cos(az))
  const latX = -fwdY;
  const latY = fwdX;

  const spacing = Math.max(0.3, subArray.spacingM);
  const out: GeneratedSubCabinet[] = [];

  switch (subArray.mode) {
    case 'broadside': {
      const halfSpan = ((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const yLocal = -halfSpan + i * spacing;
        out.push({
          id: `${subArray.id}:sub-${i + 1}`,
          label: `${subArray.name} #${i + 1}`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: {
            x: subArray.origin.x + latX * yLocal,
            y: subArray.origin.y + latY * yLocal,
            z: subArray.origin.z,
          },
          orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: subArray.muted,
        });
      }
      return out;
    }

    case 'delay-arc': {
      const halfSpan = ((count - 1) * spacing) / 2;
      const clampedArcDeg = Math.max(5, Math.min(150, subArray.arcAngleDeg));
      const sinHalfArc = Math.sin((clampedArcDeg * 0.5) * DEG_TO_RAD);
      const radiusM = count > 1 && sinHalfArc > 1e-4 ? halfSpan / sinHalfArc : 0;

      for (let i = 0; i < count; i++) {
        const yLocal = -halfSpan + i * spacing;
        const extraPathM =
          radiusM > 0 ? Math.hypot(radiusM, yLocal) - radiusM : 0;
        const delayMs = (extraPathM / c) * 1000;

        out.push({
          id: `${subArray.id}:sub-${i + 1}`,
          label: `${subArray.name} #${i + 1}`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: {
            x: subArray.origin.x + latX * yLocal,
            y: subArray.origin.y + latY * yLocal,
            z: subArray.origin.z,
          },
          orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
          trimGainDb: 0,
          trimDelayMs: delayMs,
          invertPolarity: false,
          muted: subArray.muted,
        });
      }
      return out;
    }

    case 'end-fire': {
      // Colinear line along throw vector (+fwd): element 0 at origin, element i at +i * spacing
      // Progressive delay tau_i = i * spacing / c aligns all elements coherently forward (+X)
      for (let i = 0; i < count; i++) {
        const xLocal = i * spacing;
        const delayMs = ((xLocal) / c) * 1000;
        out.push({
          id: `${subArray.id}:sub-${i + 1}`,
          label: `${subArray.name} EF#${i + 1}`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: {
            x: subArray.origin.x + fwdX * xLocal,
            y: subArray.origin.y + fwdY * xLocal,
            z: subArray.origin.z,
          },
          orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
          trimGainDb: 0,
          trimDelayMs: delayMs,
          invertPolarity: false,
          muted: subArray.muted,
        });
      }
      return out;
    }

    case 'cardioid-csa': {
      // Gradient cardioid columns spaced laterally along Y:
      // Each column pairs forward radiator(s) at x = +depth/2 with an inverted, delayed rear radiator at x = -depth/2.
      const depth = Math.max(0.25, subArray.cardioidDepthOffsetM);
      const rearDelayMs = (depth / c) * 1000;

      if (count === 1) {
        // Single box fallback
        out.push({
          id: `${subArray.id}:sub-1`,
          label: `${subArray.name} #1`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: subArray.origin,
          orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: subArray.muted,
        });
        return out;
      }

      if (count % 3 === 0) {
        // 3-box CSA triplets (2 front boxes + 1 rear inverted box per stack)
        const stackCount = count / 3;
        const halfSpan = ((stackCount - 1) * spacing) / 2;
        const boxHeightStep = 0.6;
        let boxIdx = 1;
        for (let s = 0; s < stackCount; s++) {
          const yLocal = -halfSpan + s * spacing;
          const baseX = subArray.origin.x + latX * yLocal;
          const baseY = subArray.origin.y + latY * yLocal;
          // Rear inverted element at bottom/rear (-depth/2)
          out.push({
            id: `${subArray.id}:sub-${boxIdx++}`,
            label: `${subArray.name} S${s + 1}-Rear`,
            speakerId: subArray.speakerId,
            dspGroupId: subArray.dspGroupId,
            position: {
              x: baseX - fwdX * (depth * 0.5),
              y: baseY - fwdY * (depth * 0.5),
              z: subArray.origin.z,
            },
            orientation: { azimuthDeg: normalizeDeg(subArray.azimuthDeg + 180), tiltDeg: 0, rollDeg: 0 },
            trimGainDb: 0,
            trimDelayMs: rearDelayMs,
            invertPolarity: true,
            muted: subArray.muted,
          });
          // Two forward elements at +depth/2, attenuated -4.5 dB each so their combined stage-side pressure matches the closer rear box
          for (let f = 0; f < 2; f++) {
            out.push({
              id: `${subArray.id}:sub-${boxIdx++}`,
              label: `${subArray.name} S${s + 1}-Front${f + 1}`,
              speakerId: subArray.speakerId,
              dspGroupId: subArray.dspGroupId,
              position: {
                x: baseX + fwdX * (depth * 0.5),
                y: baseY + fwdY * (depth * 0.5),
                z: subArray.origin.z + (f + 1) * boxHeightStep,
              },
              orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
              trimGainDb: -4.5,
              trimDelayMs: 0,
              invertPolarity: false,
              muted: subArray.muted,
            });
          }
        }
        return out;
      }

      // General 2-element front/rear gradient pairs (plus any odd remainder forward box)
      const pairCount = Math.floor(count / 2);
      const hasRemainder = count % 2 === 1;
      const totalCols = pairCount + (hasRemainder ? 1 : 0);
      const halfSpan = ((totalCols - 1) * spacing) / 2;
      let boxIdx = 1;

      for (let p = 0; p < pairCount; p++) {
        const yLocal = -halfSpan + p * spacing;
        const baseX = subArray.origin.x + latX * yLocal;
        const baseY = subArray.origin.y + latY * yLocal;

        // Front element (+depth/2)
        out.push({
          id: `${subArray.id}:sub-${boxIdx++}`,
          label: `${subArray.name} P${p + 1}-Front`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: {
            x: baseX + fwdX * (depth * 0.5),
            y: baseY + fwdY * (depth * 0.5),
            z: subArray.origin.z,
          },
          orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: subArray.muted,
        });

        // Rear inverted & delayed element (-depth/2)
        out.push({
          id: `${subArray.id}:sub-${boxIdx++}`,
          label: `${subArray.name} P${p + 1}-Rear`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: {
            x: baseX - fwdX * (depth * 0.5),
            y: baseY - fwdY * (depth * 0.5),
            z: subArray.origin.z,
          },
          orientation: { azimuthDeg: normalizeDeg(subArray.azimuthDeg + 180), tiltDeg: 0, rollDeg: 0 },
          trimGainDb: -1.0, // Slight near-field spreading compensation
          trimDelayMs: rearDelayMs,
          invertPolarity: true,
          muted: subArray.muted,
        });
      }

      if (hasRemainder) {
        const yLocal = -halfSpan + pairCount * spacing;
        out.push({
          id: `${subArray.id}:sub-${boxIdx}`,
          label: `${subArray.name} #${boxIdx}`,
          speakerId: subArray.speakerId,
          dspGroupId: subArray.dspGroupId,
          position: {
            x: subArray.origin.x + latX * yLocal,
            y: subArray.origin.y + latY * yLocal,
            z: subArray.origin.z,
          },
          orientation: { azimuthDeg: subArray.azimuthDeg, tiltDeg: 0, rollDeg: 0 },
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: subArray.muted,
        });
      }

      return out;
    }
  }
}

/**
 * Computes geometric time-of-flight alignment between a reference source set and a target source set
 * at `micPosition`, plus polarity recommendation given crossover phase difference at alignment frequency.
 */
export function computeTimeAlignmentAtPoint(
  referenceSources: ReadonlyArray<{ readonly position: Vec3; readonly electronicDelayMs?: number }>,
  targetSources: ReadonlyArray<{ readonly position: Vec3; readonly electronicDelayMs?: number }>,
  micPosition: Vec3,
  speedOfSoundMpS: number = 343.2,
  phaseDiffAtCrossoverRad: number = 0
): TimeAlignmentRecommendation {
  const c = Math.max(250, speedOfSoundMpS);

  const firstArrivalMs = (
    items: ReadonlyArray<{ readonly position: Vec3; readonly electronicDelayMs?: number }>
  ): number => {
    if (items.length === 0) return 0;
    let best = Number.POSITIVE_INFINITY;
    for (const item of items) {
      const flightMs = (distanceVec3(item.position, micPosition) / c) * 1000;
      const total = flightMs + (item.electronicDelayMs ?? 0);
      if (total < best) best = total;
    }
    return best;
  };

  const refMs = firstArrivalMs(referenceSources);
  const tgtMs = firstArrivalMs(targetSources);
  const deltaDelayMs = refMs - tgtMs;
  const invertPolarity = Math.cos(phaseDiffAtCrossoverRad) < 0;

  return {
    referenceMeanArrivalMs: refMs,
    targetMeanArrivalMs: tgtMs,
    recommendedDeltaDelayMs: deltaDelayMs,
    recommendedInvertPolarity: invertPolarity,
  };
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

