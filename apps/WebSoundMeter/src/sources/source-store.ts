// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { BiquadSpec } from '@foh/dsp';
import { ReactiveUndoStore } from '@foh/state';
import { DetectedFeedbackTrack } from '../dsp/feedback-detector.js';
import {
  applyFeedbackNotchToEqList,
  synthesizeRoomMatchEqBands,
} from './auto-eq-matcher.js';
import { DerivedSourceEvaluator } from './derived-source-evaluator.js';
import {
  EqualizerSourceConfig,
  SourceDspPatch,
  applyPatchToEqConfig,
  createDefaultEqBands,
  createDefaultEqDspConfig,
  normalizeEqSourceConfig,
  syncEqConfigWithBands,
} from './eq-source.js';
import {
  LiveTelemetryFeed,
  type SetLiveFramesOptions,
} from './live-telemetry-feed.js';
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
import { UnionSourceConfig } from './union-source.js';

export type SourceChangeKind = 'live' | 'authored' | 'selection';
export type SourceStoreListener = (kind: SourceChangeKind) => void;

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
  removeUnion: deleteUnionSourceToDbFallback,
};

function deleteUnionSourceToDbFallback(id: string): Promise<void> {
  return deleteUnionSourceFromDb(id);
}

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

function syncCollectionDiff<T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
  save?: (item: T) => void | Promise<void>,
  remove?: (id: string) => void | Promise<void>
): void {
  const nextIds = new Set(next.map((item) => item.id));
  for (const item of prev) {
    if (!nextIds.has(item.id)) void remove?.(item.id);
  }
  const prevById = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) {
    if (prevById.get(item.id) !== item) void save?.(item);
  }
}

export class SourceStore {
  private readonly telemetry = new LiveTelemetryFeed();
  private readonly evaluator = new DerivedSourceEvaluator();
  private selectedSourceId = 'live-measurement';

  private readonly authoredStore = new ReactiveUndoStore<AuthoredSourcesState>({
    storedSources: [],
    eqSources: [],
    unionSources: [],
  });

  private readonly persistence: SourcePersistenceAdapter;
  private readonly listeners = new Set<SourceStoreListener>();
  private eqDragSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDraggedEq: EqualizerSourceConfig | null = null;
  private authoredRevision = 0;

  constructor(persistence: SourcePersistenceAdapter = defaultPersistenceAdapter) {
    this.persistence = persistence;
  }

  public get revision(): number {
    return this.authoredRevision;
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
    this.notify('authored');
    return true;
  }

  redo(): boolean {
    const prev = this.authoredStore.state;
    if (!this.authoredStore.redo()) return false;
    this.syncAuthoredDiffToPersistence(prev, this.authoredStore.state);
    this.ensureValidSelectedSourceId();
    this.notify('authored');
    return true;
  }

  private syncAuthoredDiffToPersistence(
    prev: AuthoredSourcesState,
    next: AuthoredSourcesState
  ): void {
    syncCollectionDiff(
      prev.storedSources,
      next.storedSources,
      this.persistence.save,
      this.persistence.remove
    );
    syncCollectionDiff(
      prev.eqSources,
      next.eqSources,
      this.persistence.saveEq,
      this.persistence.removeEq
    );
    syncCollectionDiff(
      prev.unionSources,
      next.unionSources,
      this.persistence.saveUnion,
      this.persistence.removeUnion
    );
  }

  subscribe(listener: SourceStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(kind: SourceChangeKind): void {
    if (kind !== 'live') {
      this.authoredRevision++;
    }
    for (const listener of this.listeners) {
      listener(kind);
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
      this.notify('authored');
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
      this.selectedSourceId =
        this.telemetry.getLiveSources()[0]?.id ?? 'live-measurement';
      return true;
    }
    return false;
  }

  getActiveLiveSourceId(): string {
    if (isLiveSourceId(this.selectedSourceId)) {
      return this.selectedSourceId;
    }
    return this.telemetry.getLiveSources()[0]?.id ?? 'live-measurement';
  }

  getLiveSources(): readonly SourceData[] {
    return this.telemetry.getLiveSources();
  }

  getLiveSource(id?: string): SourceData | null {
    return this.telemetry.getLiveSource(id ?? this.getActiveLiveSourceId());
  }

  getLiveSourceVisible(id: string = 'live-measurement'): boolean {
    return this.telemetry.getLiveSourceVisible(id);
  }

  setLiveSourceVisible(visible: boolean, id: string = 'live-measurement'): void {
    this.toggleVisibility(id, visible);
  }

  removeLiveSource(id: string): void {
    this.telemetry.removeLiveSource(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId =
        this.telemetry.getLiveSources()[0]?.id ?? 'live-measurement';
    }
    this.notify('selection');
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
    this.notify('selection');
  }

  setLiveFrames(
    frames: readonly SourceData[],
    mixerOnlyTracks?: readonly DetectedFeedbackTrack[],
    options?: SetLiveFramesOptions
  ): void {
    this.telemetry.setLiveFrames(frames, mixerOnlyTracks, options);
    this.notify('live');
  }

  setLiveFrame(live: SourceData): void {
    this.setLiveFrames([live]);
  }

  getMixerOnlyFeedbackTracks(): readonly DetectedFeedbackTrack[] {
    return this.telemetry.getMixerOnlyFeedbackTracks();
  }

  getFeedbackRingLog(): readonly DetectedFeedbackTrack[] {
    return this.telemetry.getFeedbackRingLog();
  }

  clearFeedbackRingLog(): void {
    if (this.telemetry.clearFeedbackRingLog()) {
      this.notify('live');
    }
  }

  applyFeedbackNotchToEq(track: DetectedFeedbackTrack): string {
    let appliedId = '';
    const fallbackLiveId = this.getActiveLiveSourceId();
    this.authoredStore.update((s) => {
      const { eqId, updatedEq, nextEqSources } = applyFeedbackNotchToEqList(
        s.eqSources,
        track,
        () => generateShortId('eq'),
        fallbackLiveId
      );
      appliedId = eqId;
      void this.persistence.saveEq?.(updatedEq);
      return { ...s, eqSources: nextEqSources };
    });
    this.notify('authored');
    return appliedId;
  }

  getActiveEq(): EqualizerSourceConfig | null {
    return (
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ??
      this.eqSources.find((eq) => eq.visible) ??
      null
    );
  }

  getAllSources(): SourceData[] {
    return this.evaluator.evaluateAll(
      this.telemetry.getLiveSources(),
      this.storedSources,
      this.eqSources,
      this.unionSources
    );
  }

  captureCurrentTrace(): SourceData | null {
    const allSources = this.getAllSources();
    const candidate = !this.selectedSourceId.startsWith('stored-')
      ? allSources.find((s) => s.id === this.selectedSourceId)
      : undefined;
    const target = candidate ?? this.getLiveSource();
    if (!target) return null;

    const hasSignal =
      target.levels !== undefined || target.freqData.magnitude.some((v) => v !== 0);
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

    return this.addStoredSource(captured);
  }

  addStoredSource(source: SourceData): SourceData {
    this.authoredStore.update((s) => ({
      ...s,
      storedSources: [...s.storedSources, source],
    }));
    this.selectedSourceId = source.id;
    void this.persistence.save(source);
    this.notify('authored');
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
    this.notify('authored');
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
    this.notify('authored');
  }

  toggleVisibility(id: string, visible: boolean): void {
    if (isLiveSourceId(id)) {
      this.telemetry.setStandaloneLiveVisibility(id, visible);
      this.notify('live');
      return;
    }
    if (id.startsWith('stored-')) {
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
    this.notify('authored');
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
    this.notify('authored');
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
    this.evaluator.evictEq(id);
    void this.persistence.removeEq?.(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify('authored');
  }

  autoFlattenRoomModesWithEq(eqId: string): void {
    const allSources = this.getAllSources();
    this.authoredStore.update((s) => ({
      ...s,
      eqSources: updateInList(
        s.eqSources,
        eqId,
        (eq) => {
          const target = eq.targetSourceId
            ? allSources.find((src) => src.id === eq.targetSourceId) ?? null
            : null;
          return syncEqConfigWithBands(eq, synthesizeRoomMatchEqBands(target));
        },
        this.persistence.saveEq
      ),
    }));
    this.notify('authored');
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
    this.notify('authored');
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
    this.notify('authored');
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
    this.notify('authored');
  }

  dragActiveEqBand(
    bandIndex: number,
    frequency: number,
    gainDb: number,
    q?: number
  ): void {
    const activeEq =
      this.eqSources.find((eq) => eq.id === this.selectedSourceId) ?? this.eqSources[0];
    if (!activeEq) return;

    this.authoredStore.update(
      (s) => ({
        ...s,
        eqSources: s.eqSources.map((eq) => {
          if (eq.id !== activeEq.id) return eq;
          const bands = eq.bands.map((b, i) =>
            i === bandIndex
              ? { ...b, frequency, gainDb, ...(q !== undefined ? { q } : {}) }
              : b
          );
          const updated = syncEqConfigWithBands(eq, bands);
          this.scheduleDebouncedEqSave(updated);
          return updated;
        }),
      }),
      `drag-eq-${activeEq.id}-${bandIndex}`
    );
    this.notify('authored');
  }

  endEqBandDrag(): void {
    this.authoredStore.endTransaction();
  }

  flushPendingPersistence(): void {
    this.authoredStore.endTransaction();
    if (this.eqDragSaveTimer !== null) {
      clearTimeout(this.eqDragSaveTimer);
      this.eqDragSaveTimer = null;
    }
    if (this.pendingDraggedEq) {
      const toSave = this.pendingDraggedEq;
      this.pendingDraggedEq = null;
      void this.persistence.saveEq?.(toSave);
    }
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
    const liveIds = this.telemetry.getLiveSources().map((s) => s.id);
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
    this.notify('authored');
    return newUnion;
  }

  deleteUnionSource(id: string): void {
    this.authoredStore.update((s) => ({
      ...s,
      unionSources: s.unionSources.filter((item) => item.id !== id),
    }));
    this.evaluator.evictUnion(id);
    void this.persistence.removeUnion?.(id);
    if (this.selectedSourceId === id) {
      this.selectedSourceId = this.getActiveLiveSourceId();
    }
    this.notify('authored');
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
    this.notify('authored');
  }
}
