// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Target-trace room resonance analyzer (`synthesizeRoomMatchEqBands`) plus feedback
 * ring-log deduplication and surgical peaking-notch Virtual EQ synthesis.
 */

import {
  type BiquadCoefficients,
  type BiquadSpec,
  DSP_REFERENCE_SAMPLE_RATE_HZ,
  computeBiquadCoefficients,
  evaluateBiquadComplexResponse,
} from '@foh/dsp';
import {
  DetectedFeedbackTrack,
  MAX_RING_LOG_ENTRIES,
} from '../dsp/feedback-detector.js';
import {
  EqualizerSourceConfig,
  createDefaultEqBands,
  createRoomModeFlattenEqBands,
  normalizeEqSourceConfig,
  syncEqConfigWithBands,
} from './eq-source.js';
import {
  EffectiveBinResponse,
  SourceData,
  writeEffectiveBinResponse,
} from './source-data.js';

const matchScratchBin: EffectiveBinResponse = {
  frequency: 0,
  module: 0,
  magnitude: 0,
  phaseRe: 1,
  phaseIm: 0,
  coherence: 0,
};

function evaluateBiquadDb(coeffs: BiquadCoefficients, freqHz: number): number {
  const { magnitude } = evaluateBiquadComplexResponse(
    coeffs,
    freqHz,
    DSP_REFERENCE_SAMPLE_RATE_HZ
  );
  return 20 * Math.log10(Math.max(1e-12, magnitude));
}

/**
 * Analyzes a target measurement or stored trace to synthesize a conservative set of
 * subtractive parametric EQ cuts for broad room resonances plus optional gentle HF air-loss
 * shelf compensation—strictly ignoring narrow acoustic comb nulls.
 *
 * Falls back to `createRoomModeFlattenEqBands()` only when no active target trace is attached.
 */
export function synthesizeRoomMatchEqBands(target: SourceData | null | undefined): BiquadSpec[] {
  if (!target || !target.active || target.freqData.length < 16) {
    return createRoomModeFlattenEqBands();
  }

  const n = target.freqData.length;
  const freqs = new Float64Array(n);
  const rawPow = new Float64Array(n);
  const coh = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    writeEffectiveBinResponse(target, i, matchScratchBin);
    freqs[i] = matchScratchBin.frequency;
    rawPow[i] = matchScratchBin.magnitude * matchScratchBin.magnitude;
    coh[i] = matchScratchBin.coherence;
  }

  // 1/3-octave coherence-weighted power smoothing across 35 Hz – 16 kHz
  const smoothDb = new Float64Array(n);
  const halfOctFactor = Math.pow(2, 1 / 6);
  const midSamples: number[] = [];

  for (let i = 0; i < n; i++) {
    const f = freqs[i];
    if (f < 30 || f > 17000) continue;
    const fLow = f / halfOctFactor;
    const fHigh = f * halfOctFactor;
    let weightedPow = 0;
    let weightSum = 0;
    for (let j = 0; j < n; j++) {
      const fj = freqs[j];
      if (fj < fLow) continue;
      if (fj > fHigh) break;
      const w = Math.max(0.05, coh[j]);
      weightedPow += rawPow[j] * w;
      weightSum += w;
    }
    const db = weightSum > 0 && weightedPow > 1e-20 ? 10 * Math.log10(weightedPow / weightSum) : -120;
    smoothDb[i] = db;
    if (f >= 250 && f <= 3000 && coh[i] >= 0.35 && db > -90) {
      midSamples.push(db);
    }
  }

  if (midSamples.length < 6) {
    return createRoomModeFlattenEqBands();
  }

  midSamples.sort((a, b) => a - b);
  const refDb = midSamples[midSamples.length >>> 1];

  // Optional gentle high-shelf compensation for broad HF roll-off or excess (8–14 kHz)
  let hfSum = 0;
  let hfCount = 0;
  for (let i = 0; i < n; i++) {
    if (freqs[i] >= 8000 && freqs[i] <= 14000 && coh[i] >= 0.35 && smoothDb[i] > -90) {
      hfSum += smoothDb[i] - refDb;
      hfCount++;
    }
  }
  const hfDeltaDb = hfCount >= 3 ? hfSum / hfCount : 0;
  const hfShelfGainDb =
    Math.abs(hfDeltaDb) >= 1.2
      ? Math.round(Math.max(-6, Math.min(4.5, -hfDeltaDb * 0.85)) * 2) / 2
      : 0;
  const hfShelfSpec: BiquadSpec = {
    type: 'highshelf',
    frequency: 9000,
    q: 0.707,
    gainDb: hfShelfGainDb,
    enabled: Math.abs(hfShelfGainDb) >= 0.5,
  };
  const hfCoeffs = computeBiquadCoefficients(hfShelfSpec, DSP_REFERENCE_SAMPLE_RATE_HZ);

  // Residual deviation curve after HF shelf; iteratively extract up to 4 subtractive peaks (> +1.3 dB)
  const residual = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = freqs[i];
    if (f < 35 || f > 16000) continue;
    const shelfDb = hfShelfSpec.enabled ? evaluateBiquadDb(hfCoeffs, f) : 0;
    residual[i] = smoothDb[i] - refDb + shelfDb;
  }

  const peakingBands: BiquadSpec[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let bestIdx = -1;
    let bestExcessDb = 1.3;
    for (let i = 1; i < n - 1; i++) {
      const f = freqs[i];
      if (f < 45 || f > 7500 || coh[i] < 0.35) continue;
      const val = residual[i];
      if (val > bestExcessDb && val >= residual[i - 1] && val >= residual[i + 1]) {
        const tooClose = peakingBands.some(
          (b) => Math.abs(Math.log2(b.frequency / f)) < 0.55
        );
        if (!tooClose) {
          bestExcessDb = val;
          bestIdx = i;
        }
      }
    }
    if (bestIdx < 0) break;

    const peakFreq = Math.round(freqs[bestIdx]);
    const halfLevel = bestExcessDb * 0.5;
    let lowF = peakFreq / 1.35;
    for (let j = bestIdx; j >= 0; j--) {
      if (freqs[j] < 35 || residual[j] <= halfLevel) {
        lowF = Math.max(35, freqs[j]);
        break;
      }
    }
    let highF = peakFreq * 1.35;
    for (let j = bestIdx; j < n; j++) {
      if (freqs[j] > 10000 || residual[j] <= halfLevel) {
        highF = Math.min(10000, freqs[j]);
        break;
      }
    }
    const bwOct = Math.max(0.25, Math.min(1.8, Math.log2(Math.max(1.05, highF / lowF))));
    const q = Math.round((1 / (2 * Math.sinh((Math.LN2 / 2) * bwOct))) * 10) / 10;
    const clampedQ = Math.max(1.2, Math.min(5.0, q));
    const cutDb = Math.round(Math.max(-10, Math.min(-1.5, -bestExcessDb * 0.9)) * 2) / 2;

    const cutSpec: BiquadSpec = {
      type: 'peaking',
      frequency: peakFreq,
      q: clampedQ,
      gainDb: cutDb,
      enabled: true,
    };
    peakingBands.push(cutSpec);
    const cutCoeffs = computeBiquadCoefficients(cutSpec, DSP_REFERENCE_SAMPLE_RATE_HZ);
    for (let i = 0; i < n; i++) {
      if (freqs[i] >= 35 && freqs[i] <= 16000) {
        residual[i] += evaluateBiquadDb(cutCoeffs, freqs[i]);
      }
    }
  }

  peakingBands.sort((a, b) => a.frequency - b.frequency);
  const defaultCenters = [160, 500, 1600, 3500];
  while (peakingBands.length < 4) {
    const idx = peakingBands.length;
    peakingBands.push({
      type: 'peaking',
      frequency: defaultCenters[idx],
      q: 2.0,
      gainDb: 0,
      enabled: true,
    });
  }

  return [
    { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
    ...peakingBands.slice(0, 4),
    hfShelfSpec.enabled ? hfShelfSpec : { ...hfShelfSpec, enabled: true, gainDb: 0 },
  ];
}

export function mergeFeedbackTracksIntoRingLog(
  currentLog: readonly DetectedFeedbackTrack[],
  tracks: readonly DetectedFeedbackTrack[]
): DetectedFeedbackTrack[] {
  let log = [...currentLog];
  for (const t of tracks) {
    const freqTol = Math.max(15, t.frequencyHz * 0.029);
    const existingIdx = log.findIndex((entry) => {
      if (entry.id === t.id) return true;
      const freqClose = Math.abs(entry.frequencyHz - t.frequencyHz) <= freqTol;
      if (!freqClose) return false;
      if (entry.slotId === t.slotId) return true;
      // Merge same-frequency FOH mic + mixer culprit detections into one unified log entry
      return Boolean(t.culprit || entry.culprit);
    });

    if (existingIdx >= 0) {
      const prev = log[existingIdx];
      const culprit =
        t.culprit && prev.culprit
          ? t.culprit.confidencePct >= prev.culprit.confidencePct
            ? t.culprit
            : prev.culprit
          : (t.culprit ?? prev.culprit);
      const loopLocation =
        t.loopLocation === 'in-mix' || prev.loopLocation === 'in-mix'
          ? 'in-mix'
          : (t.loopLocation ?? prev.loopLocation);
      const notchTargetKey = t.notchTargetKey ?? prev.notchTargetKey;
      const notchTargetLabel = t.notchTargetLabel ?? prev.notchTargetLabel;

      const updated: DetectedFeedbackTrack = {
        ...t,
        state: prev.state === 'feedback' || t.state === 'feedback' ? 'feedback' : t.state,
        prominenceDb: Math.max(prev.prominenceDb, t.prominenceDb),
        peakLevelDb: Math.max(prev.peakLevelDb, t.peakLevelDb),
        estimatedQ: Math.max(prev.estimatedQ, t.estimatedQ),
        durationMs: Math.max(prev.durationMs, t.durationMs),
        ...(loopLocation ? { loopLocation } : {}),
        ...(culprit ? { culprit } : {}),
        ...(notchTargetKey ? { notchTargetKey } : {}),
        ...(notchTargetLabel ? { notchTargetLabel } : {}),
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
  generateId: () => string,
  fallbackTargetSourceId: string | null = null
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

  const culpritKey = track.notchTargetKey;
  const targetEq = culpritKey
    ? (eqSources.find((eq) => eq.culpritKey === culpritKey) ?? null)
    : (eqSources.find((eq) => !eq.culpritKey && eq.targetSourceId === track.slotId) ??
      null);

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
    const isSlotChartSource = track.slotId.startsWith('live-');
    const resolvedTargetId = isSlotChartSource
      ? track.slotId
      : fallbackTargetSourceId;
    const eqName = culpritKey
      ? `Notch — ${track.notchTargetLabel ?? track.culprit?.channelName ?? track.slotName}`
      : `Feedback Notch (${track.slotName})`;

    const createdEq: EqualizerSourceConfig = normalizeEqSourceConfig({
      id,
      name: eqName,
      color: '#10b981',
      visible: true,
      bands,
      targetSourceId: resolvedTargetId,
      ...(culpritKey ? { culpritKey } : {}),
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
