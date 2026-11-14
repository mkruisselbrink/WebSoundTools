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

/**
 * Pure reactive store managing the acoustic source graph:
 *  - One or more simultaneous Live Measurement frames + per-slot persistent visibility state
 *  - Stored trace snapshots + IndexedDB persistence
 *  - Virtual Parametric EQ sources with memoized frequency/impulse evaluation + IndexedDB persistence
 *  - Math / Union sources with memoized vector/power evaluation + IndexedDB persistence
 */

import { BiquadSpec } from '../dsp/biquad.js';
import {
  DetectedFeedbackTrack,
  MAX_RING_LOG_ENTRIES,
} from '../dsp/feedback-detector.js';
import {
  EqualizerSourceConfig,
  computeEqualizerSourceData,
  createDefaultEqBands,
  createRoomModeFlattenEqBands,
} from './eq-source.js';
import {
  deleteEqSourceFromDb,
  deleteStoredTraceFromDb,
  deleteUnionSourceFromDb,
  loadAllEqSourcesFromDb,
  loadAllStoredTracesFromDb,
  loadAllUnionSourcesFromDb,
  saveEqSourceToDb,
  saveStoredTraceToDb,
  saveUnionSourceToDb,
} from './session-storage.js';
import {
  DEFAULT_SOURCE_PALETTE,
  SourceData,
  cloneSourceDataAsStored,
} from './source-data.js';
import { UnionSourceConfig, computeUnionSourceData } from './union-source.js';

export interface SourcePersistenceAdapter {
  readonly loadAll: () => Promise<SourceData[]>;
  readonly save: (source: SourceData) => void | Promise<void>;
  readonly remove: (id: string) => void | Promise<void>;
  readonly loadAllEq?: () => Promise<EqualizerSourceConfig[]>;
  readonly saveEq?: (eq: EqualizerSourceConfig) => void | Promise<void>;
  readonly removeEq?: (id: string) => void | Promise<void>;
  readonly loadAllUnion?: () => Promise<UnionSourceConfig[]>;
  readonly saveUnion?: (union: UnionSourceConfig) => void | Promise<void>;
  readonly removeUnion?: (id: string) => void | Promise<void>;
}

const defaultPersistenceAdapter: SourcePersistenceAdapter = {
  loadAll: loadAllStoredTracesFromDb,
  save: saveStoredTraceToDb,
  remove: deleteStoredTraceFromDb,
  loadAllEq: loadAllEqSourcesFromDb,
  saveEq: saveEqSourceToDb,
  removeEq: deleteEqSourceFromDb,
  loadAllUnion: loadAllUnionSourcesFromDb,
  saveUnion: saveUnionSourceToDb,
  removeUnion: deleteUnionSourceFromDb,
};

function generateShortId(prefix: string): string {
  const uid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${uid}`;
}

export function isLiveSourceId(id: string): boolean {
  return id.startsWith('live-');
}

function updateInList<T extends { id: string }>(
  list: T[],
  id: string,
  updater: (item: T) => T,
  onPersist?: (updated: T) => void | Promise<void>
): T[] {
  return list.map((item) => {
    if (item.id !== id) return item;
    const updated = updater(item);
    void onPersist?.(updated);
    return updated;
  });
}

export class SourceStore {
  private liveSources: SourceData[] = [];
  private readonly liveVisibility = new Map<string, boolean>([
    ['live-measurement', true],
  ]);
  private storedSources: SourceData[] = [];
  private eqSources: EqualizerSourceConfig[] = [];
  private unionSources: UnionSourceConfig[] = [];
  private feedbackRingLog: DetectedFeedbackTrack[] = [];
  private selectedSourceId = 'live-measurement';

  private readonly persistence: SourcePersistenceAdapter;
  private readonly listeners = new Set<() => void>();
  private eqDragSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDraggedEq: EqualizerSourceConfig | null = null;

  private readonly eqEvalCache = new Map<
    string,
    { cfg: EqualizerSourceConfig; target: SourceData | null; data: SourceData }
  >();
  private readonly unionEvalCache = new Map<
    string,
    { cfg: UnionSourceConfig; inputs: SourceData[]; data: SourceData }
  >();
  private lastAllSourcesRef: {
    live: SourceData[];
    stored: SourceData[];
    eq: EqualizerSourceConfig[];
    union: UnionSourceConfig[];
    result: SourceData[];
  } | null = null;

  constructor(persistence: SourcePersistenceAdapter = defaultPersistenceAdapter) {
    this.persistence = persistence;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async loadFromPersistence(): Promise<void> {
    const [loadedStored, loadedEq, loadedUnion] = await Promise.all([
      this.persistence.loadAll(),
      this.persistence.loadAllEq ? this.persistence.loadAllEq() : Promise.resolve([]),
      this.persistence.loadAllUnion
        ? this.persistence.loadAllUnion()
        : Promise.resolve([]),
    ]);

    let changed = false;
    if (loadedStored.length > 0) {
      this.storedSources = loadedStored;
      changed = true;
    }
    if (loadedEq.length > 0) {
      this.eqSources = loadedEq;
      changed = true;
    }
    if (loadedUnion.length > 0) {
      this.unionSources = loadedUnion;
      changed = true;
    }

    if (this.ensureValidSelectedSourceId()) {
      changed = true;
    }

    if (changed) {
      this.notify();
    }
  }

  ensureValidSelectedSourceId(): boolean {
    if (isLiveSourceId(this.selectedSourceId)) {
      return false;
    }
    const exists =
      this.storedSources.some((s) => s.id === this.selectedSourceId) ||
      this.eqSources.some((s) => s.id === this.selectedSourceId) ||
      this.unionSources.some((s) => s.id === this.selectedSourceId);
    if (!exists) {
      this.selectedSourceId = this.liveSources[0]?.id ?? 'live-measurement';
      return true;
    }
    return false;
  }

  getActiveLiveSourceId(): string {
    if (isLiveSourceId(this.selectedSourceId)) {
      return this.selectedSourceId;
    }
    return this.liveSources[0]?.id ?? 'live-measurement';
  }

  getLiveSources(): readonly SourceData[] {
    return this.liveSources;
  }

  getLiveSource(id?: string): SourceData | null {
    const targetId = id ?? this.getActiveLiveSourceId();
    return (
      this.liveSources.find((s) => s.id === targetId) ??
      this.liveSources[0] ??
      null
    );
  }

  getLiveSourceVisible(id: string = 'live-measurement'): boolean {
    return this.liveVisibility.get(id) ?? true;
  }

  setLiveSourceVisible(visible: boolean, id: string = 'live-measurement'): void {
    this.toggleVisibility(id, visible);
  }

  removeLiveSource(id: string): void {
    this.liveSources = this.liveSources.filter((s) => s.id !== id);
    this.liveVisibility.delete(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.liveSources[0]?.id ?? 'live-measurement';
    }
    this.notify();
  }

  getStoredSources(): readonly SourceData[] {
    return this.storedSources;
  }

  getEqSources(): readonly EqualizerSourceConfig[] {
    return this.eqSources;
  }

  getUnionSources(): readonly UnionSourceConfig[] {
    return this.unionSources;
  }

  getSelectedSourceId(): string {
    return this.selectedSourceId;
  }

  setSelectedSourceId(id: string): void {
    if (this.selectedSourceId === id) return;
    this.selectedSourceId = id;
    this.notify();
  }

  setLiveFrames(frames: readonly SourceData[]): void {
    const prevById = new Map<string, SourceData>();
    for (const prev of this.liveSources) {
      prevById.set(prev.id, prev);
    }

    this.liveSources = frames.map((frame) => {
      const vis = this.liveVisibility.get(frame.id) ?? frame.visible ?? true;
      this.liveVisibility.set(frame.id, vis);
      const prev = prevById.get(frame.id);
      const splHistory = frame.splHistory ?? prev?.splHistory;
      if (frame.feedbackTracks && frame.feedbackTracks.length > 0) {
        this.recordFeedbackTracksInLog(frame.feedbackTracks);
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
    this.notify();
  }

  private recordFeedbackTracksInLog(tracks: readonly DetectedFeedbackTrack[]): void {
    for (const t of tracks) {
      const existingIdx = this.feedbackRingLog.findIndex(
        (entry) =>
          entry.slotId === t.slotId &&
          (entry.id === t.id ||
            Math.abs(entry.frequencyHz - t.frequencyHz) <= Math.max(15, t.frequencyHz * 0.025))
      );

      if (existingIdx >= 0) {
        const prev = this.feedbackRingLog[existingIdx];
        const updated: DetectedFeedbackTrack = {
          ...t,
          state: prev.state === 'feedback' || t.state === 'feedback' ? 'feedback' : t.state,
          prominenceDb: Math.max(prev.prominenceDb, t.prominenceDb),
          peakLevelDb: Math.max(prev.peakLevelDb, t.peakLevelDb),
          estimatedQ: Math.max(prev.estimatedQ, t.estimatedQ),
          durationMs: Math.max(prev.durationMs, t.durationMs),
        };
        const nextLog = [...this.feedbackRingLog];
        nextLog.splice(existingIdx, 1);
        this.feedbackRingLog = [updated, ...nextLog].slice(0, MAX_RING_LOG_ENTRIES);
      } else {
        this.feedbackRingLog = [t, ...this.feedbackRingLog].slice(0, MAX_RING_LOG_ENTRIES);
      }
    }
  }

  getFeedbackRingLog(): readonly DetectedFeedbackTrack[] {
    return this.feedbackRingLog;
  }

  clearFeedbackRingLog(): void {
    if (this.feedbackRingLog.length === 0) return;
    this.feedbackRingLog = [];
    this.notify();
  }

  /**
   * Inserts or deepens a surgical peaking notch filter on a Virtual Parametric EQ
   * targeting `track.slotId`. Returns the ID of the updated or created EQ source.
   */
  applyFeedbackNotchToEq(track: DetectedFeedbackTrack): string {
    const freqHz = Math.max(20, Math.min(20000, Math.round(track.frequencyHz)));
    const qVal = Math.min(24, Math.max(8, Math.round(track.estimatedQ)));
    const initialCutDb =
      track.state === 'feedback'
        ? Math.max(-15, Math.min(-6, -Math.round(track.prominenceDb * 0.75)))
        : Math.max(-9, Math.min(-3, -Math.round(track.prominenceDb * 0.5)));

    let targetEq =
      this.eqSources.find((eq) => eq.targetSourceId === track.slotId) ?? null;

    if (!targetEq) {
      const id = generateShortId('eq');
      const bands = createDefaultEqBands();
      bands[0] = {
        type: 'peaking',
        frequency: freqHz,
        q: qVal,
        gainDb: initialCutDb,
        enabled: true,
      };
      const createdEq: EqualizerSourceConfig = {
        id,
        name: `Feedback Notch (${track.slotName})`,
        color: '#10b981',
        visible: true,
        bands,
        targetSourceId: track.slotId,
        createdAt: new Date().toISOString(),
      };
      this.eqSources = [...this.eqSources, createdEq];
      void this.persistence.saveEq?.(createdEq);
      this.notify();
      return id;
    }

    // Check if an enabled peaking band already exists within +/- 2.5% of track.frequencyHz
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
      // Repeated click: deepen existing notch by -3 dB (clamped at -18 dB)
      const currentGain = targetEq.bands[existingBandIdx]?.gainDb ?? 0;
      nextGainDb = Math.max(-18, currentGain - 3.0);
    } else {
      // Find first unused / flat band (gainDb === 0 or disabled)
      const unusedIdx = targetEq.bands.findIndex(
        (b) => b.enabled === false || Math.abs(b.gainDb ?? 0) < 0.1
      );
      if (unusedIdx >= 0) {
        bandIdxToUpdate = unusedIdx;
      } else {
        // Otherwise pick the band closest in log-frequency
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

    this.eqSources = updateInList(
      this.eqSources,
      targetEq.id,
      (eq) => ({
        ...eq,
        visible: true,
        bands: eq.bands.map((b, idx) =>
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
        ),
      }),
      this.persistence.saveEq
    );
    this.notify();
    return targetEq.id;
  }

  setLiveFrame(live: SourceData): void {
    this.setLiveFrames([live]);
  }

  getActiveEq(): EqualizerSourceConfig | null {
    return (
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ??
      this.eqSources.find((eq) => eq.visible) ??
      null
    );
  }

  getAllSources(): SourceData[] {
    if (
      this.lastAllSourcesRef &&
      this.lastAllSourcesRef.live === this.liveSources &&
      this.lastAllSourcesRef.stored === this.storedSources &&
      this.lastAllSourcesRef.eq === this.eqSources &&
      this.lastAllSourcesRef.union === this.unionSources
    ) {
      return this.lastAllSourcesRef.result;
    }

    const list: SourceData[] = [...this.liveSources, ...this.storedSources];

    for (const eqCfg of this.eqSources) {
      const target = eqCfg.targetSourceId
        ? list.find((s) => s.id === eqCfg.targetSourceId) ?? null
        : null;
      const cached = this.eqEvalCache.get(eqCfg.id);
      if (cached && cached.cfg === eqCfg && cached.target === target) {
        list.push(cached.data);
      } else {
        const data = computeEqualizerSourceData(eqCfg, target);
        this.eqEvalCache.set(eqCfg.id, { cfg: eqCfg, target, data });
        list.push(data);
      }
    }

    for (const uCfg of this.unionSources) {
      const inputs = uCfg.sourceIds
        .map((id) => list.find((s) => s.id === id))
        .filter((s): s is SourceData => Boolean(s));
      const cached = this.unionEvalCache.get(uCfg.id);
      const inputsMatch =
        cached &&
        cached.inputs.length === inputs.length &&
        cached.inputs.every((inp, idx) => inp === inputs[idx]);
      if (cached && cached.cfg === uCfg && inputsMatch) {
        list.push(cached.data);
      } else {
        const data = computeUnionSourceData(uCfg, inputs);
        this.unionEvalCache.set(uCfg.id, { cfg: uCfg, inputs, data });
        list.push(data);
      }
    }

    this.lastAllSourcesRef = {
      live: this.liveSources,
      stored: this.storedSources,
      eq: this.eqSources,
      union: this.unionSources,
      result: list,
    };

    return list;
  }

  captureCurrentTrace(): SourceData | null {
    const allSources = this.getAllSources();
    const candidate = !this.selectedSourceId.startsWith('stored-')
      ? allSources.find((s) => s.id === this.selectedSourceId)
      : undefined;
    const target = candidate ?? this.getLiveSource();
    if (!target) return null;

    // Do not capture an unpopulated skeleton frame before any DSP transform has run
    const hasSignal =
      target.levels !== undefined ||
      target.freqData.magnitude.some((v) => v !== 0);
    if (!hasSignal) return null;

    const captureNum = this.storedSources.length + 1;
    const baseName = target.name.replace(/\s+#\d+$/, '');
    const capturedName =
      baseName === target.name
        ? `${target.name} #${captureNum}`
        : `${target.name} (Cap #${captureNum})`;

    const paletteIdx = captureNum % DEFAULT_SOURCE_PALETTE.length;
    const captured = cloneSourceDataAsStored(
      target,
      capturedName,
      DEFAULT_SOURCE_PALETTE[paletteIdx]
    );

    this.storedSources = [...this.storedSources, captured];
    this.selectedSourceId = captured.id;
    void this.persistence.save(captured);
    this.notify();
    return captured;
  }

  deleteStoredSource(id: string): void {
    this.storedSources = this.storedSources.filter((s) => s.id !== id);
    void this.persistence.remove(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify();
  }

  updateStoredSource(
    id: string,
    partial: Partial<Pick<SourceData, 'name' | 'gainOffsetDb' | 'delayOffsetMs'>>
  ): void {
    this.storedSources = updateInList(
      this.storedSources,
      id,
      (s) => ({ ...s, ...partial }),
      this.persistence.save
    );
    this.notify();
  }

  toggleVisibility(id: string, visible: boolean): void {
    if (isLiveSourceId(id)) {
      this.liveVisibility.set(id, visible);
      this.liveSources = updateInList(this.liveSources, id, (s) => ({ ...s, visible }));
    } else if (id.startsWith('stored-')) {
      this.storedSources = updateInList(
        this.storedSources,
        id,
        (s) => ({ ...s, visible }),
        this.persistence.save
      );
    } else if (id.startsWith('eq-')) {
      this.eqSources = updateInList(
        this.eqSources,
        id,
        (s) => ({ ...s, visible }),
        this.persistence.saveEq
      );
    } else if (id.startsWith('union-')) {
      this.unionSources = updateInList(
        this.unionSources,
        id,
        (s) => ({ ...s, visible }),
        this.persistence.saveUnion
      );
    }
    this.notify();
  }

  addVirtualEqSource(): EqualizerSourceConfig {
    const id = generateShortId('eq');
    const newEq: EqualizerSourceConfig = {
      id,
      name: `Virtual EQ #${this.eqSources.length + 1}`,
      color: '#10b981',
      visible: true,
      bands: createDefaultEqBands(),
      targetSourceId: this.getActiveLiveSourceId(),
      createdAt: new Date().toISOString(),
    };
    this.eqSources = [...this.eqSources, newEq];
    this.selectedSourceId = id;
    void this.persistence.saveEq?.(newEq);
    this.notify();
    return newEq;
  }

  deleteEqSource(id: string): void {
    if (this.pendingDraggedEq?.id === id) {
      if (this.eqDragSaveTimer !== null) {
        clearTimeout(this.eqDragSaveTimer);
        this.eqDragSaveTimer = null;
      }
      this.pendingDraggedEq = null;
    }
    this.eqSources = this.eqSources.filter((s) => s.id !== id);
    this.eqEvalCache.delete(id);
    void this.persistence.removeEq?.(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify();
  }

  autoFlattenRoomModesWithEq(eqId: string): void {
    this.eqSources = updateInList(
      this.eqSources,
      eqId,
      (eq) => ({ ...eq, bands: createRoomModeFlattenEqBands() }),
      this.persistence.saveEq
    );
    this.notify();
  }

  setEqTargetSource(eqId: string, targetSourceId: string | null): void {
    this.eqSources = updateInList(
      this.eqSources,
      eqId,
      (item) => ({ ...item, targetSourceId }),
      this.persistence.saveEq
    );
    this.notify();
  }

  updateEqBand(eqId: string, bandIdx: number, partial: Partial<BiquadSpec>): void {
    this.eqSources = updateInList(
      this.eqSources,
      eqId,
      (eq) => ({
        ...eq,
        bands: eq.bands.map((b, i) => (i === bandIdx ? { ...b, ...partial } : b)),
      }),
      this.persistence.saveEq
    );
    this.notify();
  }

  dragActiveEqBand(bandIndex: number, frequency: number, gainDb: number): void {
    const activeEq =
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ?? this.eqSources[0];
    if (!activeEq) return;

    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== activeEq.id) return eq;
      const bands = eq.bands.map((b, i) =>
        i === bandIndex ? { ...b, frequency, gainDb } : b
      );
      const updated = { ...eq, bands };
      this.scheduleDebouncedEqSave(updated);
      return updated;
    });
    this.notify();
  }

  private scheduleDebouncedEqSave(updated: EqualizerSourceConfig): void {
    if (this.eqDragSaveTimer === null) {
      // Leading edge: persist immediately and open a 150ms throttle window
      void this.persistence.saveEq?.(updated);
      this.pendingDraggedEq = null;
      this.eqDragSaveTimer = setTimeout(() => {
        this.eqDragSaveTimer = null;
        const toSave = this.pendingDraggedEq;
        this.pendingDraggedEq = null;
        if (toSave) {
          void this.persistence.saveEq?.(toSave);
        }
      }, 150);
    } else {
      // Within throttle window: coalesce for trailing-edge save
      this.pendingDraggedEq = updated;
    }
  }

  addUnionSource(): UnionSourceConfig {
    const id = generateShortId('union');
    const liveIds = this.liveSources.map((s) => s.id);
    const allIds = [
      ...(liveIds.length > 0 ? liveIds : ['live-measurement']),
      ...this.storedSources.map((s) => s.id),
    ];
    const newUnion: UnionSourceConfig = {
      id,
      name: `Math Union #${this.unionSources.length + 1}`,
      color: '#f59e0b',
      visible: true,
      operation: 'vector-avg',
      sourceIds: [allIds[0], allIds[1] ?? allIds[0]],
      createdAt: new Date().toISOString(),
    };
    this.unionSources = [...this.unionSources, newUnion];
    this.selectedSourceId = id;
    void this.persistence.saveUnion?.(newUnion);
    this.notify();
    return newUnion;
  }

  deleteUnionSource(id: string): void {
    this.unionSources = this.unionSources.filter((s) => s.id !== id);
    this.unionEvalCache.delete(id);
    void this.persistence.removeUnion?.(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify();
  }

  updateUnionSource(
    unionId: string,
    partial: Partial<Pick<UnionSourceConfig, 'operation' | 'sourceIds'>>
  ): void {
    this.unionSources = updateInList(
      this.unionSources,
      unionId,
      (u) => ({ ...u, ...partial }),
      this.persistence.saveUnion
    );
    this.notify();
  }
}
