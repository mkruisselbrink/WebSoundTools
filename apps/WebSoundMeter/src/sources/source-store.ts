// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { BiquadSpec } from '@foh/dsp';
import { ReactiveUndoStore } from '@foh/state';
import { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import {
  applyFeedbackNotchToEqList,
  mergeFeedbackTracksIntoRingLog,
} from './auto-eq-matcher.js';
import {
  EqualizerSourceConfig,
  SourceDspPatch,
  applyPatchToEqConfig,
  computeEqualizerSourceData,
  createDefaultEqBands,
  createDefaultEqDspConfig,
  createRoomModeFlattenEqBands,
  normalizeEqSourceConfig,
  syncEqConfigWithBands,
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
  importFrdAsStoredSource,
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

interface AuthoredSourcesState {
  readonly storedSources: readonly SourceData[];
  readonly eqSources: readonly EqualizerSourceConfig[];
  readonly unionSources: readonly UnionSourceConfig[];
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
  list: readonly T[],
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
  private feedbackRingLog: DetectedFeedbackTrack[] = [];
  private selectedSourceId = 'live-measurement';

  private readonly authoredStore = new ReactiveUndoStore<AuthoredSourcesState>({
    storedSources: [],
    eqSources: [],
    unionSources: [],
  });

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
    stored: readonly SourceData[];
    eq: readonly EqualizerSourceConfig[];
    union: readonly UnionSourceConfig[];
    result: SourceData[];
  } | null = null;

  constructor(persistence: SourcePersistenceAdapter = defaultPersistenceAdapter) {
    this.persistence = persistence;
  }

  private get storedSources(): readonly SourceData[] {
    return this.authoredStore.state.storedSources;
  }

  private get eqSources(): readonly EqualizerSourceConfig[] {
    return this.authoredStore.state.eqSources;
  }

  private get unionSources(): readonly UnionSourceConfig[] {
    return this.authoredStore.state.unionSources;
  }

  get canUndo(): boolean {
    return this.authoredStore.canUndo;
  }

  get canRedo(): boolean {
    return this.authoredStore.canRedo;
  }

  endTransaction(): void {
    this.authoredStore.endTransaction();
  }

  undo(): boolean {
    const prev = this.authoredStore.state;
    if (!this.authoredStore.undo()) return false;
    this.syncAuthoredDiffToPersistence(prev, this.authoredStore.state);
    this.ensureValidSelectedSourceId();
    this.notify();
    return true;
  }

  redo(): boolean {
    const prev = this.authoredStore.state;
    if (!this.authoredStore.redo()) return false;
    this.syncAuthoredDiffToPersistence(prev, this.authoredStore.state);
    this.ensureValidSelectedSourceId();
    this.notify();
    return true;
  }

  private syncAuthoredDiffToPersistence(
    prev: AuthoredSourcesState,
    next: AuthoredSourcesState
  ): void {
    const nextStoredIds = new Set(next.storedSources.map((s) => s.id));
    for (const s of prev.storedSources) {
      if (!nextStoredIds.has(s.id)) void this.persistence.remove(s.id);
    }
    const prevStoredMap = new Map(prev.storedSources.map((s) => [s.id, s]));
    for (const s of next.storedSources) {
      if (prevStoredMap.get(s.id) !== s) void this.persistence.save(s);
    }

    const nextEqIds = new Set(next.eqSources.map((e) => e.id));
    for (const e of prev.eqSources) {
      if (!nextEqIds.has(e.id)) void this.persistence.removeEq?.(e.id);
    }
    const prevEqMap = new Map(prev.eqSources.map((e) => [e.id, e]));
    for (const e of next.eqSources) {
      if (prevEqMap.get(e.id) !== e) void this.persistence.saveEq?.(e);
    }

    const nextUnionIds = new Set(next.unionSources.map((u) => u.id));
    for (const u of prev.unionSources) {
      if (!nextUnionIds.has(u.id)) void this.persistence.removeUnion?.(u.id);
    }
    const prevUnionMap = new Map(prev.unionSources.map((u) => [u.id, u]));
    for (const u of next.unionSources) {
      if (prevUnionMap.get(u.id) !== u) void this.persistence.saveUnion?.(u);
    }
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
    if (loadedStored.length > 0 || loadedEq.length > 0 || loadedUnion.length > 0) {
      this.authoredStore.replace(
        {
          storedSources: loadedStored.length > 0 ? loadedStored : this.storedSources,
          eqSources:
            loadedEq.length > 0 ? loadedEq.map(normalizeEqSourceConfig) : this.eqSources,
          unionSources: loadedUnion.length > 0 ? loadedUnion : this.unionSources,
        },
        false
      );
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
    this.notify();
  }

  getFeedbackRingLog(): readonly DetectedFeedbackTrack[] {
    return this.feedbackRingLog;
  }

  clearFeedbackRingLog(): void {
    if (this.feedbackRingLog.length === 0) return;
    this.feedbackRingLog = [];
    this.notify();
  }

  applyFeedbackNotchToEq(track: DetectedFeedbackTrack): string {
    let appliedId = '';
    this.authoredStore.update((s) => {
      const { eqId, updatedEq, nextEqSources } = applyFeedbackNotchToEqList(
        s.eqSources,
        track,
        () => generateShortId('eq')
      );
      appliedId = eqId;
      void this.persistence.saveEq?.(updatedEq);
      return {
        ...s,
        eqSources: nextEqSources,
      };
    });
    this.notify();
    return appliedId;
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

    this.addStoredSource(captured);
    return captured;
  }

  addStoredSource(source: SourceData): SourceData {
    this.authoredStore.update((s) => ({
      ...s,
      storedSources: [...s.storedSources, source],
    }));
    this.selectedSourceId = source.id;
    void this.persistence.save(source);
    this.notify();
    return source;
  }

  importFrdStoredSource(frdText: string, fileName?: string): SourceData {
    const cleanName = fileName
      ? fileName.replace(/\.(frd|cal|txt|csv)$/i, '')
      : `Imported .FRD #${this.storedSources.length + 1}`;
    const paletteIdx = (this.storedSources.length + 1) % DEFAULT_SOURCE_PALETTE.length;
    const live = this.getLiveSource();
    const imported = importFrdAsStoredSource(frdText, {
      name: cleanName,
      color: DEFAULT_SOURCE_PALETTE[paletteIdx],
      sampleRate: live?.sampleRate ?? 48000,
      binCount: live?.freqData.length ?? 2049,
    });
    return this.addStoredSource(imported);
  }

  deleteStoredSource(id: string): void {
    this.authoredStore.update((s) => ({
      ...s,
      storedSources: s.storedSources.filter((item) => item.id !== id),
    }));
    void this.persistence.remove(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify();
  }

  updateStoredSource(
    id: string,
    partial: Partial<Pick<SourceData, 'name' | 'gainOffsetDb' | 'delayOffsetMs'>>,
    txKey?: string
  ): void {
    this.authoredStore.update(
      (s) => ({
        ...s,
        storedSources: updateInList(
          s.storedSources,
          id,
          (item) => ({ ...item, ...partial }),
          this.persistence.save
        ),
      }),
      txKey
    );
    this.notify();
  }

  toggleVisibility(id: string, visible: boolean): void {
    if (isLiveSourceId(id)) {
      this.liveVisibility.set(id, visible);
      this.liveSources = updateInList(this.liveSources, id, (s) => ({ ...s, visible }));
    } else if (id.startsWith('stored-')) {
      this.authoredStore.update((s) => ({
        ...s,
        storedSources: updateInList(
          s.storedSources,
          id,
          (item) => ({ ...item, visible }),
          this.persistence.save
        ),
      }));
    } else if (id.startsWith('eq-')) {
      this.authoredStore.update((s) => ({
        ...s,
        eqSources: updateInList(
          s.eqSources,
          id,
          (item) => ({ ...item, visible }),
          this.persistence.saveEq
        ),
      }));
    } else if (id.startsWith('union-')) {
      this.authoredStore.update((s) => ({
        ...s,
        unionSources: updateInList(
          s.unionSources,
          id,
          (item) => ({ ...item, visible }),
          this.persistence.saveUnion
        ),
      }));
    }
    this.notify();
  }

  addVirtualEqSource(): EqualizerSourceConfig {
    const id = generateShortId('eq');
    const bands = createDefaultEqBands();
    const newEq: EqualizerSourceConfig = {
      id,
      name: `Virtual EQ #${this.eqSources.length + 1}`,
      color: '#10b981',
      visible: true,
      bands,
      dsp: createDefaultEqDspConfig(bands),
      targetSourceId: this.getActiveLiveSourceId(),
      createdAt: new Date().toISOString(),
    };
    this.authoredStore.update((s) => ({
      ...s,
      eqSources: [...s.eqSources, newEq],
    }));
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
    this.authoredStore.update((s) => ({
      ...s,
      eqSources: s.eqSources.filter((item) => item.id !== id),
    }));
    this.eqEvalCache.delete(id);
    void this.persistence.removeEq?.(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify();
  }

  autoFlattenRoomModesWithEq(eqId: string): void {
    this.authoredStore.update((s) => ({
      ...s,
      eqSources: updateInList(
        s.eqSources,
        eqId,
        (eq) => syncEqConfigWithBands(eq, createRoomModeFlattenEqBands()),
        this.persistence.saveEq
      ),
    }));
    this.notify();
  }

  setEqTargetSource(eqId: string, targetSourceId: string | null): void {
    this.authoredStore.update((s) => ({
      ...s,
      eqSources: updateInList(
        s.eqSources,
        eqId,
        (item) => ({ ...item, targetSourceId }),
        this.persistence.saveEq
      ),
    }));
    this.notify();
  }

  updateEqDsp(eqId: string, patch: SourceDspPatch, txKey?: string): void {
    this.authoredStore.update(
      (s) => ({
        ...s,
        eqSources: updateInList(
          s.eqSources,
          eqId,
          (eq) => applyPatchToEqConfig(eq, patch),
          this.persistence.saveEq
        ),
      }),
      txKey
    );
    this.notify();
  }

  updateEqBand(
    eqId: string,
    bandIdx: number,
    partial: Partial<BiquadSpec>,
    txKey?: string
  ): void {
    this.authoredStore.update(
      (s) => ({
        ...s,
        eqSources: updateInList(
          s.eqSources,
          eqId,
          (eq) =>
            syncEqConfigWithBands(
              eq,
              eq.bands.map((b, i) => (i === bandIdx ? { ...b, ...partial } : b))
            ),
          this.persistence.saveEq
        ),
      }),
      txKey
    );
    this.notify();
  }

  dragActiveEqBand(bandIndex: number, frequency: number, gainDb: number): void {
    const activeEq =
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ?? this.eqSources[0];
    if (!activeEq) return;

    this.authoredStore.update(
      (s) => ({
        ...s,
        eqSources: s.eqSources.map((eq) => {
          if (eq.id !== activeEq.id) return eq;
          const bands = eq.bands.map((b, i) =>
            i === bandIndex ? { ...b, frequency, gainDb } : b
          );
          const updated = syncEqConfigWithBands(eq, bands);
          this.scheduleDebouncedEqSave(updated);
          return updated;
        }),
      }),
      `drag-eq-${activeEq.id}-${bandIndex}`
    );
    this.notify();
  }

  private scheduleDebouncedEqSave(updated: EqualizerSourceConfig): void {
    if (this.eqDragSaveTimer === null) {
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
    this.authoredStore.update((s) => ({
      ...s,
      unionSources: [...s.unionSources, newUnion],
    }));
    this.selectedSourceId = id;
    void this.persistence.saveUnion?.(newUnion);
    this.notify();
    return newUnion;
  }

  deleteUnionSource(id: string): void {
    this.authoredStore.update((s) => ({
      ...s,
      unionSources: s.unionSources.filter((item) => item.id !== id),
    }));
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
    this.authoredStore.update((s) => ({
      ...s,
      unionSources: updateInList(
        s.unionSources,
        unionId,
        (u) => ({ ...u, ...partial }),
        this.persistence.saveUnion
      ),
    }));
    this.notify();
  }
}
