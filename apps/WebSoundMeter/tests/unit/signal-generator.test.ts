/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
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

import { describe, expect, it } from 'vitest';
import { SignalGenerator } from '../../src/dsp/signal-generator.js';

describe('SignalGenerator', () => {
  it('generates zero output when disabled and non-zero output across all signal types', () => {
    const gen = new SignalGenerator(48000, { enabled: false, levelDbFs: -6 });
    const buf = new Float32Array(2048);

    gen.fillBuffer(buf);
    expect(buf.every((x) => x === 0)).toBe(true);

    const types = ['pink', 'white', 'brown', 'sine', 'sweep', 'burst'] as const;
    for (const type of types) {
      gen.updateConfig({ enabled: true, type, levelDbFs: -6 });
      gen.fillBuffer(buf);
      let energy = 0;
      for (let i = 0; i < buf.length; i++) {
        energy += buf[i] * buf[i];
      }
      expect(energy).toBeGreaterThan(0.01);
    }
  });
});

