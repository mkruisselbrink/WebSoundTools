// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Feedback ring-log deduplication and surgical peaking-notch Virtual EQ synthesis.
 */

import {
  DetectedFeedbackTrack,
  MAX_RING_LOG_ENTRIES,
} from '../dsp/feedback-detector.js';
import {
  EqualizerSourceConfig,
  createDefaultEqBands,
  normalizeEqSourceConfig,
  syncEqConfigWithBands,
} from './eq-source.js';

export function mergeFeedbackTracksIntoRingLog(
  currentLog: readonly DetectedFeedbackTrack[],
  tracks: readonly DetectedFeedbackTrack[]
): DetectedFeedbackTrack[] {
  let log = [...currentLog];
  for (const t of tracks) {
    const existingIdx = log.findIndex(
      (entry) =>
        entry.slotId === t.slotId &&
        (entry.id === t.id ||
          Math.abs(entry.frequencyHz - t.frequencyHz) <= Math.max(15, t.frequencyHz * 0.025))
    );

    if (existingIdx >= 0) {
      const prev = log[existingIdx];
      const updated: DetectedFeedbackTrack = {
        ...t,
        state: prev.state === 'feedback' || t.state === 'feedback' ? 'feedback' : t.state,
        prominenceDb: Math.max(prev.prominenceDb, t.prominenceDb),
        peakLevelDb: Math.max(prev.peakLevelDb, t.peakLevelDb),
        estimatedQ: Math.max(prev.estimatedQ, t.estimatedQ),
        durationMs: Math.max(prev.durationMs, t.durationMs),
      };
      log.splice(existingIdx, 1);
      log = [updated, ...log].slice(0, MAX_RING_LOG_ENTRIES);
    } else {
      log = [t, ...log].slice(0, MAX_RING_LOG_ENTRIES);
    }
  }
  return log;
}

export function applyFeedbackNotchToEqList(
  eqSources: readonly EqualizerSourceConfig[],
  track: DetectedFeedbackTrack,
  generateId: () => string
): {
  readonly eqId: string;
  readonly updatedEq: EqualizerSourceConfig;
  readonly nextEqSources: EqualizerSourceConfig[];
} {
  const freqHz = Math.max(20, Math.min(20000, Math.round(track.frequencyHz)));
  const qVal = Math.min(24, Math.max(8, Math.round(track.estimatedQ)));
  const initialCutDb =
    track.state === 'feedback'
      ? Math.max(-15, Math.min(-6, -Math.round(track.prominenceDb * 0.75)))
      : Math.max(-9, Math.min(-3, -Math.round(track.prominenceDb * 0.5)));

  const targetEq = eqSources.find((eq) => eq.targetSourceId === track.slotId) ?? null;

  if (!targetEq) {
    const id = generateId();
    const bands = createDefaultEqBands();
    bands[0] = {
      type: 'peaking',
      frequency: freqHz,
      q: qVal,
      gainDb: initialCutDb,
      enabled: true,
    };
    const createdEq: EqualizerSourceConfig = normalizeEqSourceConfig({
      id,
      name: `Feedback Notch (${track.slotName})`,
      color: '#10b981',
      visible: true,
      bands,
      targetSourceId: track.slotId,
      createdAt: new Date().toISOString(),
    });
    return {
      eqId: id,
      updatedEq: createdEq,
      nextEqSources: [...eqSources, createdEq],
    };
  }

  const existingBandIdx = targetEq.bands.findIndex(
    (b) =>
      b.enabled !== false &&
      b.type === 'peaking' &&
      (b.gainDb ?? 0) < 0 &&
      Math.abs(b.frequency - freqHz) <= Math.max(10, freqHz * 0.025)
  );

  let bandIdxToUpdate = existingBandIdx;
  let nextGainDb = initialCutDb;

  if (existingBandIdx >= 0) {
    const currentGain = targetEq.bands[existingBandIdx]?.gainDb ?? 0;
    nextGainDb = Math.max(-18, currentGain - 3.0);
  } else {
    const unusedIdx = targetEq.bands.findIndex(
      (b) => b.enabled === false || Math.abs(b.gainDb ?? 0) < 0.1
    );
    if (unusedIdx >= 0) {
      bandIdxToUpdate = unusedIdx;
    } else {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < targetEq.bands.length; i++) {
        const dist = Math.abs(Math.log2(targetEq.bands[i].frequency / freqHz));
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      bandIdxToUpdate = bestIdx;
    }
  }

  const updatedEq = syncEqConfigWithBands(
    { ...targetEq, visible: true },
    targetEq.bands.map((b, idx) =>
      idx === bandIdxToUpdate
        ? {
            ...b,
            type: 'peaking',
            frequency: freqHz,
            q: qVal,
            gainDb: nextGainDb,
            enabled: true,
          }
        : b
    )
  );

  return {
    eqId: targetEq.id,
    updatedEq,
    nextEqSources: eqSources.map((eq) => (eq.id === targetEq.id ? updatedEq : eq)),
  };
}
