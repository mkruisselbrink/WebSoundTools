// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { getBuiltinSpeakerById, getBuiltinSpeakers } from '../library/builtin-speakers.js';
import { buildSpeakerFromSpec } from '../library/spec-builder.js';
import { sampleDirectivityBalloon } from './directivity-balloon.js';

describe('directivity-balloon & speaker library', () => {
  it('loads all 7 built-in parametric tops and subwoofers with valid 3D balloons', () => {
    const speakers = getBuiltinSpeakers();
    expect(speakers.length).toBe(7);
    for (const spk of speakers) {
      expect(spk.balloon.frequenciesHz.length).toBeGreaterThanOrEqual(20);
      const onAxis = sampleDirectivityBalloon(spk.balloon, 0, 0, 80);
      expect(Number.isFinite(onAxis.magnitudeDb)).toBe(true);
    }
  });

  it('calibrates constant-directivity horn beamwidth to ~ -6 dB at nominal H/2 and V/2 angles in HF band', () => {
    const top90x60 = getBuiltinSpeakerById('builtin-top-12-90x60')!;
    const onAxis4k = sampleDirectivityBalloon(top90x60.balloon, 0, 0, 4000).magnitudeDb;

    // Horizontal half-angle = 45 deg (meridian = 0 deg left and 180 deg right)
    const hLeft45 = sampleDirectivityBalloon(top90x60.balloon, 45, 0, 4000).magnitudeDb - onAxis4k;
    const hRight45 =
      sampleDirectivityBalloon(top90x60.balloon, 45, 180, 4000).magnitudeDb - onAxis4k;
    expect(hLeft45).toBeCloseTo(-6.0, 0);
    expect(hRight45).toBeCloseTo(hLeft45, 5);

    // Vertical half-angle = 30 deg (meridian = 90 deg top and 270 deg bottom)
    const vTop30 = sampleDirectivityBalloon(top90x60.balloon, 30, 90, 4000).magnitudeDb - onAxis4k;
    const vBot30 = sampleDirectivityBalloon(top90x60.balloon, 30, 270, 4000).magnitudeDb - onAxis4k;
    expect(vTop30).toBeCloseTo(-6.0, 0);
    expect(vBot30).toBeCloseTo(vTop30, 5);

    // Narrow 60x40 top attenuates significantly more at 45 deg horizontal than 90x60 top
    const top60x40 = getBuiltinSpeakerById('builtin-top-15-60x40')!;
    const narrow45 =
      sampleDirectivityBalloon(top60x40.balloon, 45, 0, 4000).magnitudeDb -
      sampleDirectivityBalloon(top60x40.balloon, 0, 0, 4000).magnitudeDb;
    expect(narrow45).toBeLessThan(hLeft45 - 4.0);
  });

  it('supports asymmetric vertical horns with smooth 360-degree meridian wrap', () => {
    const asym = buildSpeakerFromSpec({
      name: 'Asymmetric Point Source',
      category: 'point-source',
      horizontalDispersionDeg: 80,
      asymmetricVerticalDeg: { upDeg: 15, downDeg: 40 },
      low3dBHz: 60,
      high3dBHz: 18000,
      maxContinuousSpl1mDb: 130,
    });

    const onAxis = sampleDirectivityBalloon(asym.balloon, 0, 0, 6000).magnitudeDb;
    const up25 = sampleDirectivityBalloon(asym.balloon, 25, 90, 6000).magnitudeDb - onAxis;
    const down25 = sampleDirectivityBalloon(asym.balloon, 25, 270, 6000).magnitudeDb - onAxis;
    // Tight 15 deg upper horn drops much faster at +25 deg than wide 40 deg lower horn at -25 deg
    expect(up25).toBeLessThan(down25 - 6.0);

    // Periodic wrap continuity between 355 deg and 5 deg
    const m355 = sampleDirectivityBalloon(asym.balloon, 30, 355, 6000).magnitudeDb;
    const m005 = sampleDirectivityBalloon(asym.balloon, 30, 5, 6000).magnitudeDb;
    expect(Math.abs(m355 - m005)).toBeLessThan(1.0);
  });

  it('models omnidirectional vs intrinsic cardioid subwoofer balloons at 63 Hz', () => {
    const omniSub = getBuiltinSpeakerById('builtin-sub-18-reflex')!;
    const omniFront = sampleDirectivityBalloon(omniSub.balloon, 0, 0, 63).magnitudeDb;
    const omniRear = sampleDirectivityBalloon(omniSub.balloon, 180, 0, 63).magnitudeDb;
    expect(Math.abs(omniFront - omniRear)).toBeLessThan(1.0);

    const cardSub = buildSpeakerFromSpec({
      name: 'Cardioid Sub',
      category: 'subwoofer',
      lfPattern: 'cardioid',
      low3dBHz: 35,
      high3dBHz: 110,
      maxContinuousSpl1mDb: 133,
    });
    const cardFront = sampleDirectivityBalloon(cardSub.balloon, 0, 0, 63).magnitudeDb;
    const cardRear = sampleDirectivityBalloon(cardSub.balloon, 180, 0, 63).magnitudeDb;
    expect(cardFront - cardRear).toBeGreaterThan(15);
  });
});

