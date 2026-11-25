// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Deterministic 4-Channel Stage Console Direct-Out Simulator for Demo Mode (`Mixer Input Watch`).
 *
 * Synthesizes:
 *  - `Ch 0 (Lead Vox)`: Singing at 220 Hz with +/- 28 cents vibrato + 1st..5th harmonics (0 false alarms)
 *  - `Ch 1 (Stage Vox 2)`: Drives the primary 2.48 kHz wedge/PA feedback howl when `enableFeedback` is true
 *  - `Ch 2 (Acoustic Gtr)`: Drives the 630 Hz body ring + receives -14 dB acoustic bleed of 2.48 kHz
 *  - `Ch 3 (Spare Mic)`: Muted on console (excluded from `busOut`), picking up 6 ms delayed speaker bleed
 */
export class SimulatedStageMixerRig {
  private sampleRate: number;
  private voxPhase = 0;
  private timeSamples = 0;
  private fbHighPhase = 0;
  private fbLowPhase = 0;
  private rng = 0x51a9e771;

  readonly ch0 = new Float32Array(4096);
  readonly ch1 = new Float32Array(4096);
  readonly ch2 = new Float32Array(4096);
  readonly ch3 = new Float32Array(4096);
  readonly busOut = new Float32Array(4096);
  private readonly airDelayRing = new Float32Array(1024);
  private airPtr = 0;
  readonly channelMap = new Map<number, Float32Array>();

  constructor(sampleRate: number = 48000) {
    this.sampleRate = sampleRate;
  }

  setSampleRate(sampleRate: number): void {
    if (sampleRate > 0 && sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate;
      this.reset();
    }
  }

  reset(): void {
    this.voxPhase = 0;
    this.timeSamples = 0;
    this.fbHighPhase = 0;
    this.fbLowPhase = 0;
    this.airDelayRing.fill(0);
    this.airPtr = 0;
  }

  private nextNoise(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x;
    return (x >>> 0) / 2147483648.0 - 1.0;
  }

  processBlock(length: number, enableFeedback: boolean): void {
    const sr = this.sampleRate;
    const n = Math.min(length, this.ch0.length);
    const twoPiOverSr = (2.0 * Math.PI) / sr;
    const airDelaySamples = Math.min(900, Math.round(0.006 * sr));

    for (let i = 0; i < n; i++) {
      const t = this.timeSamples / sr;
      this.timeSamples++;

      const cents = 28.0 * Math.sin(2.0 * Math.PI * 5.4 * t);
      const fVox = 220.0 * Math.pow(2.0, cents / 1200.0);
      this.voxPhase = (this.voxPhase + fVox * twoPiOverSr) % (2.0 * Math.PI);

      // Ch 0: Lead Vox singing with vibrato + vocal formants
      const leadVox =
        0.06 * Math.sin(this.voxPhase) +
        0.045 * Math.sin(2.0 * this.voxPhase) +
        0.08 * Math.sin(4.0 * this.voxPhase) +
        0.06 * Math.sin(5.0 * this.voxPhase) +
        0.008 * this.nextNoise();

      let vox2 = 0.035 * this.nextNoise();
      let gtr = 0.025 * this.nextNoise();

      if (enableFeedback) {
        this.fbHighPhase = (this.fbHighPhase + 2480.0 * twoPiOverSr) % (2.0 * Math.PI);
        this.fbLowPhase = (this.fbLowPhase + 630.0 * twoPiOverSr) % (2.0 * Math.PI);

        // Ch 1 (Stage Vox 2) drives 2.48 kHz howl; Ch 2 (Acoustic Gtr) drives 630 Hz ring + hears -14 dB bleed
        vox2 += 0.22 * Math.sin(this.fbHighPhase) + 0.015 * Math.sin(this.fbLowPhase - 0.7);
        gtr += 0.044 * Math.sin(this.fbHighPhase - 1.1) + 0.11 * Math.sin(this.fbLowPhase);
      }

      const bus = 0.65 * leadVox + 0.9 * vox2 + 0.6 * gtr;
      this.airDelayRing[this.airPtr] = bus;
      const delayedWedge =
        this.airDelayRing[(this.airPtr - airDelaySamples + 1024) & 1023];
      this.airPtr = (this.airPtr + 1) & 1023;

      this.ch0[i] = leadVox;
      this.ch1[i] = vox2;
      this.ch2[i] = gtr;
      // Ch 3 (Spare Mic) is muted in console bus, hearing only 6 ms delayed wedge bleed
      this.ch3[i] = 0.55 * delayedWedge + 0.003 * this.nextNoise();
      this.busOut[i] = bus;
    }

    this.channelMap.set(0, this.ch0.subarray(0, n));
    this.channelMap.set(1, this.ch1.subarray(0, n));
    this.channelMap.set(2, this.ch2.subarray(0, n));
    this.channelMap.set(3, this.ch3.subarray(0, n));
  }
}
