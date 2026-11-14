// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { computeGroupDelayFromPhasorsMs } from './group-delay.js';

describe('Group Delay Computation', () => {
  it('recovers exact pure delay across +/-180 degree phase wraps without discontinuities', () => {
    const delayMs = 3.25;
    const N = 128;
    const freqs = new Float32Array(N);
    const re = new Float32Array(N);
    const im = new Float32Array(N);

    for (let k = 0; k < N; k++) {
      const f = 50 + k * 25;
      freqs[k] = f;
      const phi = -2 * Math.PI * f * (delayMs / 1000);
      re[k] = Math.cos(phi);
      im[k] = Math.sin(phi);
    }

    const gd = computeGroupDelayFromPhasorsMs(freqs, re, im);
    for (let k = 0; k < N; k++) {
      expect(gd[k]).toBeCloseTo(delayMs, 3);
    }
  });
});
