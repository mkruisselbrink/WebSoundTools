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
 * Built-in Demo Venue Presets (`src/library/demo-presets.ts`).
 */

import { DEFAULT_ATMOSPHERE } from '@foh/acoustics';
import { DEFAULT_SOURCE_DSP_CONFIG } from '@foh/dsp';
import type { ProjectScene } from '../model/project-types.js';
import { DEFAULT_GROUND_REFLECTOR } from '../physics/transform3d.js';

export interface DemoVenuePreset {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly createScene: () => ProjectScene;
}

export const DEMO_VENUE_PRESETS: readonly DemoVenuePreset[] = [
  {
    id: 'club-cardioid-pa',
    name: 'Live Club — 12" Mains + Cardioid Subs + Front Fills',
    summary:
      '18 m × 12 m standing music club with flown 12" L/R tops, center 2-pair cardioid 18" subwoofer array, 8" stage-lip front fills, and stage vocal rejection zone.',
    createScene: () => ({
      id: 'club-cardioid-pa',
      name: 'Live Club — 12" Mains + Cardioid Subs + Front Fills',
      driveOffsetDb: -6,
      atmosphere: { ...DEFAULT_ATMOSPHERE },
      reflectors: [{ ...DEFAULT_GROUND_REFLECTOR, reflectionFactor: 0.9, enabled: true }],
      bandSelection: {
        kind: 'band-average',
        label: 'Broadband Pink (A-Weighted)',
        minHz: 31.5,
        maxHz: 16000,
        weighting: 'A',
        spectrumShape: 'pink',
      },
      planBounds: { xMin: -5, xMax: 20, yMin: -7, yMax: 7 },
      sectionBounds: { xMin: -5, xMax: 20, zMin: 0, zMax: 6, sliceYM: 0 },
      defaultListenerHeightM: 1.65,
      surfaces: [
        {
          id: 'surf-floor',
          name: 'Main Standing Floor',
          role: 'audience',
          enabled: true,
          xStart: 1.5,
          xEnd: 18.5,
          yCenter: 0,
          widthStart: 12,
          widthEnd: 12,
          zStart: 0,
          zEnd: 0,
          earHeightM: 1.65,
        },
        {
          id: 'surf-stage',
          name: 'Stage Deck',
          role: 'stage',
          enabled: true,
          xStart: -4.2,
          xEnd: -0.8,
          yCenter: 0,
          widthStart: 9,
          widthEnd: 9,
          zStart: 0.9,
          zEnd: 0.9,
          earHeightM: 1.55,
        },
      ],
      dspGroups: [
        {
          id: 'grp-mains',
          name: 'Main L/R Tops',
          color: '#38bdf8',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: 0,
            delayMs: 1.8,
            highPass: { topology: 'linkwitz-riley-24', frequencyHz: 90 },
          },
        },
        {
          id: 'grp-fills',
          name: 'Front Fills',
          color: '#10b981',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: -6,
            delayMs: 3.4,
            highPass: { topology: 'linkwitz-riley-24', frequencyHz: 100 },
          },
        },
        {
          id: 'grp-subs',
          name: 'Cardioid Sub Array',
          color: '#f59e0b',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: 3,
            delayMs: 0,
            highPass: { topology: 'butterworth-24', frequencyHz: 32 },
            lowPass: { topology: 'linkwitz-riley-24', frequencyHz: 90 },
          },
        },
      ],
      pointSources: [
        {
          id: 'ps-main-l',
          name: 'Main L',
          speakerId: 'builtin-top-12-90x60',
          dspGroupId: 'grp-mains',
          position: { x: 0.4, y: 4.5, z: 3.8 },
          orientation: { azimuthDeg: -12, tiltDeg: -11, rollDeg: 0 },
          mirrorLeftRight: true,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
        {
          id: 'ps-fill-l',
          name: 'Front Fill L',
          speakerId: 'builtin-top-8-90x70',
          dspGroupId: 'grp-fills',
          position: { x: 0.1, y: 1.6, z: 1.05 },
          orientation: { azimuthDeg: 0, tiltDeg: 4, rollDeg: 90 },
          mirrorLeftRight: true,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
      ],
      subArrays: [
        {
          id: 'sa-center-cardioid',
          name: 'Center Cardioid Subs',
          speakerId: 'builtin-sub-18-reflex',
          dspGroupId: 'grp-subs',
          mode: 'cardioid-csa',
          boxCount: 4,
          origin: { x: 0.5, y: 0, z: 0.35 },
          azimuthDeg: 0,
          spacingM: 1.4,
          cardioidDepthOffsetM: 0.85,
          tuningFrequencyHz: 63,
          arcAngleDeg: 60,
          muted: false,
        },
      ],
      virtualMics: [
        {
          id: 'mic-foh',
          name: 'FOH Mix Position',
          color: '#38bdf8',
          position: { x: 13.5, y: 0, z: 1.65 },
          enabled: true,
        },
        {
          id: 'mic-front',
          name: 'Front Row Center',
          color: '#10b981',
          position: { x: 2.5, y: 0, z: 1.65 },
          enabled: true,
        },
        {
          id: 'mic-stage-vox',
          name: 'Downstage Vocal Mic',
          color: '#ef4444',
          position: { x: -1.5, y: 0, z: 2.45 },
          enabled: true,
        },
      ],
    }),
  },
  {
    id: 'festival-endfire-delays',
    name: 'Outdoor Field — 15" Mains + End-Fire Subs + Delay Ring',
    summary:
      '55 m × 30 m outdoor festival field with long-throw 15" mains, 4-deep end-fire dual-18" subs, and time-aligned 12" delay towers at 26 m.',
    createScene: () => ({
      id: 'festival-endfire-delays',
      name: 'Outdoor Field — 15" Mains + End-Fire Subs + Delay Ring',
      driveOffsetDb: -3,
      atmosphere: {
        temperatureCelsius: 26,
        relativeHumidityPercent: 45,
        pressureKpa: 101.325,
      },
      reflectors: [{ ...DEFAULT_GROUND_REFLECTOR, reflectionFactor: 0.75, enabled: true }],
      bandSelection: {
        kind: 'band-average',
        label: 'Broadband Music (A-Weighted)',
        minHz: 31.5,
        maxHz: 16000,
        weighting: 'A',
        spectrumShape: 'music',
      },
      planBounds: { xMin: -8, xMax: 56, yMin: -18, yMax: 18 },
      sectionBounds: { xMin: -8, xMax: 56, zMin: 0, zMax: 10, sliceYM: 0 },
      defaultListenerHeightM: 1.65,
      surfaces: [
        {
          id: 'surf-field',
          name: 'Festival Audience Field',
          role: 'audience',
          enabled: true,
          xStart: 3,
          xEnd: 52,
          yCenter: 0,
          widthStart: 24,
          widthEnd: 32,
          zStart: 0,
          zEnd: 0,
          earHeightM: 1.65,
        },
        {
          id: 'surf-stage',
          name: 'Festival Stage',
          role: 'stage',
          enabled: true,
          xStart: -7,
          xEnd: -1.0,
          yCenter: 0,
          widthStart: 14,
          widthEnd: 14,
          zStart: 1.4,
          zEnd: 1.4,
          earHeightM: 1.6,
        },
      ],
      dspGroups: [
        {
          id: 'grp-mains',
          name: 'Main 15" L/R',
          color: '#38bdf8',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: 0,
            delayMs: 9.2,
            highPass: { topology: 'linkwitz-riley-24', frequencyHz: 80 },
          },
        },
        {
          id: 'grp-delays',
          name: '26 m Delay Towers',
          color: '#a855f7',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: -3,
            delayMs: 84.5,
            highPass: { topology: 'butterworth-24', frequencyHz: 85 },
          },
        },
        {
          id: 'grp-subs',
          name: 'End-Fire Dual-18" Subs',
          color: '#f59e0b',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: 2,
            delayMs: 0,
            highPass: { topology: 'butterworth-24', frequencyHz: 30 },
            lowPass: { topology: 'linkwitz-riley-24', frequencyHz: 80 },
          },
        },
      ],
      pointSources: [
        {
          id: 'ps-main-l',
          name: 'Main Hang L',
          speakerId: 'builtin-top-15-60x40',
          dspGroupId: 'grp-mains',
          position: { x: 0.5, y: 8.0, z: 6.2 },
          orientation: { azimuthDeg: -10, tiltDeg: -9, rollDeg: 0 },
          mirrorLeftRight: true,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
        {
          id: 'ps-delay-l',
          name: 'Delay Tower L',
          speakerId: 'builtin-top-12-90x60',
          dspGroupId: 'grp-delays',
          position: { x: 26, y: 11, z: 5.2 },
          orientation: { azimuthDeg: -12, tiltDeg: -10, rollDeg: 0 },
          mirrorLeftRight: true,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
      ],
      subArrays: [
        {
          id: 'sa-endfire-c',
          name: 'Center 4-Deep End-Fire Subs',
          speakerId: 'builtin-sub-218-reflex',
          dspGroupId: 'grp-subs',
          mode: 'end-fire',
          boxCount: 4,
          origin: { x: 0.4, y: 0, z: 0.3 },
          azimuthDeg: 0,
          spacingM: 1.25,
          cardioidDepthOffsetM: 0.85,
          tuningFrequencyHz: 68,
          arcAngleDeg: 70,
          muted: false,
        },
      ],
      virtualMics: [
        {
          id: 'mic-foh',
          name: 'FOH Tent (24 m)',
          color: '#38bdf8',
          position: { x: 24, y: 0, z: 1.65 },
          enabled: true,
        },
        {
          id: 'mic-rear',
          name: 'Rear Field (42 m)',
          color: '#a855f7',
          position: { x: 42, y: 3, z: 1.65 },
          enabled: true,
        },
      ],
    }),
  },
  {
    id: 'theater-raked-balcony',
    name: 'Raked Auditorium & Balcony — Multi-Tier Point Sources',
    summary:
      '26 m raked theater with sloped orchestra seating, elevated balcony tier, upper balcony delay fills, and broadside electronic-arc subwoofers.',
    createScene: () => ({
      id: 'theater-raked-balcony',
      name: 'Raked Auditorium & Balcony — Multi-Tier Point Sources',
      driveOffsetDb: -8,
      atmosphere: { ...DEFAULT_ATMOSPHERE },
      reflectors: [{ ...DEFAULT_GROUND_REFLECTOR, reflectionFactor: 0.85, enabled: true }],
      bandSelection: {
        kind: 'band-average',
        label: 'Broadband Pink (A-Weighted)',
        minHz: 40,
        maxHz: 16000,
        weighting: 'A',
        spectrumShape: 'pink',
      },
      planBounds: { xMin: -5, xMax: 28, yMin: -10, yMax: 10 },
      sectionBounds: { xMin: -5, xMax: 28, zMin: 0, zMax: 10, sliceYM: 3.5 },
      defaultListenerHeightM: 1.2,
      surfaces: [
        {
          id: 'surf-orchestra',
          name: 'Raked Orchestra Seating',
          role: 'audience',
          enabled: true,
          xStart: 2.0,
          xEnd: 24.0,
          yCenter: 0,
          widthStart: 14,
          widthEnd: 18,
          zStart: 0.0,
          zEnd: 2.6,
          earHeightM: 1.2,
        },
        {
          id: 'surf-balcony',
          name: 'Upper Balcony Tier',
          role: 'audience',
          enabled: true,
          xStart: 15.0,
          xEnd: 26.0,
          yCenter: 0,
          widthStart: 17,
          widthEnd: 18,
          zStart: 4.8,
          zEnd: 7.0,
          earHeightM: 1.2,
        },
        {
          id: 'surf-stage',
          name: 'Theater Stage',
          role: 'stage',
          enabled: true,
          xStart: -4.5,
          xEnd: -0.8,
          yCenter: 0,
          widthStart: 12,
          widthEnd: 12,
          zStart: 0.8,
          zEnd: 0.8,
          earHeightM: 1.5,
        },
      ],
      dspGroups: [
        {
          id: 'grp-proscenium',
          name: 'Proscenium Mains',
          color: '#38bdf8',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: 0,
            delayMs: 0,
            highPass: { topology: 'linkwitz-riley-24', frequencyHz: 85 },
          },
        },
        {
          id: 'grp-balcony-fills',
          name: 'Balcony Delay Fills',
          color: '#22c55e',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: -5,
            delayMs: 41.0,
            highPass: { topology: 'butterworth-24', frequencyHz: 95 },
          },
        },
        {
          id: 'grp-arc-subs',
          name: 'Electronic Arc Subs',
          color: '#f59e0b',
          dsp: {
            ...DEFAULT_SOURCE_DSP_CONFIG,
            gainDb: 0,
            delayMs: 0,
            highPass: { topology: 'butterworth-24', frequencyHz: 35 },
            lowPass: { topology: 'linkwitz-riley-24', frequencyHz: 85 },
          },
        },
      ],
      pointSources: [
        {
          id: 'ps-pros-l',
          name: 'Proscenium L',
          speakerId: 'builtin-top-12-90x60',
          dspGroupId: 'grp-proscenium',
          position: { x: 0.2, y: 6.2, z: 5.4 },
          orientation: { azimuthDeg: -14, tiltDeg: -13, rollDeg: 0 },
          mirrorLeftRight: true,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
        {
          id: 'ps-balc-l',
          name: 'Balcony Delay L',
          speakerId: 'builtin-top-10-90x60',
          dspGroupId: 'grp-balcony-fills',
          position: { x: 14.2, y: 5.0, z: 7.8 },
          orientation: { azimuthDeg: -8, tiltDeg: -12, rollDeg: 0 },
          mirrorLeftRight: true,
          trimGainDb: 0,
          trimDelayMs: 0,
          invertPolarity: false,
          muted: false,
        },
      ],
      subArrays: [
        {
          id: 'sa-arc',
          name: 'Under-Stage Delay Arc Subs',
          speakerId: 'builtin-sub-18-reflex',
          dspGroupId: 'grp-arc-subs',
          mode: 'delay-arc',
          boxCount: 6,
          origin: { x: 0.2, y: 0, z: 0.35 },
          azimuthDeg: 0,
          spacingM: 1.5,
          cardioidDepthOffsetM: 0.8,
          tuningFrequencyHz: 63,
          arcAngleDeg: 85,
          muted: false,
        },
      ],
      virtualMics: [
        {
          id: 'mic-orch-mid',
          name: 'Orchestra Center (12 m)',
          color: '#38bdf8',
          position: { x: 12, y: 0, z: 2.38 },
          enabled: true,
        },
        {
          id: 'mic-balcony',
          name: 'Balcony Row D (20 m)',
          color: '#22c55e',
          position: { x: 20, y: 3.5, z: 7.0 },
          enabled: true,
        },
      ],
    }),
  },
];

export function getDemoPresetById(id: string): DemoVenuePreset {
  return DEMO_VENUE_PRESETS.find((p) => p.id === id) ?? DEMO_VENUE_PRESETS[0];
}
