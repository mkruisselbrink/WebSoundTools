// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import { mergeFeedbackTracksIntoRingLog } from './auto-eq-matcher.js';
import type { SourceData } from './source-data.js';

export interface SetLiveFramesOptions {
  /**
   * When `true` (used by `AudioSessionController`), `frame.visible` from `AudioEngine.slots`
   * (`LiveSlotManager`) is authoritative and never overridden locally.
   */
  readonly trustFrameVisibility?: boolean;
}

/**
 * Ephemeral `25 Hz` live measurement telemetry and feedback ring-log state, kept strictly
 * outside `ReactiveUndoStore` history and IndexedDB document snapshots.
 */
export class LiveTelemetryFeed {
  private liveSources: SourceData[] = [];
  private readonly standaloneVisibility = new Map<string, boolean>();
  private mixerOnlyFeedbackTracks: DetectedFeedbackTrack[] = [];
  private feedbackRingLog: DetectedFeedbackTrack[] = [];

  public getLiveSources(): readonly SourceData[] {
    return this.liveSources;
  }

  public getLiveSource(targetId: string): SourceData | null {
    return (
      this.liveSources.find((s) => s.id === targetId) ??
      this.liveSources[0] ??
      null
    );
  }

  public getLiveSourceVisible(id: string = 'live-measurement'): boolean {
    const existing = this.liveSources.find((s) => s.id === id);
    if (existing) return existing.visible;
    return this.standaloneVisibility.get(id) ?? true;
  }

  public setStandaloneLiveVisibility(id: string, visible: boolean): void {
    this.standaloneVisibility.set(id, visible);
    this.liveSources = this.liveSources.map((s) =>
      s.id === id ? { ...s, visible } : s
    );
  }

  public removeLiveSource(id: string): void {
    this.liveSources = this.liveSources.filter((s) => s.id !== id);
    this.standaloneVisibility.delete(id);
  }

  public setLiveFrames(
    frames: readonly SourceData[],
    mixerOnlyTracks?: readonly DetectedFeedbackTrack[],
    options?: SetLiveFramesOptions
  ): void {
    const trustFrameVis = Boolean(options?.trustFrameVisibility);
    if (trustFrameVis && this.standaloneVisibility.size > 0) {
      this.standaloneVisibility.clear();
    }

    const prevById = new Map<string, SourceData>();
    for (const prev of this.liveSources) {
      prevById.set(prev.id, prev);
    }

    this.liveSources = frames.map((frame) => {
      const vis = trustFrameVis
        ? frame.visible
        : (this.standaloneVisibility.get(frame.id) ?? frame.visible ?? true);
      if (!trustFrameVis) {
        this.standaloneVisibility.set(frame.id, vis);
      }
      const prev = prevById.get(frame.id);
      const splHistory = frame.splHistory ?? prev?.splHistory;
      if (frame.feedbackTracks && frame.feedbackTracks.length > 0) {
        this.feedbackRingLog = mergeFeedbackTracksIntoRingLog(
          this.feedbackRingLog,
          frame.feedbackTracks
        );
      }
      if (frame.visible === vis && frame.splHistory === splHistory) {
        return frame;
      }
      return {
        ...frame,
        visible: vis,
        ...(splHistory ? { splHistory } : {}),
      };
    });

    if (mixerOnlyTracks !== undefined) {
      this.mixerOnlyFeedbackTracks = [...mixerOnlyTracks];
      if (mixerOnlyTracks.length > 0) {
        this.feedbackRingLog = mergeFeedbackTracksIntoRingLog(
          this.feedbackRingLog,
          mixerOnlyTracks
        );
      }
    }
  }

  public getMixerOnlyFeedbackTracks(): readonly DetectedFeedbackTrack[] {
    return this.mixerOnlyFeedbackTracks;
  }

  public getFeedbackRingLog(): readonly DetectedFeedbackTrack[] {
    return this.feedbackRingLog;
  }

  public clearFeedbackRingLog(): boolean {
    if (this.feedbackRingLog.length === 0) return false;
    this.feedbackRingLog = [];
    return true;
  }
}
