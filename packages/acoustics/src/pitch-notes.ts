// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * ISO 31-band label formatting, nearest graphic EQ band lookup, and musical pitch/cents mapping.
 */

import { ISO_31_BAND_FREQUENCIES_HZ } from './iso-bands.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Formats an ISO 31-band center frequency as a compact engineer-friendly label (e.g. "2.5 kHz", "630 Hz").
 */
export function formatIsoBandLabel(isoHz: number): string {
  if (isoHz >= 1000) {
    const k = isoHz / 1000;
    return Number.isInteger(k) ? `${k} kHz` : `${Number(k.toFixed(2))} kHz`;
  }
  return `${isoHz} Hz`;
}

/**
 * Maps any frequency `freqHz` to its nearest standard 31-band ISO 1/3-octave center frequency.
 */
export function findNearestIso31Band(freqHz: number): {
  isoBandHz: number;
  isoBandLabel: string;
} {
  const clamped = Math.max(20, Math.min(20000, freqHz));
  let bestHz = ISO_31_BAND_FREQUENCIES_HZ[0];
  let bestDist = Math.abs(Math.log2(clamped / bestHz));

  for (let i = 1; i < ISO_31_BAND_FREQUENCIES_HZ.length; i++) {
    const candidate = ISO_31_BAND_FREQUENCIES_HZ[i];
    const dist = Math.abs(Math.log2(clamped / candidate));
    if (dist < bestDist) {
      bestDist = dist;
      bestHz = candidate;
    }
  }
  return {
    isoBandHz: bestHz,
    isoBandLabel: formatIsoBandLabel(bestHz),
  };
}

/**
 * Converts a frequency in Hz (`A4 = 440 Hz`) to its musical note and cents deviation (e.g. `A4 (+0c)`, `D#7 (-8c)`).
 */
export function frequencyToMusicalNote(freqHz: number): string {
  if (!(freqHz > 0)) {
    return '—';
  }
  const exactMidi = 69 + 12 * Math.log2(freqHz / 440.0);
  const roundedMidi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - roundedMidi) * 100);
  const noteIndex = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteName = NOTE_NAMES[noteIndex];
  const sign = cents >= 0 ? '+' : '';
  return `${noteName}${octave} (${sign}${cents}c)`;
}
