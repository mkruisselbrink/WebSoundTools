// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Cross-Channel Feedback Event Merger & Culprit Attribution Resolver (`src/dsp/feedback-culprit-resolver.ts`).
 *
 * Solves multi-mic acoustic bleed: when an open stage mic enters a feedback loop at `f0`,
 * multiple stage mics and the FOH measurement mic hear `f0` simultaneously. This resolver:
 *  1. Clusters simultaneous same-frequency (`±1/24 oct`) detections across async sample rates.
 *  2. Ranks watched mixer channels using Post-Fader closed-loop projection or Pre-Fader
 *     prominence, amplitude, onset lead, and causal Mix-Bus electrical coupling (`busCouplingScore`).
 *  3. Enriches Measurement Slot tracks in-place and emits deduplicated stage-only alerts.
 */

import type { MixerTapMode } from '../sources/mixer-patch-storage.js';
import type {
  DetectedFeedbackTrack,
  FeedbackCulpritAttribution,
  FeedbackLoopLocation,
  FeedbackTrackState,
} from './feedback-detector.js';

export interface MixerChannelTrackDetail {
  readonly track: DetectedFeedbackTrack;
  /** Earliest frame sequence when this channel's track started */
  readonly onsetSeq: number;
  /** In-phase loop contribution Re(<R* Y_i>) / <|R|^2> when Mix Bus is active */
  readonly inPhaseBusShare?: number;
}

export interface MixerChannelFeedbackObservation {
  readonly channelIndex: number;
  readonly channelName: string;
  readonly busCouplingScore: number;
  readonly details: readonly MixerChannelTrackDetail[];
}

export interface ResolveFeedbackEventsParams {
  readonly slotTracksBySlotId: ReadonlyMap<string, readonly DetectedFeedbackTrack[]>;
  readonly mixerObservations: readonly MixerChannelFeedbackObservation[];
  readonly tapMode: MixerTapMode;
  readonly hasActiveMixBus: boolean;
  /** Total number of enabled watched mixer channels (used for single-survivor confidence scaling) */
  readonly enabledWatchChannelCount: number;
}

export interface ResolvedFeedbackEvents {
  readonly enrichedSlotTracksBySlotId: Map<string, DetectedFeedbackTrack[]>;
  readonly mixerOnlyTracks: DetectedFeedbackTrack[];
}

interface ClusterMember {
  readonly channelIndex: number;
  readonly channelName: string;
  readonly busCouplingScore: number;
  readonly detail: MixerChannelTrackDetail;
}

interface MixerFrequencyCluster {
  centerFreqHz: number;
  readonly members: ClusterMember[];
  culprit: FeedbackCulpritAttribution;
  representativeTrack: DetectedFeedbackTrack;
  matchedToMeasurementSlot: boolean;
}

const ONE_TWENTY_FOURTH_OCT_RATIO = Math.pow(2, 1 / 24) - 1; // ~2.93% (~50 cents)

function frequenciesMatch(fA: number, fB: number): boolean {
  const meanF = 0.5 * (fA + fB);
  const tolHz = Math.max(16.0, Math.min(110.0, meanF * ONE_TWENTY_FOURTH_OCT_RATIO));
  return Math.abs(fA - fB) <= tolHz;
}

function stateSeverityRank(s: FeedbackTrackState): number {
  return s === 'feedback' ? 3 : s === 'ringing' ? 2 : 1;
}

function computeMemberCulpritWeight(
  member: ClusterMember,
  earliestOnsetSeq: number,
  tapMode: MixerTapMode,
  hasActiveMixBus: boolean,
  maxInPhaseShare: number
): number {
  const { track, onsetSeq, inPhaseBusShare } = member.detail;
  // Latched-only remnants yield to actively ringing channels
  const activeFactor = track.state === 'latched' ? 0.12 : 1.0;

  // Narrowband prominence above channel's own local stage bleed
  const promFactor = Math.pow(10.0, Math.max(0, track.prominenceDb - 8.0) / 18.0);
  // Raw narrowband amplitude (peakLevelDb has +100 dB default offset on mixer scanner)
  const rawDbFs = track.peakLevelDb - 100.0;
  const ampLinear = Math.pow(10.0, Math.max(-80, rawDbFs) / 20.0);

  // Earlier onset frames (leading the buildup by 1..4 frames) earn up to ~2.1x weight
  const lagBehindEarliest = onsetSeq > 0 ? Math.max(0, onsetSeq - earliestOnsetSeq) : 2;
  const leadFrames = Math.max(0, 4 - Math.min(4, lagBehindEarliest));
  const onsetBonus = Math.pow(1.2, leadFrames);

  if (tapMode === 'post-fader') {
    if (hasActiveMixBus && inPhaseBusShare !== undefined && maxInPhaseShare > 0.05) {
      const shareFactor =
        inPhaseBusShare > 0.01 ? inPhaseBusShare : 0.03 * Math.max(0, 1 + inPhaseBusShare);
      return activeFactor * shareFactor * promFactor * onsetBonus;
    }
    return activeFactor * ampLinear * promFactor * onsetBonus;
  }

  // Pre-Fader Direct Outs: down-weight channels that show near-zero causal electrical coupling to Mix Bus
  const routingFactor = hasActiveMixBus
    ? 0.03 + 0.97 * Math.max(0, Math.min(1, member.busCouplingScore))
    : 1.0;

  return activeFactor * promFactor * Math.max(1e-6, ampLinear) * onsetBonus * routingFactor;
}

function buildMixerClusters(
  observations: readonly MixerChannelFeedbackObservation[],
  tapMode: MixerTapMode,
  hasActiveMixBus: boolean,
  enabledWatchChannelCount: number
): MixerFrequencyCluster[] {
  const rawMembers: ClusterMember[] = [];
  for (const obs of observations) {
    for (const detail of obs.details) {
      rawMembers.push({
        channelIndex: obs.channelIndex,
        channelName: obs.channelName,
        busCouplingScore: obs.busCouplingScore,
        detail,
      });
    }
  }
  if (rawMembers.length === 0) return [];

  // Sort strongest active rings first so cluster centers anchor on clean peaks
  rawMembers.sort((a, b) => {
    const r = stateSeverityRank(b.detail.track.state) - stateSeverityRank(a.detail.track.state);
    return r !== 0 ? r : b.detail.track.prominenceDb - a.detail.track.prominenceDb;
  });

  const clusters: Array<{ centerFreqHz: number; members: ClusterMember[] }> = [];
  for (const m of rawMembers) {
    const freq = m.detail.track.frequencyHz;
    let targetCluster: { centerFreqHz: number; members: ClusterMember[] } | null = null;
    for (const c of clusters) {
      if (
        frequenciesMatch(c.centerFreqHz, freq) &&
        !c.members.some((existing) => existing.channelIndex === m.channelIndex)
      ) {
        targetCluster = c;
        break;
      }
    }
    if (targetCluster) {
      targetCluster.members.push(m);
    } else {
      clusters.push({ centerFreqHz: freq, members: [m] });
    }
  }

  return clusters.map((cluster) => {
    let earliestOnset = Infinity;
    let maxInPhase = 0;
    for (const m of cluster.members) {
      if (m.detail.onsetSeq > 0 && m.detail.onsetSeq < earliestOnset) {
        earliestOnset = m.detail.onsetSeq;
      }
      if ((m.detail.inPhaseBusShare ?? 0) > maxInPhase) {
        maxInPhase = m.detail.inPhaseBusShare ?? 0;
      }
    }
    if (!Number.isFinite(earliestOnset)) earliestOnset = 0;

    const scored = cluster.members.map((member) => ({
      member,
      weight: computeMemberCulpritWeight(
        member,
        earliestOnset,
        tapMode,
        hasActiveMixBus,
        maxInPhase
      ),
    }));
    scored.sort((a, b) => b.weight - a.weight);

    const winner = scored[0];
    const sumW = scored.reduce((acc, item) => acc + item.weight, 0);

    let confidencePct: number;
    if (scored.length === 1) {
      const base = enabledWatchChannelCount > 1 ? 72 : 65;
      confidencePct = Math.min(
        96,
        Math.max(
          50,
          Math.round(base + Math.min(24, (winner.member.detail.track.prominenceDb - 10) * 1.5))
        )
      );
    } else {
      const rawShare = sumW > 1e-12 ? (100.0 * winner.weight) / sumW : 50;
      confidencePct = Math.min(97, Math.max(15, Math.round(rawShare)));
    }

    let runnerUpLabel: string | undefined;
    if (scored.length >= 2 && sumW > 1e-12) {
      const second = scored[1];
      const secondPct = Math.round((100.0 * second.weight) / sumW);
      if (secondPct >= 5) {
        runnerUpLabel = `${second.member.channelName} (${secondPct}%)`;
      }
    }

    const culprit: FeedbackCulpritAttribution = {
      channelIndex: winner.member.channelIndex,
      channelName: winner.member.channelName,
      confidencePct,
      ...(runnerUpLabel ? { runnerUpLabel } : {}),
    };

    // Upgrade representative severity if any active member reached 'feedback'
    let bestState: FeedbackTrackState = winner.member.detail.track.state;
    let loopLocation: FeedbackLoopLocation | undefined =
      winner.member.detail.track.loopLocation;
    for (const s of scored) {
      if (stateSeverityRank(s.member.detail.track.state) > stateSeverityRank(bestState)) {
        bestState = s.member.detail.track.state;
      }
      if (s.member.detail.track.loopLocation === 'in-mix') {
        loopLocation = 'in-mix';
      }
    }

    const notchKey = `mixer-ch-${winner.member.channelIndex}`;
    const notchLabel = `${winner.member.channelName} (Ch ${winner.member.channelIndex + 1})`;
    const rep: DetectedFeedbackTrack = {
      ...winner.member.detail.track,
      state: bestState,
      ...(loopLocation ? { loopLocation } : {}),
      culprit,
      notchTargetKey: notchKey,
      notchTargetLabel: notchLabel,
    };

    return {
      centerFreqHz: rep.frequencyHz,
      members: cluster.members,
      culprit,
      representativeTrack: rep,
      matchedToMeasurementSlot: false,
    };
  });
}

export function resolveFeedbackEvents(
  params: ResolveFeedbackEventsParams
): ResolvedFeedbackEvents {
  const clusters = buildMixerClusters(
    params.mixerObservations,
    params.tapMode,
    params.hasActiveMixBus,
    params.enabledWatchChannelCount
  );

  const enrichedSlotTracksBySlotId = new Map<string, DetectedFeedbackTrack[]>();

  for (const [slotId, tracks] of params.slotTracksBySlotId.entries()) {
    if (clusters.length === 0 || tracks.length === 0) {
      enrichedSlotTracksBySlotId.set(slotId, [...tracks]);
      continue;
    }

    const enriched = tracks.map((track) => {
      let bestCluster: MixerFrequencyCluster | null = null;
      let bestDist = Infinity;
      for (const c of clusters) {
        if (frequenciesMatch(track.frequencyHz, c.centerFreqHz)) {
          const dist = Math.abs(track.frequencyHz - c.centerFreqHz);
          if (dist < bestDist) {
            bestDist = dist;
            bestCluster = c;
          }
        }
      }
      if (!bestCluster) {
        return track;
      }

      bestCluster.matchedToMeasurementSlot = true;
      const mergedState =
        stateSeverityRank(bestCluster.representativeTrack.state) >
        stateSeverityRank(track.state)
          ? bestCluster.representativeTrack.state
          : track.state;
      const mergedLoopLoc: FeedbackLoopLocation | undefined =
        track.loopLocation === 'in-mix' ||
        bestCluster.representativeTrack.loopLocation === 'in-mix'
          ? 'in-mix'
          : (track.loopLocation ?? bestCluster.representativeTrack.loopLocation);

      return {
        ...track,
        state: mergedState,
        ...(mergedLoopLoc ? { loopLocation: mergedLoopLoc } : {}),
        culprit: bestCluster.culprit,
        notchTargetKey: bestCluster.representativeTrack.notchTargetKey,
        notchTargetLabel: bestCluster.representativeTrack.notchTargetLabel,
      };
    });

    enrichedSlotTracksBySlotId.set(slotId, enriched);
  }

  const mixerOnlyTracks: DetectedFeedbackTrack[] = [];
  for (const c of clusters) {
    if (!c.matchedToMeasurementSlot) {
      mixerOnlyTracks.push(c.representativeTrack);
    }
  }

  return {
    enrichedSlotTracksBySlotId,
    mixerOnlyTracks,
  };
}
