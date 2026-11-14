// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure inter-group time & phase alignment solver at a Virtual Microphone position.
 */

import { computeSpeedOfSoundMpS } from '@foh/acoustics';
import { compileDspChain, evaluateCompiledDspAtFrequency } from '@foh/dsp';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { DspGroup, ProjectScene } from '../model/project-types.js';
import { expandSceneRadiators } from './radiator-expander.js';
import {
  computeTimeAlignmentAtPoint,
  type TimeAlignmentRecommendation,
} from './sub-array-designer.js';
import type { Vec3 } from './transform3d.js';

export interface GroupAlignmentPreview {
  readonly refGroup: DspGroup | undefined;
  readonly targetGroup: DspGroup | undefined;
  readonly refGroupId: string;
  readonly targetGroupId: string;
  readonly recommendation: TimeAlignmentRecommendation | null;
}

export function computeGroupAlignmentPreview(
  scene: ProjectScene,
  speakerMap: ReadonlyMap<string, SpeakerDefinition>,
  requestedRefGroupId: string,
  requestedTargetGroupId: string,
  micPosition: Vec3,
  alignFreqHz: number
): GroupAlignmentPreview {
  const groups = scene.dspGroups;
  const refGroupId =
    groups.find((g) => g.id === requestedRefGroupId)?.id ?? groups[0]?.id ?? '';
  const targetGroupId =
    groups.find((g) => g.id === requestedTargetGroupId && g.id !== refGroupId)?.id ??
    groups.find((g) => g.id !== refGroupId)?.id ??
    refGroupId;

  const radiators = expandSceneRadiators(scene, speakerMap);
  const c = computeSpeedOfSoundMpS(scene.atmosphere);
  const refGroup = groups.find((g) => g.id === refGroupId);
  const targetGroup = groups.find((g) => g.id === targetGroupId);

  const refSources = radiators
    .filter((r) => r.dspGroupId === refGroupId)
    .map((r) => ({
      position: r.position,
      electronicDelayMs: r.dspChain.delaySeconds * 1000,
    }));

  const tgtBaseDelayMs = targetGroup?.dsp.delayMs ?? 0;
  const tgtSources = radiators
    .filter((r) => r.dspGroupId === targetGroupId)
    .map((r) => ({
      position: r.position,
      electronicDelayMs: Math.max(0, r.dspChain.delaySeconds * 1000 - tgtBaseDelayMs),
    }));

  let phaseDiffRad = 0;
  if (refGroup && targetGroup) {
    const refChain = compileDspChain({ ...refGroup.dsp, delayMs: 0, invertPolarity: false });
    const tgtChain = compileDspChain({ ...targetGroup.dsp, delayMs: 0, invertPolarity: false });
    const hRef = evaluateCompiledDspAtFrequency(refChain, alignFreqHz);
    const hTgt = evaluateCompiledDspAtFrequency(tgtChain, alignFreqHz);
    phaseDiffRad = Math.atan2(hRef.im, hRef.re) - Math.atan2(hTgt.im, hTgt.re);
  }

  const canAlign = refGroupId !== targetGroupId && refSources.length > 0 && tgtSources.length > 0;
  const recommendation = canAlign
    ? computeTimeAlignmentAtPoint(refSources, tgtSources, micPosition, c, phaseDiffRad)
    : null;

  return {
    refGroup,
    targetGroup,
    refGroupId,
    targetGroupId,
    recommendation,
  };
}
