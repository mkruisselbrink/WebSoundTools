// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  findNearestIso31Band,
  formatIsoBandLabel,
  frequencyToMusicalNote,
} from './pitch-notes.js';

describe('ISO 31-Band & Musical Pitch Mapping', () => {
  it('formats ISO band labels and finds nearest 31-band GEQ centers', () => {
    expect(formatIsoBandLabel(630)).toBe('630 Hz');
    expect(formatIsoBandLabel(2500)).toBe('2.5 kHz');
    expect(formatIsoBandLabel(1000)).toBe('1 kHz');

    expect(findNearestIso31Band(2540)).toEqual({
      isoBandHz: 2500,
      isoBandLabel: '2.5 kHz',
    });
  });

  it('maps frequencies in Hz to 12-TET note names and cents deviation', () => {
    expect(frequencyToMusicalNote(440)).toBe('A4 (+0c)');
    expect(frequencyToMusicalNote(880)).toBe('A5 (+0c)');
    expect(frequencyToMusicalNote(0)).toBe('—');
  });
});
