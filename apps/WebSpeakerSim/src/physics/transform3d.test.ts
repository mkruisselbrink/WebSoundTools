// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUND_REFLECTOR,
  MIN_PROPAGATION_DISTANCE_M,
  buildOrientationMatrix,
  computeLocalDirection,
  getForwardAxis,
  localToWorldVec3,
  reflectPoseAcrossPlane,
} from './transform3d.js';

describe('transform3d', () => {
  it('preserves identity orientation for zero Euler angles', () => {
    const basis = buildOrientationMatrix({ azimuthDeg: 0, tiltDeg: 0, rollDeg: 0 });
    const fwd = getForwardAxis(basis);
    expect(fwd.x).toBeCloseTo(1, 6);
    expect(fwd.y).toBeCloseTo(0, 6);
    expect(fwd.z).toBeCloseTo(0, 6);

    const up = localToWorldVec3(basis, { x: 0, y: 0, z: 1 });
    expect(up.z).toBeCloseTo(1, 6);
  });

  it('points local +x_L downward (-Z) when tiltDeg is negative', () => {
    const basis = buildOrientationMatrix({ azimuthDeg: 0, tiltDeg: -15, rollDeg: 0 });
    const fwd = getForwardAxis(basis);
    expect(fwd.x).toBeCloseTo(Math.cos((15 * Math.PI) / 180), 6);
    expect(fwd.y).toBeCloseTo(0, 6);
    expect(fwd.z).toBeCloseTo(-Math.sin((15 * Math.PI) / 180), 6);

    // Receptor directly along tilted aim line should read 0 deg polar off-axis
    const sample = computeLocalDirection(
      { x: 0, y: 0, z: 4 },
      basis,
      { x: 10 * fwd.x, y: 0, z: 4 + 10 * fwd.z }
    );
    expect(sample.polarDeg).toBeCloseTo(0, 5);
    expect(sample.horizontalDeg).toBeCloseTo(0, 5);
    expect(sample.verticalDeg).toBeCloseTo(0, 5);
    expect(sample.distanceM).toBeCloseTo(10, 5);
  });

  it('rotates azimuth toward Stage Left (+Y) and swaps H/V dispersion planes on 90 deg roll', () => {
    const panLeft = buildOrientationMatrix({ azimuthDeg: 30, tiltDeg: 0, rollDeg: 0 });
    const fwd = getForwardAxis(panLeft);
    expect(fwd.x).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(fwd.y).toBeCloseTo(Math.sin(Math.PI / 6), 6);

    // Roll = 90 deg rotates enclosure +y_L into +z_w and +z_L into -y_w
    const rolled = buildOrientationMatrix({ azimuthDeg: 0, tiltDeg: 0, rollDeg: 90 });
    // Target displaced laterally to +Y (world left) now appears in the enclosure's -z_L plane (vertical -45 deg)
    const sample = computeLocalDirection({ x: 0, y: 0, z: 2 }, rolled, { x: 5, y: 5, z: 2 });
    expect(sample.polarDeg).toBeCloseTo(45, 5);
    expect(Math.abs(sample.verticalDeg)).toBeCloseTo(45, 5);
    expect(sample.horizontalDeg).toBeCloseTo(0, 5);
  });

  it('clamps near-field distance to MIN_PROPAGATION_DISTANCE_M while keeping rawDistanceM', () => {
    const basis = buildOrientationMatrix({ azimuthDeg: 0, tiltDeg: 0, rollDeg: 0 });
    const sample = computeLocalDirection({ x: 1, y: 2, z: 3 }, basis, { x: 1.05, y: 2, z: 3 });
    expect(sample.rawDistanceM).toBeCloseTo(0.05, 6);
    expect(sample.distanceM).toBe(MIN_PROPAGATION_DISTANCE_M);
  });

  it('mirrors pose across ground plane so image-source local direction equals physical bounce departure angle', () => {
    const sourcePos = { x: 0, y: 0, z: 3 };
    const basis = buildOrientationMatrix({ azimuthDeg: 10, tiltDeg: -8, rollDeg: 0 });
    const receptor = { x: 12, y: 2, z: 1.6 };

    const reflected = reflectPoseAcrossPlane(sourcePos, basis, DEFAULT_GROUND_REFLECTOR);
    expect(reflected.position.x).toBeCloseTo(0, 6);
    expect(reflected.position.y).toBeCloseTo(0, 6);
    expect(reflected.position.z).toBeCloseTo(-3, 6);

    // Physical bounce point on z = 0 occurs at fraction t = z_s / (z_s + z_r) = 3 / 4.6 along XY
    const t = sourcePos.z / (sourcePos.z + receptor.z);
    const bouncePoint = {
      x: sourcePos.x + t * (receptor.x - sourcePos.x),
      y: sourcePos.y + t * (receptor.y - sourcePos.y),
      z: 0,
    };

    const physicalDeparture = computeLocalDirection(sourcePos, basis, bouncePoint);
    const imageDirection = computeLocalDirection(reflected.position, reflected.basis, receptor);

    expect(imageDirection.polarDeg).toBeCloseTo(physicalDeparture.polarDeg, 5);
    expect(imageDirection.meridianDeg).toBeCloseTo(physicalDeparture.meridianDeg, 5);
    expect(imageDirection.horizontalDeg).toBeCloseTo(physicalDeparture.horizontalDeg, 5);
    expect(imageDirection.verticalDeg).toBeCloseTo(physicalDeparture.verticalDeg, 5);
    // Total specular path length equals ||s - b|| + ||r - b||
    const seg1 = Math.hypot(
      bouncePoint.x - sourcePos.x,
      bouncePoint.y - sourcePos.y,
      bouncePoint.z - sourcePos.z
    );
    const seg2 = Math.hypot(
      receptor.x - bouncePoint.x,
      receptor.y - bouncePoint.y,
      receptor.z - bouncePoint.z
    );
    expect(imageDirection.rawDistanceM).toBeCloseTo(seg1 + seg2, 6);
  });
});

