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
 * Core project scene types: audience surfaces, point sources, subwoofer arrays,
 * DSP groups, virtual measurement microphones, and simulation settings (`src/model/project-types.ts`).
 */

import type { AtmosphericConditions, FrequencyWeighting } from '../physics/atmosphere.js';
import type { SourceDspConfig } from '../physics/biquad.js';
import type { EulerOrientationDeg, PlanarReflector, Vec3 } from '../physics/transform3d.js';

export type SurfaceRole = 'audience' | 'stage';

/**
 * Trapezoidal / rectangular 3D planar surface along +X (supports flat floors, raked seating,
 * elevated balconies, and stage rejection zones).
 */
export interface AudienceSurface {
  readonly id: string;
  readonly name: string;
  readonly role: SurfaceRole;
  readonly enabled: boolean;
  /** Start X coordinate in meters. */
  readonly xStart: number;
  /** End X coordinate in meters (must be > xStart). */
  readonly xEnd: number;
  /** Lateral center Y coordinate in meters (0 = venue centerline). */
  readonly yCenter: number;
  /** Total lateral width along Y at xStart in meters. */
  readonly widthStart: number;
  /** Total lateral width along Y at xEnd in meters. */
  readonly widthEnd: number;
  /** Floor/deck elevation Z at xStart in meters. */
  readonly zStart: number;
  /** Floor/deck elevation Z at xEnd in meters. */
  readonly zEnd: number;
  /** Listener ear height above the surface deck in meters (e.g. 1.65 standing, 1.20 seated). */
  readonly earHeightM: number;
}

export interface DspGroup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly dsp: SourceDspConfig;
}

export interface PointSourceInstance {
  readonly id: string;
  readonly name: string;
  readonly speakerId: string;
  readonly dspGroupId: string;
  readonly position: Vec3;
  readonly orientation: EulerOrientationDeg;
  /** When true, automatically spawns a symmetric counterpart across Y = 0 (at -y, -azimuthDeg, -rollDeg). */
  readonly mirrorLeftRight: boolean;
  readonly trimGainDb: number;
  readonly trimDelayMs: number;
  readonly invertPolarity: boolean;
  readonly muted: boolean;
}

export type SubArrayMode = 'broadside' | 'cardioid-csa' | 'end-fire' | 'delay-arc';

export interface SubArrayInstance {
  readonly id: string;
  readonly name: string;
  readonly speakerId: string;
  readonly dspGroupId: string;
  readonly mode: SubArrayMode;
  /** Total number of subwoofer enclosures in the array (1..24). */
  readonly boxCount: number;
  /** Array reference center position in world meters. */
  readonly origin: Vec3;
  /** Array throw azimuth in degrees (0 = +X). */
  readonly azimuthDeg: number;
  /** Lateral center-to-center spacing (broadside/arc/cardioid stacks) or longitudinal spacing (end-fire) in meters. */
  readonly spacingM: number;
  /** Front-to-rear acoustic center offset in meters for cardioid-csa mode (e.g. 0.75 m). */
  readonly cardioidDepthOffsetM: number;
  /** Target cancellation/alignment frequency in Hz for end-fire / cardioid presets (e.g. 63 Hz). */
  readonly tuningFrequencyHz: number;
  /** Desired horizontal coverage splay angle in degrees for delay-arc mode (e.g. 90 deg). */
  readonly arcAngleDeg: number;
  readonly muted: boolean;
}

export interface VirtualMicInstance {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly position: Vec3;
  readonly enabled: boolean;
}

export type AnalysisBandSelection =
  | {
      readonly kind: 'single';
      readonly frequencyHz: number;
    }
  | {
      readonly kind: 'band-average';
      readonly label: string;
      readonly minHz: number;
      readonly maxHz: number;
      readonly weighting: FrequencyWeighting;
      /** Spectral stimulus shape: 'pink' = flat energy per 1/3-octave band, 'music' = -3 dB/oct above 2 kHz + +3 dB sub contour. */
      readonly spectrumShape: 'pink' | 'music';
    };

export interface ViewportBounds2D {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface SectionBounds2D {
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
  /** Lateral Y coordinate sliced by the Side Section view in meters. */
  readonly sliceYM: number;
}

export interface ProjectScene {
  readonly id: string;
  readonly name: string;
  /** Global drive headroom offset below each enclosure's maxContinuousSpl1mDb (e.g. -6 dB nominal operating level). */
  readonly driveOffsetDb: number;
  readonly atmosphere: AtmosphericConditions;
  readonly reflectors: readonly PlanarReflector[];
  readonly bandSelection: AnalysisBandSelection;
  readonly planBounds: ViewportBounds2D;
  readonly sectionBounds: SectionBounds2D;
  readonly defaultListenerHeightM: number;
  readonly surfaces: readonly AudienceSurface[];
  readonly dspGroups: readonly DspGroup[];
  readonly pointSources: readonly PointSourceInstance[];
  readonly subArrays: readonly SubArrayInstance[];
  readonly virtualMics: readonly VirtualMicInstance[];
}

/**
 * Evaluates listener ear Z elevation at world `(x, y)` if `(x, y)` lies inside `surface`'s
 * horizontal projection, or returns `null` if outside.
 */
export function evaluateSurfaceListenerZ(
  surface: AudienceSurface,
  x: number,
  y: number
): number | null {
  if (!surface.enabled) return null;
  const xMin = Math.min(surface.xStart, surface.xEnd);
  const xMax = Math.max(surface.xStart, surface.xEnd);
  if (x < xMin || x > xMax) {
    return null;
  }

  const span = surface.xEnd - surface.xStart;
  const u = Math.abs(span) > 1e-9 ? (x - surface.xStart) / span : 0;
  const widthAtX = surface.widthStart + (surface.widthEnd - surface.widthStart) * u;
  const halfWidth = Math.max(0, widthAtX * 0.5);

  if (Math.abs(y - surface.yCenter) > halfWidth) {
    return null;
  }

  const deckZ = surface.zStart + (surface.zEnd - surface.zStart) * u;
  return deckZ + surface.earHeightM;
}
