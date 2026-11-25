// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Broadband weighted contours, subband average, and ISO 1/1-octave single-band
 * options for the `<wss-topbar>` frequency selector.
 */

import type { AnalysisBandSelection } from '../../model/project-types.js';

export const SINGLE_BAND_FREQUENCIES_HZ = [
  31.5, 63, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

export type SingleBandHz = (typeof SINGLE_BAND_FREQUENCIES_HZ)[number];

export type BandOptionKey =
  | 'pink-A'
  | 'pink-C'
  | 'pink-Z'
  | 'music-A'
  | 'music-C'
  | 'sub-band'
  | `hz-${SingleBandHz}`;

export interface BandOptionEntry {
  readonly key: BandOptionKey;
  readonly label: string;
  readonly selection: AnalysisBandSelection;
}

export const ANALYSIS_BAND_OPTIONS: readonly BandOptionEntry[] = [
  {
    key: 'pink-A',
    label: 'Broadband Pink (dBA)',
    selection: {
      kind: 'band-average',
      label: 'Broadband Pink (A-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'A',
      spectrumShape: 'pink',
    },
  },
  {
    key: 'pink-C',
    label: 'Broadband Pink (dBC)',
    selection: {
      kind: 'band-average',
      label: 'Broadband Pink (C-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'C',
      spectrumShape: 'pink',
    },
  },
  {
    key: 'pink-Z',
    label: 'Broadband Pink (dBZ)',
    selection: {
      kind: 'band-average',
      label: 'Broadband Pink (Z-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'Z',
      spectrumShape: 'pink',
    },
  },
  {
    key: 'music-A',
    label: 'Live Music Contour (dBA)',
    selection: {
      kind: 'band-average',
      label: 'Live Music Contour (A-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'A',
      spectrumShape: 'music',
    },
  },
  {
    key: 'music-C',
    label: 'Live Music Contour (dBC)',
    selection: {
      kind: 'band-average',
      label: 'Live Music Contour (C-Weighted)',
      minHz: 31.5,
      maxHz: 16000,
      weighting: 'C',
      spectrumShape: 'music',
    },
  },
  {
    key: 'sub-band',
    label: 'Subband Average (31.5–100 Hz dBC)',
    selection: {
      kind: 'band-average',
      label: 'Subband (31.5–100 Hz dBC)',
      minHz: 31.5,
      maxHz: 100,
      weighting: 'C',
      spectrumShape: 'pink',
    },
  },
  ...SINGLE_BAND_FREQUENCIES_HZ.map(
    (hz): BandOptionEntry => ({
      key: `hz-${hz}`,
      label: `${hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`} (Single Band)`,
      selection: { kind: 'single', frequencyHz: hz },
    })
  ),
];

export function matchBandOptionKey(sel: AnalysisBandSelection): string {
  if (sel.kind === 'single') {
    const exact = ANALYSIS_BAND_OPTIONS.find(
      (o) => o.selection.kind === 'single' && o.selection.frequencyHz === sel.frequencyHz
    );
    return exact ? exact.key : 'hz-1000';
  }
  if (sel.maxHz <= 125) {
    return 'sub-band';
  }
  return `${sel.spectrumShape}-${sel.weighting}`;
}
