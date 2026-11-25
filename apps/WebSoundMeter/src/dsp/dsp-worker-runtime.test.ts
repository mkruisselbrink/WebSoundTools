// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createDefaultMixerWatchSessionConfig } from '../sources/mixer-patch-storage.js';
import { DspWorkerRuntime } from './dsp-worker-runtime.js';
import type { DetectedFeedbackTrack } from './feedback-detector.js';

describe('DspWorkerRuntime', () => {
  it('processes simulator ticks across slots, rejects vibrato vocals on pa-room-modes, and attributes Stage Vox 2 feedback on feedback-ring-demo', () => {
    const outbound: Array<Record<string, unknown>> = [];
    const runtime = new DspWorkerRuntime((msg) => outbound.push(msg));

    runtime.handleMessage({
      type: 'sync-mixer-watch',
      config: {
        ...createDefaultMixerWatchSessionConfig(),
        enabled: true,
      },
      channelTapMap: { 0: 0, 1: 1, 2: 2, 3: 3 },
      mixerSampleRate: 48000,
      useSeparateRingBuffer: false,
    });

    // 1. Warm up broadband bus-coupling on 'pa-room-modes' (must emit zero false feedback tracks)
    for (let i = 0; i < 12; i++) {
      runtime.tick(0.04, 1_700_000_000_000 + i * 40);
    }
    const warmupMsg = outbound[outbound.length - 1] as {
      frames: Array<{ feedbackTracks?: readonly DetectedFeedbackTrack[] }>;
      mixerTelemetry: { mixerOnlyFeedbackTracks: readonly DetectedFeedbackTrack[] };
    };
    expect(warmupMsg.frames[0]?.feedbackTracks ?? []).toHaveLength(0);
    expect(warmupMsg.mixerTelemetry.mixerOnlyFeedbackTracks).toHaveLength(0);

    // 2. Switch to 'feedback-ring-demo' and run 35 ticks -> pinpoints Stage Vox 2
    runtime.handleMessage({
      type: 'set-simulator-preset',
      slotId: 'live-measurement',
      preset: 'feedback-ring-demo',
    });
    for (let i = 0; i < 35; i++) {
      runtime.tick(0.04, 1_700_000_001_000 + i * 40);
    }

    const latest = outbound[outbound.length - 1] as {
      frames: Array<{ feedbackTracks?: readonly DetectedFeedbackTrack[] }>;
      mixerTelemetry: {
        channelLevelsDbFs: Record<number, number>;
        mixerOnlyFeedbackTracks: readonly DetectedFeedbackTrack[];
      };
    };
    expect(Object.keys(latest.mixerTelemetry.channelLevelsDbFs).length).toBeGreaterThanOrEqual(4);
    const allTracks = [
      ...(latest.frames[0]?.feedbackTracks ?? []),
      ...latest.mixerTelemetry.mixerOnlyFeedbackTracks,
    ];
    expect(allTracks.some((t) => t.culprit?.channelName === 'Stage Vox 2')).toBe(true);
  });
});
