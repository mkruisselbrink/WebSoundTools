// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type EqualizerSourceConfig,
  computeEqualizerSourceData,
} from './eq-source.js';
import type { SourceData } from './source-data.js';
import {
  type UnionSourceConfig,
  computeUnionSourceData,
} from './union-source.js';

/**
 * Memoized evaluator combining live measurement frames, stored traces, Virtual EQs,
 * and Math Unions into a single ordered `SourceData[]` array without redundant per-frame
 * biquad or complex-phasor recomputation when inputs are unchanged.
 */
export class DerivedSourceEvaluator {
  private readonly eqEvalCache = new Map<
    string,
    { cfg: EqualizerSourceConfig; target: SourceData | null; data: SourceData }
  >();
  private readonly unionEvalCache = new Map<
    string,
    { cfg: UnionSourceConfig; inputs: SourceData[]; data: SourceData }
  >();
  private lastAllSourcesRef: {
    live: readonly SourceData[];
    stored: readonly SourceData[];
    eq: readonly EqualizerSourceConfig[];
    union: readonly UnionSourceConfig[];
    result: SourceData[];
  } | null = null;

  public evictEq(id: string): void {
    this.eqEvalCache.delete(id);
  }

  public evictUnion(id: string): void {
    this.unionEvalCache.delete(id);
  }

  public evaluateAll(
    liveSources: readonly SourceData[],
    storedSources: readonly SourceData[],
    eqSources: readonly EqualizerSourceConfig[],
    unionSources: readonly UnionSourceConfig[]
  ): SourceData[] {
    if (
      this.lastAllSourcesRef &&
      this.lastAllSourcesRef.live === liveSources &&
      this.lastAllSourcesRef.stored === storedSources &&
      this.lastAllSourcesRef.eq === eqSources &&
      this.lastAllSourcesRef.union === unionSources
    ) {
      return this.lastAllSourcesRef.result;
    }

    const list: SourceData[] = [...liveSources, ...storedSources];

    for (const eqCfg of eqSources) {
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

    for (const uCfg of unionSources) {
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
      live: liveSources,
      stored: storedSources,
      eq: eqSources,
      union: unionSources,
      result: list,
    };

    return list;
  }
}
