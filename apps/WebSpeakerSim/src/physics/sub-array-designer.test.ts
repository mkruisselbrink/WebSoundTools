// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_ATMOSPHERE, computeSpeedOfSoundMpS } from '@foh/acoustics';
import { DEFAULT_SOURCE_DSP_CONFIG } from '@foh/dsp';
import { describe, expect, it } from 'vitest';
import { getBuiltinSpeakerMap } from '../library/builtin-speakers.js';
import type { ProjectScene, SubArrayInstance } from '../model/project-types.js';
import {
  computeQuarterWaveSpacingM,
  computeTimeAlignmentAtPoint,
  expandSubwooferArray,
} from './sub-array-designer.js';
import { evaluateVirtualMic } from './virtual-mic-solver.js';

function makeSubScene(subArray: SubArrayInstance): ProjectScene {
  return {
    id: 'test-sub',
    name: 'Sub Test',
    driveOffsetDb: 0,
    atmosphere: DEFAULT_ATMOSPHERE,
    reflectors: [], // Free-field for pure array pattern verification
    bandSelection: { kind: 'single', frequencyHz: 63 },
    planBounds: { xMin: -20, xMax: 30, yMin: -20, yMax: 20 },
    sectionBounds: { xMin: -20, xMax: 30, zMin: 0, zMax: 8, sliceYM: 0 },
    defaultListenerHeightM: 0,
    surfaces: [],
    dspGroups: [{ id: 'grp-sub', name: 'Subs', color: '#f59e0b', dsp: DEFAULT_SOURCE_DSP_CONFIG }],
    pointSources: [],
    subArrays: [subArray],
    virtualMics: [],
  };
}

describe('sub-array-designer', () => {
  const speakerMap = getBuiltinSpeakerMap();
  const c = computeSpeedOfSoundMpS(DEFAULT_ATMOSPHERE);

  it('synthesizes 4-element End-Fire array with coherent forward sum and deep rear null at tuning frequency', () => {
    const fTune = 68;
    // Quarter-wave spacing produces destructive cancellation between adjacent pairs in -X
    const dx = computeQuarterWaveSpacingM(fTune, c);

    const endFireScene = makeSubScene({
      id: 'sa-ef',
      name: 'End-Fire',
      speakerId: 'builtin-sub-18-reflex',
      dspGroupId: 'grp-sub',
      mode: 'end-fire',
      boxCount: 4,
      origin: { x: 0, y: 0, z: 0 },
      azimuthDeg: 0,
      spacingM: dx,
      cardioidDepthOffsetM: 0.8,
      tuningFrequencyHz: fTune,
      arcAngleDeg: 60,
      muted: false,
    });

    const singleScene = makeSubScene({
      ...endFireScene.subArrays[0],
      boxCount: 1,
    });

    const freqProbe = new Float32Array([fTune]);
    const frontMic = { id: 'm-f', name: 'Front', color: '#fff', position: { x: 40, y: 0, z: 0 }, enabled: true };
    const rearMic = { id: 'm-r', name: 'Rear', color: '#fff', position: { x: -40, y: 0, z: 0 }, enabled: true };

    const singleFront = evaluateVirtualMic(frontMic, singleScene, speakerMap, freqProbe).magnitudeDbSpl[0];
    const efFront = evaluateVirtualMic(frontMic, endFireScene, speakerMap, freqProbe).magnitudeDbSpl[0];
    const efRear = evaluateVirtualMic(rearMic, endFireScene, speakerMap, freqProbe).magnitudeDbSpl[0];

    // 4 coherent elements add ~ +12 dB forward (slightly more because boxes 2..4 are closer to x=+40m)
    expect(efFront - singleFront).toBeGreaterThan(11.8);
    expect(efFront - efRear).toBeGreaterThan(20);
  });

  it('achieves > 14 dB front-to-back rejection for both 2-box pair and 3-box CSA cardioid stacks', () => {
    for (const boxCount of [2, 3]) {
      const csaScene = makeSubScene({
        id: `sa-csa-${boxCount}`,
        name: 'CSA',
        speakerId: 'builtin-sub-18-reflex',
        dspGroupId: 'grp-sub',
        mode: 'cardioid-csa',
        boxCount,
        origin: { x: 0, y: 0, z: 0 },
        azimuthDeg: 0,
        spacingM: 1.2,
        cardioidDepthOffsetM: 0.85,
        tuningFrequencyHz: 63,
        arcAngleDeg: 60,
        muted: false,
      });

      const freqProbe = new Float32Array([63]);
      const frontSpl = evaluateVirtualMic(
        { id: 'f', name: 'F', color: '#fff', position: { x: 8, y: 0, z: 0 }, enabled: true },
        csaScene,
        speakerMap,
        freqProbe
      ).magnitudeDbSpl[0];
      const stageSpl = evaluateVirtualMic(
        { id: 'r', name: 'R', color: '#fff', position: { x: -4.5, y: 0, z: 0 }, enabled: true },
        csaScene,
        speakerMap,
        freqProbe
      ).magnitudeDbSpl[0];

      expect(frontSpl - stageSpl).toBeGreaterThan(14);
    }
  });

  it('curves outer cabinet delays symmetrically in Electronic Delay Arc mode to widen horizontal coverage', () => {
    const cabs = expandSubwooferArray(
      {
        id: 'sa-arc',
        name: 'Arc',
        speakerId: 'builtin-sub-18-reflex',
        dspGroupId: 'grp-sub',
        mode: 'delay-arc',
        boxCount: 6,
        origin: { x: 0, y: 0, z: 0 },
        azimuthDeg: 0,
        spacingM: 1.4,
        cardioidDepthOffsetM: 0.8,
        tuningFrequencyHz: 63,
        arcAngleDeg: 90,
        muted: false,
      },
      c
    );

    expect(cabs.length).toBe(6);
    // Symmetric outer delays > inner delays
    expect(cabs[0].trimDelayMs).toBeCloseTo(cabs[5].trimDelayMs, 5);
    expect(cabs[1].trimDelayMs).toBeCloseTo(cabs[4].trimDelayMs, 5);
    expect(cabs[0].trimDelayMs).toBeGreaterThan(cabs[1].trimDelayMs);
    expect(cabs[1].trimDelayMs).toBeGreaterThan(cabs[2].trimDelayMs);
  });

  it('computes exact geometric arrival delay delta in computeTimeAlignmentAtPoint', () => {
    const rec = computeTimeAlignmentAtPoint(
      [{ position: { x: 0, y: 0, z: 5 }, electronicDelayMs: 0 }],
      [{ position: { x: 20, y: 0, z: 3 }, electronicDelayMs: 0 }],
      { x: 30, y: 0, z: 1.6 },
      343.2,
      Math.PI * 0.9 // > 90 deg out of phase -> recommend polarity inversion
    );

    const dRef = Math.hypot(30, 0, 1.6 - 5);
    const dTgt = Math.hypot(10, 0, 1.6 - 3);
    expect(rec.recommendedDeltaDelayMs).toBeCloseTo(((dRef - dTgt) / 343.2) * 1000, 4);
    expect(rec.recommendedInvertPolarity).toBe(true);
  });
});

