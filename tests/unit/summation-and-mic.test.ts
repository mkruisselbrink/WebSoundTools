/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { getBuiltinSpeakerMap } from '../../src/library/builtin-speakers.js';
import type { ProjectScene } from '../../src/model/project-types.js';
import { DEFAULT_ATMOSPHERE } from '../../src/physics/atmosphere.js';
import { DEFAULT_SOURCE_DSP_CONFIG } from '../../src/physics/biquad.js';
import { evaluatePlanGrid } from '../../src/physics/summation-solver.js';
import { DEFAULT_GROUND_REFLECTOR } from '../../src/physics/transform3d.js';
import { evaluateVirtualMic } from '../../src/physics/virtual-mic-solver.js';

function createBasePointScene(): ProjectScene {
  return {
    id: 'base',
    name: 'Base',
    driveOffsetDb: 0,
    atmosphere: {
      temperatureCelsius: 20,
      relativeHumidityPercent: 50,
      pressureKpa: 101.325,
    },
    reflectors: [],
    bandSelection: { kind: 'single', frequencyHz: 250 },
    planBounds: { xMin: 0, xMax: 20, yMin: -5, yMax: 5 },
    sectionBounds: { xMin: 0, xMax: 20, zMin: 0, zMax: 5, sliceYM: 0 },
    defaultListenerHeightM: 1.5,
    surfaces: [
      {
        id: 'aud',
        name: 'Audience',
        role: 'audience',
        enabled: true,
        xStart: 2,
        xEnd: 18,
        yCenter: 0,
        widthStart: 8,
        widthEnd: 8,
        zStart: 0,
        zEnd: 0,
        earHeightM: 1.5,
      },
    ],
    dspGroups: [{ id: 'g1', name: 'Mains', color: '#38bdf8', dsp: DEFAULT_SOURCE_DSP_CONFIG }],
    pointSources: [
      {
        id: 's1',
        name: 'Main C',
        speakerId: 'builtin-top-12-90x60',
        dspGroupId: 'g1',
        position: { x: 0, y: 0, z: 1.5 },
        orientation: { azimuthDeg: 0, tiltDeg: 0, rollDeg: 0 },
        mirrorLeftRight: false,
        trimGainDb: 0,
        trimDelayMs: 0,
        invertPolarity: false,
        muted: false,
      },
    ],
    subArrays: [],
    virtualMics: [],
  };
}

describe('summation-solver & virtual-mic-solver', () => {
  const speakerMap = getBuiltinSpeakerMap();

  it('obeys free-field inverse-square law (-6.02 dB per distance doubling)', () => {
    const scene = createBasePointScene();
    const fGrid = new Float32Array([250]);
    const mic5m = evaluateVirtualMic(
      { id: 'm5', name: '5m', color: '#fff', position: { x: 5, y: 0, z: 1.5 }, enabled: true },
      scene,
      speakerMap,
      fGrid
    );
    const mic10m = evaluateVirtualMic(
      { id: 'm10', name: '10m', color: '#fff', position: { x: 10, y: 0, z: 1.5 }, enabled: true },
      scene,
      speakerMap,
      fGrid
    );

    // Including ~0.005 dB air loss difference over 5 m at 250 Hz:
    expect(mic5m.magnitudeDbSpl[0] - mic10m.magnitudeDbSpl[0]).toBeCloseTo(6.02, 1);
  });

  it('sums two co-located sources to +6.02 dB in-phase and cancels when polarity-inverted', () => {
    const base = createBasePointScene();
    const fGrid = new Float32Array([500]);
    const mic = { id: 'm', name: 'M', color: '#fff', position: { x: 8, y: 0, z: 1.5 }, enabled: true };

    const singleDb = evaluateVirtualMic(mic, base, speakerMap, fGrid).magnitudeDbSpl[0];

    const inPhaseScene: ProjectScene = {
      ...base,
      pointSources: [base.pointSources[0], { ...base.pointSources[0], id: 's2', name: 'Main C2' }],
    };
    const sumDb = evaluateVirtualMic(mic, inPhaseScene, speakerMap, fGrid).magnitudeDbSpl[0];
    expect(sumDb - singleDb).toBeCloseTo(6.0206, 2);

    const outOfPhaseScene: ProjectScene = {
      ...base,
      pointSources: [
        base.pointSources[0],
        { ...base.pointSources[0], id: 's2', name: 'Main C2', invertPolarity: true },
      ],
    };
    const cancelDb = evaluateVirtualMic(mic, outOfPhaseScene, speakerMap, fGrid).magnitudeDbSpl[0];
    expect(cancelDb).toBeLessThan(-100);
  });

  it('produces ~ +6.0 dB half-space loading for ground-stacked subwoofer over rigid floor', () => {
    const freeSubScene: ProjectScene = {
      ...createBasePointScene(),
      reflectors: [],
      pointSources: [
        {
          id: 'sub1',
          name: 'Sub',
          speakerId: 'builtin-sub-18-reflex',
          dspGroupId: 'g1',
          position: { x: 0, y: 0, z: 0.2 },
          orientation: { azimuthDeg: 0, tiltDeg: 0, rollDeg: 0 },
          mirrorLeftRight: false,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
      ],
    };
    const groundSubScene: ProjectScene = {
      ...freeSubScene,
      reflectors: [{ ...DEFAULT_GROUND_REFLECTOR, reflectionFactor: 1.0, enabled: true }],
    };

    const f50 = new Float32Array([50]);
    const farMic = { id: 'm', name: 'M', color: '#fff', position: { x: 20, y: 0, z: 1.2 }, enabled: true };

    const freeSpl = evaluateVirtualMic(farMic, freeSubScene, speakerMap, f50).magnitudeDbSpl[0];
    const groundSpl = evaluateVirtualMic(farMic, groundSubScene, speakerMap, f50).magnitudeDbSpl[0];
    expect(groundSpl - freeSpl).toBeGreaterThan(5.85);
    expect(groundSpl - freeSpl).toBeLessThan(6.05);
  });

  it('predicts exact comb-filter peaks (1 kHz) and nulls (500 Hz, 1.5 kHz) for 1.0 ms offset', () => {
    const base = createBasePointScene();
    const combScene: ProjectScene = {
      ...base,
      pointSources: [
        base.pointSources[0],
        { ...base.pointSources[0], id: 's2', name: 'Delayed 1ms', trimDelayMs: 1.0 },
      ],
    };

    const freqs = new Float32Array([500, 1000, 1500, 2000]);
    const mic = { id: 'm', name: 'M', color: '#fff', position: { x: 8, y: 0, z: 1.5 }, enabled: true };
    const single = evaluateVirtualMic(mic, base, speakerMap, freqs);
    const comb = evaluateVirtualMic(mic, combScene, speakerMap, freqs);

    // 500 Hz & 1500 Hz are half-wavelength destructive nulls; 1000 Hz & 2000 Hz are +6.02 dB constructive peaks!
    expect(comb.magnitudeDbSpl[0]).toBeLessThan(single.magnitudeDbSpl[0] - 40);
    expect(comb.magnitudeDbSpl[1] - single.magnitudeDbSpl[1]).toBeCloseTo(6.02, 1);
    expect(comb.magnitudeDbSpl[2]).toBeLessThan(single.magnitudeDbSpl[2] - 40);
    expect(comb.magnitudeDbSpl[3] - single.magnitudeDbSpl[3]).toBeCloseTo(6.02, 1);
  });

  it('evaluates Plan grid with audience surface masking and coverage statistics', () => {
    const scene = createBasePointScene();
    const res = evaluatePlanGrid(scene, speakerMap, 1.0);
    expect(res.cols).toBe(21);
    expect(res.rows).toBe(11);
    expect(res.stats.audienceSampleCount).toBeGreaterThan(100);
    expect(res.stats.maxAudienceSplDb).toBeGreaterThan(res.stats.minAudienceSplDb);
  });
});

