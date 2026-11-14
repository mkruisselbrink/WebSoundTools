// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * 3D right-handed Cartesian geometry, loudspeaker Euler orientation matrices,
 * local spherical balloon coordinates, and planar image-source reflection (`src/physics/transform3d.ts`).
 *
 * Coordinate convention:
 *   +X: Stage-to-audience depth (throw direction)
 *   +Y: Stage Left (audience right when facing stage); Y = 0 is venue centerline
 *   +Z: Vertical elevation upward from reference datum Z = 0
 *
 * Loudspeaker local frame:
 *   +x_L: On-axis acoustic radiation vector
 *   +y_L: Enclosure left (looking outward from grille)
 *   +z_L: Enclosure top
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const MIN_PROPAGATION_DISTANCE_M = 0.25;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EulerOrientationDeg {
  /** Yaw around +Z in degrees (0 = +X, +90 = +Y Stage Left, -90 = -Y Stage Right). */
  readonly azimuthDeg: number;
  /** Pitch in degrees (0 = horizontal, negative = downward tilt toward floor, positive = upward). */
  readonly tiltDeg: number;
  /** Roll around local +x_L axis in degrees (0 = upright, 90 = rotated onto side). */
  readonly rollDeg: number;
}

/** Row-major 3x3 matrix [r00, r01, r02, r10, r11, r12, r20, r21, r22]. */
export type Mat3 = Float64Array;

export interface PlanarReflector {
  readonly id: string;
  /** Outward unit normal pointing into the acoustic half-space (e.g., (0, 0, 1) for floor Z = 0). */
  readonly normal: Vec3;
  /** Plane offset d in normal · x = d. */
  readonly offset: number;
  /** Acoustic pressure reflection coefficient in [0, 1] (e.g., 0.95 concrete, 0.75 turf). */
  readonly reflectionFactor: number;
  readonly enabled: boolean;
}

export interface LocalDirectionSample {
  /** Euclidean distance ||r - s|| in meters (clamped to MIN_PROPAGATION_DISTANCE_M). */
  readonly distanceM: number;
  /** True unclamped Euclidean distance ||r - s|| in meters. */
  readonly rawDistanceM: number;
  /** Off-axis polar angle beta in [0, 180] degrees from local +x_L. */
  readonly polarDeg: number;
  /** Meridian roll angle gamma in [0, 360) degrees around +x_L (0 = +y_L left, 90 = +z_L top, 180 = -y_L right, 270 = -z_L bottom). */
  readonly meridianDeg: number;
  /** Horizontal off-axis angle atan2(y_L, x_L) in [-180, 180] degrees. */
  readonly horizontalDeg: number;
  /** Vertical off-axis angle atan2(z_L, x_L) in [-180, 180] degrees. */
  readonly verticalDeg: number;
}

export interface ReflectedPose {
  readonly position: Vec3;
  readonly basis: Mat3;
}

export function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-12) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Builds the local-to-world 3x3 orthogonal matrix R = R_z(azimuth) * R_y(-tilt) * R_x(roll).
 * Negative `tiltDeg` points local +x_L downward (-Z), matching standard rigging tilt conventions.
 */
export function buildOrientationMatrix(orientation: EulerOrientationDeg, out?: Mat3): Mat3 {
  const m = out ?? new Float64Array(9);
  const az = orientation.azimuthDeg * DEG_TO_RAD;
  const tilt = orientation.tiltDeg * DEG_TO_RAD;
  const roll = orientation.rollDeg * DEG_TO_RAD;

  const cz = Math.cos(az);
  const sz = Math.sin(az);
  // Let alpha = -tilt so tilt < 0 gives sin(alpha) > 0 and z_w = -sin(alpha) = sin(tilt) < 0.
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt); // sin(tilt): negative when tilting down
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  // R_p (pitch by tilt where +x_L -> (ct, 0, st), +y_L -> (0, 1, 0), +z_L -> (-st, 0, ct)):
  // R_p * R_x(roll):
  //   [ ct,  -st*sr, -st*cr ]
  //   [  0,      cr,    -sr ]
  //   [ st,   ct*sr,  ct*cr ]
  // Left-multiply by R_z(az):
  m[0] = cz * ct;
  m[1] = -cz * st * sr - sz * cr;
  m[2] = -cz * st * cr + sz * sr;

  m[3] = sz * ct;
  m[4] = -sz * st * sr + cz * cr;
  m[5] = -sz * st * cr - cz * sr;

  m[6] = st;
  m[7] = ct * sr;
  m[8] = ct * cr;

  return m;
}

/** Transforms a local-frame vector into world coordinates: v_w = R * v_L. */
export function localToWorldVec3(basis: Mat3, local: Vec3): Vec3 {
  return {
    x: basis[0] * local.x + basis[1] * local.y + basis[2] * local.z,
    y: basis[3] * local.x + basis[4] * local.y + basis[5] * local.z,
    z: basis[6] * local.x + basis[7] * local.y + basis[8] * local.z,
  };
}

/** Returns the world-space on-axis unit aiming vector (+x_L) for a basis matrix. */
export function getForwardAxis(basis: Mat3): Vec3 {
  return { x: basis[0], y: basis[3], z: basis[6] };
}

/**
 * Projects world displacement (receptor - source) into the loudspeaker's local frame (R^T * d_w)
 * and extracts spherical balloon lookup angles (polarDeg, meridianDeg) and H/V plane angles.
 */
export function computeLocalDirection(
  sourcePos: Vec3,
  sourceBasis: Mat3,
  receptorPos: Vec3
): LocalDirectionSample {
  const dx = receptorPos.x - sourcePos.x;
  const dy = receptorPos.y - sourcePos.y;
  const dz = receptorPos.z - sourcePos.z;

  const rawDistanceM = Math.hypot(dx, dy, dz);
  const distanceM = Math.max(MIN_PROPAGATION_DISTANCE_M, rawDistanceM);

  if (rawDistanceM < 1e-9) {
    return {
      distanceM,
      rawDistanceM,
      polarDeg: 0,
      meridianDeg: 0,
      horizontalDeg: 0,
      verticalDeg: 0,
    };
  }

  // d_L = R^T * d_w (columns of R dotted with d_w)
  const xL = sourceBasis[0] * dx + sourceBasis[3] * dy + sourceBasis[6] * dz;
  const yL = sourceBasis[1] * dx + sourceBasis[4] * dy + sourceBasis[7] * dz;
  const zL = sourceBasis[2] * dx + sourceBasis[5] * dy + sourceBasis[8] * dz;

  const cosBeta = Math.max(-1, Math.min(1, xL / rawDistanceM));
  const polarDeg = Math.acos(cosBeta) * RAD_TO_DEG;

  let meridianDeg = Math.atan2(zL, yL) * RAD_TO_DEG;
  if (meridianDeg < 0) {
    meridianDeg += 360;
  }

  const horizontalDeg = Math.atan2(yL, xL) * RAD_TO_DEG;
  const verticalDeg = Math.atan2(zL, xL) * RAD_TO_DEG;

  return {
    distanceM,
    rawDistanceM,
    polarDeg,
    meridianDeg,
    horizontalDeg,
    verticalDeg,
  };
}

/**
 * Mirrors a source position and local-to-world basis across a planar boundary (n · x = offset)
 * via Householder reflection M = I - 2 n n^T:
 *   s' = s - 2 (n · s - offset) n
 *   R' = M * R
 * Evaluating R'^T * (r - s') identically yields R^T * M * (r - s'), the exact local departure
 * angle of the physical ray striking the boundary en route to receptor r.
 */
export function reflectPoseAcrossPlane(
  sourcePos: Vec3,
  sourceBasis: Mat3,
  plane: Pick<PlanarReflector, 'normal' | 'offset'>,
  outBasis?: Mat3
): ReflectedPose {
  const n = normalizeVec3(plane.normal);
  const signedDist = n.x * sourcePos.x + n.y * sourcePos.y + n.z * sourcePos.z - plane.offset;

  const position: Vec3 = {
    x: sourcePos.x - 2 * signedDist * n.x,
    y: sourcePos.y - 2 * signedDist * n.y,
    z: sourcePos.z - 2 * signedDist * n.z,
  };

  const basis = outBasis ?? new Float64Array(9);
  // For each column j in {0, 1, 2}, col'_j = col_j - 2 * (n · col_j) * n
  for (let col = 0; col < 3; col++) {
    const cx = sourceBasis[col];
    const cy = sourceBasis[3 + col];
    const cz = sourceBasis[6 + col];
    const dot = n.x * cx + n.y * cy + n.z * cz;
    basis[col] = cx - 2 * dot * n.x;
    basis[3 + col] = cy - 2 * dot * n.y;
    basis[6 + col] = cz - 2 * dot * n.z;
  }

  return { position, basis };
}

/** Default hard ground reflector at Z = 0. */
export const DEFAULT_GROUND_REFLECTOR: PlanarReflector = {
  id: 'ground-plane',
  normal: { x: 0, y: 0, z: 1 },
  offset: 0,
  reflectionFactor: 0.9,
  enabled: true,
};

