// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import {
  nextMobileShowTabByKey,
  pickPrimaryActiveRing,
} from './show-mobile-view.js';

describe('show-mobile-view helpers', () => {
  it('cycles mobile Show tabs via ArrowLeft, ArrowRight, Home, and End', () => {
    expect(nextMobileShowTabByKey('rta', 'ArrowRight')).toBe('history');
    expect(nextMobileShowTabByKey('mics', 'ArrowRight')).toBe('rta');
    expect(nextMobileShowTabByKey('rta', 'ArrowLeft')).toBe('mics');
    expect(nextMobileShowTabByKey('rings', 'Home')).toBe('rta');
    expect(nextMobileShowTabByKey('rta', 'End')).toBe('mics');
    expect(nextMobileShowTabByKey('rta', 'Enter')).toBeNull();
  });

  it('prioritizes critical feedback over ringing and ignores latched tracks for the alert banner', () => {
    const latchedOnly: DetectedFeedbackTrack[] = [
      {
        id: 't-latched',
        slotId: 'live-measurement',
        slotName: 'FOH',
        slotColor: '#38bdf8',
        frequencyHz: 800,
        isoBandHz: 800,
        isoBandLabel: '800 Hz',
        musicalNote: 'G5 (+10c)',
        peakLevelDb: -18,
        prominenceDb: 14,
        estimatedQ: 18,
        durationMs: 450,
        firstDetectedAt: '12:00:00',
        latchRemainingRatio: 0.5,
        state: 'latched',
      },
    ];
    expect(pickPrimaryActiveRing(latchedOnly)).toBeNull();

    const mixed: DetectedFeedbackTrack[] = [
      ...latchedOnly,
      {
        ...latchedOnly[0],
        id: 't-ring',
        frequencyHz: 630,
        prominenceDb: 16,
        state: 'ringing',
      },
      {
        ...latchedOnly[0],
        id: 't-crit',
        frequencyHz: 2480,
        prominenceDb: 12,
        state: 'feedback',
      },
    ];
    expect(pickPrimaryActiveRing(mixed)?.id).toBe('t-crit');
  });
});
