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
 *  - Live measurement frame + persistent visibility state
 *  - Stored trace snapshots + IndexedDB persistence
 *  - Virtual Parametric EQ sources with memoized frequency/impulse evaluation
 *  - Math / Union sources with memoized vector/power evaluation
 */

import { BiquadSpec } from '../dsp/biquad.js';
import {
  EqualizerSourceConfig,
  computeEqualizerSourceData,
  createDefaultEqBands,
} from './eq-source.js';
import {
  deleteStoredTraceFromDb,
  loadAllStoredTracesFromDb,
  saveStoredTraceToDb,
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
}

const defaultPersistenceAdapter: SourcePersistenceAdapter = {
  loadAll: loadAllStoredTracesFromDb,
  save: saveStoredTraceToDb,
  remove: deleteStoredTraceFromDb,
};

function generateShortId(prefix: string): string {
  const uid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${uid}`;
}

export class SourceStore {
  private liveSource: SourceData | null = null;
  private liveSourceVisible = true;
  private storedSources: SourceData[] = [];
  private eqSources: EqualizerSourceConfig[] = [];
  private unionSources: UnionSourceConfig[] = [];
  private selectedSourceId = 'live-measurement';

  private readonly persistence: SourcePersistenceAdapter;
  private readonly listeners = new Set<() => void>();

  private readonly eqEvalCache = new Map<
    string,
    { cfg: EqualizerSourceConfig; target: SourceData | null; data: SourceData }
  >();
  private readonly unionEvalCache = new Map<
    string,
    { cfg: UnionSourceConfig; inputs: SourceData[]; data: SourceData }
  >();
  private lastAllSourcesRef: {
    live: SourceData | null;
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
    const loaded = await this.persistence.loadAll();
    if (loaded.length > 0) {
      this.storedSources = loaded;
      this.notify();
    }
  }

  getLiveSource(): SourceData | null {
    return this.liveSource;
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

  setLiveFrame(live: SourceData): void {
    this.liveSource = this.liveSourceVisible ? live : { ...live, visible: false };
    this.notify();
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
      this.lastAllSourcesRef.live === this.liveSource &&
      this.lastAllSourcesRef.stored === this.storedSources &&
      this.lastAllSourcesRef.eq === this.eqSources &&
      this.lastAllSourcesRef.union === this.unionSources
    ) {
      return this.lastAllSourcesRef.result;
    }

    const list: SourceData[] = [];
    if (this.liveSource) {
      list.push(this.liveSource);
    }
    list.push(...this.storedSources);

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
      live: this.liveSource,
      stored: this.storedSources,
      eq: this.eqSources,
      union: this.unionSources,
      result: list,
    };

    return list;
  }

  captureCurrentTrace(): SourceData | null {
    const allSources = this.getAllSources();
    const target =
      allSources.find((s) => s.id === this.selectedSourceId) ?? this.liveSource;
    if (!target) return null;

    const paletteIdx = (this.storedSources.length + 1) % DEFAULT_SOURCE_PALETTE.length;
    const captured = cloneSourceDataAsStored(
      target,
      `${target.name} #${this.storedSources.length + 1}`,
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
      this.selectedSourceId = 'live-measurement';
    }
    this.notify();
  }

  updateStoredSource(
    id: string,
    partial: Partial<Pick<SourceData, 'name' | 'gainOffsetDb' | 'delayOffsetMs'>>
  ): void {
    this.storedSources = this.storedSources.map((s) => {
      if (s.id !== id) return s;
      const updated = { ...s, ...partial };
      void this.persistence.save(updated);
      return updated;
    });
    this.notify();
  }

  toggleVisibility(id: string, visible: boolean): void {
    if (id === 'live-measurement') {
      this.liveSourceVisible = visible;
      if (this.liveSource) {
        this.liveSource = { ...this.liveSource, visible };
      }
    } else if (id.startsWith('stored-')) {
      this.storedSources = this.storedSources.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, visible };
        void this.persistence.save(updated);
        return updated;
      });
    } else if (id.startsWith('eq-')) {
      this.eqSources = this.eqSources.map((s) =>
        s.id === id ? { ...s, visible } : s
      );
    } else if (id.startsWith('union-')) {
      this.unionSources = this.unionSources.map((s) =>
        s.id === id ? { ...s, visible } : s
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
      targetSourceId: 'live-measurement',
    };
    this.eqSources = [...this.eqSources, newEq];
    this.selectedSourceId = id;
    this.notify();
    return newEq;
  }

  autoFlattenRoomModesWithEq(eqId: string): void {
    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== eqId) return eq;
      return {
        ...eq,
        bands: [
          { type: 'highpass', frequency: 35, q: 0.707, gainDb: 0, enabled: false },
          { type: 'lowshelf', frequency: 100, q: 0.707, gainDb: 0, enabled: true },
          { type: 'peaking', frequency: 160, q: 2.2, gainDb: -6.5, enabled: true },
          { type: 'peaking', frequency: 800, q: 3.0, gainDb: 5.0, enabled: true },
          { type: 'peaking', frequency: 3200, q: 2.5, gainDb: -3.5, enabled: true },
          { type: 'highshelf', frequency: 9000, q: 0.707, gainDb: 6.0, enabled: true },
        ],
      };
    });
    this.notify();
  }

  setEqTargetSource(eqId: string, targetSourceId: string | null): void {
    this.eqSources = this.eqSources.map((item) =>
      item.id === eqId ? { ...item, targetSourceId } : item
    );
    this.notify();
  }

  updateEqBand(eqId: string, bandIdx: number, partial: Partial<BiquadSpec>): void {
    this.eqSources = this.eqSources.map((eq) => {
      if (eq.id !== eqId) return eq;
      const bands = eq.bands.map((b, i) => (i === bandIdx ? { ...b, ...partial } : b));
      return { ...eq, bands };
    });
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
      return { ...eq, bands };
    });
    this.notify();
  }

  addUnionSource(): UnionSourceConfig {
    const id = generateShortId('union');
    const allIds = ['live-measurement', ...this.storedSources.map((s) => s.id)];
    const newUnion: UnionSourceConfig = {
      id,
      name: `Math Union #${this.unionSources.length + 1}`,
      color: '#f59e0b',
      visible: true,
      operation: 'vector-avg',
      sourceIds: [allIds[0], allIds[1] ?? allIds[0]],
    };
    this.unionSources = [...this.unionSources, newUnion];
    this.selectedSourceId = id;
    this.notify();
    return newUnion;
  }

  updateUnionSource(
    unionId: string,
    partial: Partial<Pick<UnionSourceConfig, 'operation' | 'sourceIds'>>
  ): void {
    this.unionSources = this.unionSources.map((u) =>
      u.id === unionId ? { ...u, ...partial } : u
    );
    this.notify();
  }
}
