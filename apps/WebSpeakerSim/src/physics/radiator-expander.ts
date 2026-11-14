// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Expands scene point sources (including L/R symmetric twins) and subwoofer arrays
 * into 3D radiators with precomputed orientation matrices, image-source poses, and compiled DSP chains.
 */

import { computeSpeedOfSoundMpS } from '@foh/acoustics';
import {
  DEFAULT_SOURCE_DSP_CONFIG,
  compileDspChain,
  type CompiledDspChain,
} from '@foh/dsp';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { DspGroup, ProjectScene } from '../model/project-types.js';
import type { DirectivityBalloon } from './directivity-balloon.js';
import { expandSubwooferArray } from './sub-array-designer.js';
import {
  buildOrientationMatrix,
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
