// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createDefaultMixerWatchSessionConfig } from '../sources/mixer-patch-storage.js';
import { resolveFeedbackEvents } from './feedback-culprit-resolver.js';
import { DetectedFeedbackTrack } from './feedback-detector.js';
import { MixerInputWatchScanner } from './mixer-watch-scanner.js';

describe('MixerInputWatchScanner & FeedbackCulpritResolver', () => {
  it('pinpoints the culprit mixer channel over acoustic bleed and muted pre-fader mics, and merges across async sample rates (48 kHz FOH + 44.1 kHz Console)', () => {
    const mixerSr = 44100; // Console running on its own 44.1 kHz crystal clock!
    const scanner = new MixerInputWatchScanner(mixerSr);
    scanner.updateConfig({
      ...createDefaultMixerWatchSessionConfig(),
      enabled: true,
      sensitivity: 'foh-normal',
      patch: {
        tapMode: 'pre-fader',
        mixBusChannel: 15,
        channels: [
          { channelIndex: 0, name: 'Lead Vox', enabled: true },
          { channelIndex: 1, name: 'Stage Vox 2', enabled: true },
          { channelIndex: 2, name: 'Acoustic Gtr', enabled: true },
          { channelIndex: 3, name: 'Muted Spare', enabled: true },
        ],
      },
    });

    const chunk = Math.round(0.04 * mixerSr); // 1764 samples @ 44.1 kHz
    const ch0 = new Float32Array(chunk);
    const ch1 = new Float32Array(chunk);
    const ch2 = new Float32Array(chunk);
    const ch3 = new Float32Array(chunk);
    const bus = new Float32Array(chunk);
    const prevBusRing = new Float32Array(1024); // For 6 ms air delay to muted spare mic
    let ringPtr = 0;

    let rng = 0x13572468;
    const nextNoise = () => {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      return (rng >>> 0) / 2147483648 - 1;
    };

    // Phase A (10 frames = 400 ms): Normal broadband vocal check on Stage Vox 2 (unmuted -> in bus at 0.5ms lag),
    // while Muted Spare only hears 6 ms delayed speaker bleed from the bus!
    const elecLag = 22; // ~0.5 ms digital mixer bus latency
    const airDelay = 265; // ~6.0 ms speaker-to-mic air path
    for (let tick = 0; tick < 10; tick++) {
      for (let i = 0; i < chunk; i++) {
        const talk2 = 0.12 * nextNoise();
        const gtr = 0.05 * nextNoise();
        ch0[i] = 0.002 * nextNoise();
        ch1[i] = talk2;
        ch2[i] = gtr;

        // Mix Bus receives Ch1 + Ch2 at ~0.5 ms electrical lag (NOT Ch3 Muted Spare!)
        const delayedTalk = i >= elecLag ? ch1[i - elecLag] : 0;
        const busSample = 0.85 * delayedTalk + 0.5 * gtr;
        bus[i] = busSample;

        prevBusRing[ringPtr] = busSample;
        const delayedAir = prevBusRing[(ringPtr - airDelay + 1024) & 1023];
        ringPtr = (ringPtr + 1) & 1023;

        // Muted Spare sitting right next to loud wedge hears delayed speaker bleed!
        ch3[i] = 0.65 * delayedAir + 0.002 * nextNoise();
      }

      scanner.writeDirectChannelMap(
        new Map([
          [0, ch0],
          [1, ch1],
          [2, ch2],
          [3, ch3],
        ]),
        chunk,
        bus
      );
      scanner.processTick(0.04);
    }

    // Phase B (8 frames = 320 ms): 2480 Hz feedback loop erupts on Stage Vox 2 (Ch 1),
    // bleeding acoustically into Acoustic Gtr (-14 dB) and Muted Spare (-3 dB wedge proximity),
    // while Lead Vox (Ch 0) sings with +/- 30 cents vibrato + harmonics!
    let fbPhase = 0;
    let voxPhase = 0;
    let lastResult = scanner.processTick(0.04);

    for (let tick = 0; tick < 8; tick++) {
      for (let i = 0; i < chunk; i++) {
        const t = (tick * chunk + i) / mixerSr;
        const cents = 30 * Math.sin(2 * Math.PI * 5.5 * t);
        const fVox = 220 * Math.pow(2, cents / 1200);
        voxPhase += (2 * Math.PI * fVox) / mixerSr;
        fbPhase += (2 * Math.PI * 2480) / mixerSr;

        // Ch 0: Vibrato singing (must NOT false-trigger!)
        ch0[i] =
          0.08 * Math.sin(voxPhase) +
          0.06 * Math.sin(2 * voxPhase) +
          0.12 * Math.sin(4 * voxPhase);

        // Ch 1: Stage Vox 2 driving the 2480 Hz feedback loop
        const howl = 0.22 * Math.sin(fbPhase);
        ch1[i] = howl + 0.01 * nextNoise();

        // Ch 2: Acoustic Gtr hearing -14 dB room bleed + guitar noise
        ch2[i] = 0.044 * Math.sin(fbPhase - 1.1) + 0.03 * nextNoise();

        // Ch 3: Muted Spare right in front of wedge hearing strong bleed (must be down-weighted by busCouplingScore!)
        ch3[i] = 0.16 * Math.sin(fbPhase - 0.8) + 0.005 * nextNoise();

        bus[i] = 0.5 * ch0[i] + 0.9 * ch1[i] + 0.4 * ch2[i];
      }

      scanner.writeDirectChannelMap(
        new Map([
          [0, ch0],
          [1, ch1],
          [2, ch2],
          [3, ch3],
        ]),
        chunk,
        bus
      );
      lastResult = scanner.processTick(0.04);
    }

    // FOH Measurement Mic running at 48 kHz also hears 2481 Hz in the room
    const fohTrack: DetectedFeedbackTrack = {
      id: 'live-measurement-fb-1',
      slotId: 'live-measurement',
      slotName: 'FOH Mic',
      slotColor: '#38bdf8',
      state: 'feedback',
      frequencyHz: 2481.2,
      isoBandHz: 2500,
      isoBandLabel: '2.5 kHz',
      musicalNote: 'D#7 (-6c)',
      prominenceDb: 18.5,
      peakLevelDb: 86.0,
      estimatedQ: 24,
      durationMs: 280,
      firstDetectedAt: '21:15:00',
      latchRemainingRatio: 1.0,
      loopLocation: 'in-mix',
    };

    const resolved = resolveFeedbackEvents({
      slotTracksBySlotId: new Map([['live-measurement', [fohTrack]]]),
      mixerObservations: lastResult.observations,
      tapMode: 'pre-fader',
      hasActiveMixBus: lastResult.hasActiveMixBus,
      enabledWatchChannelCount: lastResult.enabledChannelCount,
    });

    // Must merge into the single FOH slot track (0 duplicate mixerOnlyTracks!) and pinpoint Stage Vox 2 (Ch 1)!
    expect(resolved.mixerOnlyTracks).toHaveLength(0);
    const enrichedFoh = resolved.enrichedSlotTracksBySlotId.get('live-measurement')!;
    expect(enrichedFoh).toHaveLength(1);
    expect(enrichedFoh[0].culprit?.channelIndex).toBe(1);
    expect(enrichedFoh[0].culprit?.channelName).toBe('Stage Vox 2');
    expect(enrichedFoh[0].culprit?.confidencePct).toBeGreaterThan(55);
    expect(enrichedFoh[0].notchTargetKey).toBe('mixer-ch-1');
    expect(enrichedFoh[0].notchTargetLabel).toBe('Stage Vox 2 (Ch 2)');
  });

  it('surfaces stage-only mixer channel rings even before FOH Measurement Mic crosses threshold, and ranks Post-Fader loop share', () => {
    const resolved = resolveFeedbackEvents({
      slotTracksBySlotId: new Map([['live-measurement', []]]),
      mixerObservations: [
        {
          channelIndex: 13,
          channelName: 'Vox 2',
          busCouplingScore: 1.0,
          details: [
            {
              onsetSeq: 2,
              inPhaseBusShare: 0.84,
              track: {
                id: 'mixer-ch-13-fb-1',
                slotId: 'mixer-ch-13',
                slotName: 'Vox 2',
                slotColor: '#f59e0b',
                state: 'ringing',
                frequencyHz: 632,
                isoBandHz: 630,
                isoBandLabel: '630 Hz',
                musicalNote: 'D#5 (+20c)',
                prominenceDb: 13.5,
                peakLevelDb: 82,
                estimatedQ: 18,
                durationMs: 200,
                firstDetectedAt: '21:16:00',
                latchRemainingRatio: 1.0,
                loopLocation: 'stage-only',
              },
            },
          ],
        },
        {
          channelIndex: 12,
          channelName: 'Vox 1',
          busCouplingScore: 1.0,
          details: [
            {
              onsetSeq: 4,
              inPhaseBusShare: 0.12,
              track: {
                id: 'mixer-ch-12-fb-1',
                slotId: 'mixer-ch-12',
                slotName: 'Vox 1',
                slotColor: '#f43f5e',
                state: 'ringing',
                frequencyHz: 633,
                isoBandHz: 630,
                isoBandLabel: '630 Hz',
                musicalNote: 'D#5 (+22c)',
                prominenceDb: 10.0,
                peakLevelDb: 70,
                estimatedQ: 15,
                durationMs: 120,
                firstDetectedAt: '21:16:00',
                latchRemainingRatio: 1.0,
                loopLocation: 'stage-only',
              },
            },
          ],
        },
      ],
      tapMode: 'post-fader',
      hasActiveMixBus: true,
      enabledWatchChannelCount: 8,
    });

    expect(resolved.mixerOnlyTracks).toHaveLength(1);
    const stageAlert = resolved.mixerOnlyTracks[0];
    expect(stageAlert.culprit?.channelIndex).toBe(13);
    expect(stageAlert.culprit?.channelName).toBe('Vox 2');
    expect(stageAlert.culprit?.confidencePct).toBeGreaterThan(80);
    expect(stageAlert.culprit?.runnerUpLabel).toContain('Vox 1');
  });
});
