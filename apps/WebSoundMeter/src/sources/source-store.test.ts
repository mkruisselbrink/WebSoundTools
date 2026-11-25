// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { EqualizerSourceConfig } from './eq-source.js';
import {
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from './source-data.js';
import {
  SourcePersistenceAdapter,
  SourceStore,
} from './source-store.js';
import { UnionSourceConfig } from './union-source.js';

function createMockLiveFrame(
  id: string = 'live-measurement',
  name: string = 'Live Measurement',
  magValue: number = 1.0,
  sampleRate = 48000
): SourceData {
  const freqData = createEmptyFrequencyDomainData(65, sampleRate);
  freqData.magnitude.fill(magValue);
  freqData.phaseReal.fill(1.0);
  freqData.phaseImag.fill(0.0);
  const timeData = createEmptyTimeDomainData(128, sampleRate);
  timeData.impulse[64] = magValue;
  return {
    id,
    name,
    kind: 'measurement',
    color: '#38bdf8',
    visible: true,
    active: true,
    sampleRate,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: false,
    createdAt: new Date().toISOString(),
    notes: '',
    freqData,
    timeData,
  };
}

function createMemoryPersistence(): {
  adapter: SourcePersistenceAdapter;
  saved: Map<string, SourceData>;
  savedEq: Map<string, EqualizerSourceConfig>;
  savedUnion: Map<string, UnionSourceConfig>;
} {
  const saved = new Map<string, SourceData>();
  const savedEq = new Map<string, EqualizerSourceConfig>();
  const savedUnion = new Map<string, UnionSourceConfig>();
  return {
    saved,
    savedEq,
    savedUnion,
    adapter: {
      loadAll: async () => Array.from(saved.values()),
      save: (src) => {
        saved.set(src.id, src);
      },
      remove: (id) => {
        saved.delete(id);
      },
      loadAllEq: async () => Array.from(savedEq.values()),
      saveEq: (eq) => {
        savedEq.set(eq.id, eq);
      },
      removeEq: (id) => {
        savedEq.delete(id);
      },
      loadAllUnion: async () => Array.from(savedUnion.values()),
      saveUnion: (u) => {
        savedUnion.set(u.id, u);
      },
      removeUnion: (id) => {
        savedUnion.delete(id);
      },
    },
  };
}

describe('SourceStore', () => {
  it('preserves per-slot live measurement visibility across incoming DSP frames and supports multiple simultaneous live sources', () => {
    const { adapter } = createMemoryPersistence();
    const store = new SourceStore(adapter);

    const f1 = createMockLiveFrame('live-measurement', 'FOH Center', 1.0);
    const f2 = createMockLiveFrame('live-2', 'FOH Outfill', 0.5);
    store.setLiveFrames([f1, f2]);
    expect(store.getLiveSources()).toHaveLength(2);
    expect(store.getLiveSource('live-measurement')?.visible).toBe(true);
    expect(store.getLiveSource('live-2')?.visible).toBe(true);

    // Hide second live measurement
    store.toggleVisibility('live-2', false);
    expect(store.getLiveSource('live-2')?.visible).toBe(false);

    // Subsequent incoming frames must preserve visibility per live slot
    store.setLiveFrames([f1, f2]);
    expect(store.getLiveSource('live-measurement')?.visible).toBe(true);
    expect(store.getLiveSource('live-2')?.visible).toBe(false);

    // Selecting 'live-2' makes it the active live source
    store.setSelectedSourceId('live-2');
    expect(store.getActiveLiveSourceId()).toBe('live-2');

    // Adding a Math Union automatically defaults to averaging the active live sources
    const union = store.addUnionSource();
    expect(union.sourceIds).toEqual(['live-measurement', 'live-2']);
    const evaluatedUnion = store.getAllSources().find((s) => s.id === union.id);
    expect(evaluatedUnion).toBeDefined();
    expect(evaluatedUnion!.freqData.magnitude[10]).toBeCloseTo(0.75, 4);

    // Removing 'live-2' cleans it up and falls back active live source to 'live-measurement'
    store.setSelectedSourceId('live-2');
    store.removeLiveSource('live-2');
    expect(store.getLiveSources()).toHaveLength(1);
    expect(store.getSelectedSourceId()).toBe('live-measurement');
  });

  it('captures, updates, and deletes stored traces while syncing persistence', () => {
    const { adapter, saved } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setLiveFrame(createMockLiveFrame());
    const captured = store.captureCurrentTrace();
    expect(captured).not.toBeNull();
    expect(captured!.name).toBe('Live Measurement #1');
    expect(store.getStoredSources().length).toBe(1);
    expect(saved.has(captured!.id)).toBe(true);

    // Capturing again while a stored trace is selected captures the live source, not the stored trace
    const captured2 = store.captureCurrentTrace();
    expect(captured2).not.toBeNull();
    expect(captured2!.name).toBe('Live Measurement #2');
    expect(store.getStoredSources().length).toBe(2);
    store.deleteStoredSource(captured2!.id);

    store.updateStoredSource(captured!.id, { name: 'Main PA Left', gainOffsetDb: -2.5 });
    expect(store.getStoredSources()[0].name).toBe('Main PA Left');
    expect(saved.get(captured!.id)?.name).toBe('Main PA Left');
    expect(saved.get(captured!.id)?.gainOffsetDb).toBe(-2.5);

    store.deleteStoredSource(captured!.id);
    expect(store.getStoredSources().length).toBe(0);
    expect(saved.has(captured!.id)).toBe(false);
    expect(store.getSelectedSourceId()).toBe('live-measurement');
    expect(listener).toHaveBeenCalled();
  });

  it('memoizes Virtual EQ and Union source evaluations and persists them across reloads', async () => {
    const { adapter, savedEq, savedUnion } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    store.setLiveFrame(createMockLiveFrame());

    const eq = store.addVirtualEqSource();
    const union = store.addUnionSource();
    expect(savedEq.has(eq.id)).toBe(true);
    expect(savedUnion.has(union.id)).toBe(true);

    const firstEval = store.getAllSources();
    const secondEval = store.getAllSources();
    expect(firstEval).toBe(secondEval);

    const eqData1 = firstEval.find((s) => s.id === eq.id);
    const unionData1 = firstEval.find((s) => s.id === union.id);
    expect(eqData1).toBeDefined();
    expect(unionData1).toBeDefined();

    // Dragging an EQ band invalidates EQ evaluation and updates persisted EQ
    store.setSelectedSourceId(eq.id);
    store.dragActiveEqBand(1, 250, -4.5);
    const thirdEval = store.getAllSources();
    const eqData2 = thirdEval.find((s) => s.id === eq.id);
    expect(eqData2).not.toBe(eqData1);
    expect(store.getEqSources()[0].bands[1].frequency).toBe(250);
    expect(savedEq.get(eq.id)?.bands[1].gainDb).toBe(-4.5);

    // Hydrate a second store from the same persistence adapter
    const reloadedStore = new SourceStore(adapter);
    reloadedStore.setSelectedSourceId('non-existent-id');
    await reloadedStore.loadFromPersistence();
    expect(reloadedStore.getEqSources()).toHaveLength(1);
    expect(reloadedStore.getUnionSources()).toHaveLength(1);
    // Orphaned selectedSourceId is reset to live-measurement
    expect(reloadedStore.getSelectedSourceId()).toBe('live-measurement');
  });

  it('deduplicates feedback ring log entries and inserts/deepens surgical Notch EQ cuts', () => {
    const { adapter } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    const frameWithFeedback = createMockLiveFrame('live-measurement', 'FOH Center', 1.0);
    frameWithFeedback.feedbackTracks = [
      {
        id: 'live-measurement:2500',
        slotId: 'live-measurement',
        slotName: 'FOH Center',
        slotColor: '#38bdf8',
        state: 'feedback',
        frequencyHz: 2480,
        isoBandHz: 2500,
        isoBandLabel: '2.5 kHz',
        musicalNote: 'D#7 (-23c)',
        prominenceDb: 16.5,
        peakLevelDb: -5.0,
        estimatedQ: 40,
        durationMs: 400,
        firstDetectedAt: new Date().toISOString(),
        latchRemainingRatio: 1.0,
      },
    ];

    store.setLiveFrames([frameWithFeedback]);
    expect(store.getFeedbackRingLog()).toHaveLength(1);
    expect(store.getFeedbackRingLog()[0].isoBandHz).toBe(2500);

    // First click on Notch EQ creates a Virtual EQ targeting 'live-measurement' with a severity-scaled cut
    const eqId = store.applyFeedbackNotchToEq(store.getFeedbackRingLog()[0]);
    const eq1 = store.getEqSources().find((e) => e.id === eqId)!;
    expect(eq1.targetSourceId).toBe('live-measurement');
    expect(eq1.bands[0].frequency).toBe(2480);
    expect(eq1.bands[0].q).toBe(24);
    expect(eq1.bands[0].gainDb).toBe(-12.0);

    // Second click on Notch EQ for the same frequency deepens the existing band by -3 dB -> -15 dB
    store.applyFeedbackNotchToEq(store.getFeedbackRingLog()[0]);
    const eq2 = store.getEqSources().find((e) => e.id === eqId)!;
    expect(eq2.bands[0].gainDb).toBe(-15.0);

    store.clearFeedbackRingLog();
    expect(store.getFeedbackRingLog()).toHaveLength(0);
  });

  it('merges culprit-attributed mixer rings with FOH slot rings and creates isolated per-culprit Notch EQs', () => {
    const { adapter } = createMemoryPersistence();
    const store = new SourceStore(adapter);
    const fohFrame = createMockLiveFrame('live-measurement', 'FOH Mic', 1.0);
    fohFrame.feedbackTracks = [
      {
        id: 'live-measurement-fb-1',
        slotId: 'live-measurement',
        slotName: 'FOH Mic',
        slotColor: '#38bdf8',
        state: 'ringing',
        frequencyHz: 2480,
        isoBandHz: 2500,
        isoBandLabel: '2.5 kHz',
        musicalNote: 'D#7 (-23c)',
        prominenceDb: 13.0,
        peakLevelDb: 80.0,
        estimatedQ: 18,
        durationMs: 200,
        firstDetectedAt: '20:00:00',
        latchRemainingRatio: 1.0,
        loopLocation: 'in-mix',
      },
    ];
    store.setLiveFrames([fohFrame]);
    expect(store.getFeedbackRingLog()).toHaveLength(1);

    // Next frame resolves Stage Vox 2 (Ch 2) as the culprit at 2481 Hz + a stage-only 630 Hz ring on Acoustic Gtr (Ch 3)
    const enrichedFoh = createMockLiveFrame('live-measurement', 'FOH Mic', 1.0);
    enrichedFoh.feedbackTracks = [
      {
        ...fohFrame.feedbackTracks[0],
        state: 'feedback',
        frequencyHz: 2481,
        prominenceDb: 18.0,
        culprit: {
          channelIndex: 1,
          channelName: 'Stage Vox 2',
          confidencePct: 86,
          runnerUpLabel: 'Acoustic Gtr (9%)',
        },
        notchTargetKey: 'mixer-ch-1',
        notchTargetLabel: 'Stage Vox 2 (Ch 2)',
      },
    ];
    const stageOnlyTracks = [
      {
        id: 'mixer-ch-2-fb-1',
        slotId: 'mixer-ch-2',
        slotName: 'Acoustic Gtr',
        slotColor: '#10b981',
        state: 'ringing' as const,
        frequencyHz: 630,
        isoBandHz: 630,
        isoBandLabel: '630 Hz',
        musicalNote: 'D#5 (+15c)',
        prominenceDb: 12.5,
        peakLevelDb: 78.0,
        estimatedQ: 16,
        durationMs: 160,
        firstDetectedAt: '20:00:01',
        latchRemainingRatio: 1.0,
        loopLocation: 'stage-only' as const,
        culprit: {
          channelIndex: 2,
          channelName: 'Acoustic Gtr',
          confidencePct: 81,
        },
        notchTargetKey: 'mixer-ch-2',
        notchTargetLabel: 'Acoustic Gtr (Ch 3)',
      },
    ];

    store.setLiveFrames([enrichedFoh], stageOnlyTracks);
    // 2480/2481 Hz merged in-place (not duplicated!), plus 630 Hz stage-only track = 2 log items total
    expect(store.getFeedbackRingLog()).toHaveLength(2);
    const voxEntry = store
      .getFeedbackRingLog()
      .find((t) => t.isoBandHz === 2500)!;
    const gtrEntry = store
      .getFeedbackRingLog()
      .find((t) => t.isoBandHz === 630)!;
    expect(voxEntry.culprit?.channelName).toBe('Stage Vox 2');

    // Applying Notch EQ creates separate Virtual EQ cheat-sheets per culprit channel
    const voxEqId = store.applyFeedbackNotchToEq(voxEntry);
    const gtrEqId = store.applyFeedbackNotchToEq(gtrEntry);
    expect(voxEqId).not.toBe(gtrEqId);

    const voxEq = store.getEqSources().find((e) => e.id === voxEqId)!;
    const gtrEq = store.getEqSources().find((e) => e.id === gtrEqId)!;
    expect(voxEq.name).toBe('Notch — Stage Vox 2 (Ch 2)');
    expect(voxEq.culpritKey).toBe('mixer-ch-1');
    expect(voxEq.targetSourceId).toBe('live-measurement');
    expect(gtrEq.name).toBe('Notch — Acoustic Gtr (Ch 3)');
    expect(gtrEq.culpritKey).toBe('mixer-ch-2');
    expect(gtrEq.targetSourceId).toBe('live-measurement');
  });
});
