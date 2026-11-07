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
