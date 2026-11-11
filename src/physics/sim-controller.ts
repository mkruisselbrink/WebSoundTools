/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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
 * Main-thread Simulation Controller (`src/physics/sim-controller.ts`) coordinating
 * coarse-to-fine progressive worker evaluation with zero-backlog request coalescing.
 */

import type { ProjectStore } from '../model/project-store.js';
import {
  SimulationWorkerEngine,
  type SimulationWorkerRequest,
  type SimulationWorkerResponse,
} from './sim-worker-core.js';
import type { PlanGridResult, SectionGridResult } from './summation-solver.js';
import type { VirtualMicResponse } from './virtual-mic-solver.js';

export interface SimulationSnapshot {
  readonly planGrid: PlanGridResult | null;
  readonly sectionGrid: SectionGridResult | null;
  readonly virtualMics: readonly VirtualMicResponse[];
  readonly computeTimeMs: number;
  readonly isRefining: boolean;
}

export type SimulationSnapshotListener = (snapshot: SimulationSnapshot) => void;

export class SimulationController {
  private readonly store: ProjectStore;
  private worker: Worker | null = null;
  private fallbackEngine: SimulationWorkerEngine | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private readonly listeners = new Set<SimulationSnapshotListener>();

  private nextRequestId = 1;
  private inFlight = false;
  private pendingQuality: 'coarse' | 'fine' | null = null;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;

  private latestSnapshot: SimulationSnapshot = {
    planGrid: null,
    sectionGrid: null,
    virtualMics: [],
    computeTimeMs: 0,
    isRefining: false,
  };

  constructor(store: ProjectStore, preferWebWorker: boolean = true) {
    this.store = store;

    if (preferWebWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (ev: MessageEvent<SimulationWorkerResponse>) => {
          this.onWorkerResult(ev.data);
        };
      } catch {
        this.worker = null;
      }
    }

    if (!this.worker) {
      this.fallbackEngine = new SimulationWorkerEngine(true);
    }

    this.syncCustomSpeakers();

    this.unsubscribeStore = this.store.subscribe((changeKind, isInteractive) => {
      if (changeKind === 'speakers') {
        this.syncCustomSpeakers();
        this.scheduleEvaluation(false);
      } else if (changeKind === 'scene') {
        this.scheduleEvaluation(isInteractive);
      }
    });

    // Initial evaluation
    this.scheduleEvaluation(false);
  }

  public get snapshot(): SimulationSnapshot {
    return this.latestSnapshot;
  }

  public subscribe(listener: SimulationSnapshotListener): () => void {
    this.listeners.add(listener);
    if (this.latestSnapshot.planGrid) {
      listener(this.latestSnapshot);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.refineTimer !== null) {
      clearTimeout(this.refineTimer);
      this.refineTimer = null;
    }
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private postToEngine(msg: SimulationWorkerRequest): void {
    if (this.worker) {
      this.worker.postMessage(msg);
    } else if (this.fallbackEngine) {
      const res = this.fallbackEngine.handleMessage(msg);
      if (res) {
        this.onWorkerResult(res);
      }
    }
  }

  private syncCustomSpeakers(): void {
    const allCustom = this.store.getCustomSpeakers();
    if (allCustom.length > 0) {
      this.postToEngine({
        type: 'UPSERT_SPEAKERS',
        speakers: allCustom,
      });
    }
  }

  public scheduleEvaluation(isInteractive: boolean): void {
    if (this.refineTimer !== null) {
      clearTimeout(this.refineTimer);
      this.refineTimer = null;
    }

    const quality: 'coarse' | 'fine' = isInteractive ? 'coarse' : 'fine';
    this.requestQuality(quality);

    if (isInteractive) {
      this.refineTimer = setTimeout(() => {
        this.refineTimer = null;
        this.requestQuality('fine');
      }, 95);
    }
  }

  private requestQuality(quality: 'coarse' | 'fine'): void {
    if (this.inFlight) {
      // Upgrade pending quality to 'fine' if requested, otherwise keep 'coarse'
      if (this.pendingQuality !== 'fine') {
        this.pendingQuality = quality;
      }
      return;
    }
    this.dispatchNow(quality);
  }

  private dispatchNow(quality: 'coarse' | 'fine'): void {
    const scene = this.store.scene;
    const xSpan = Math.max(5, scene.planBounds.xMax - scene.planBounds.xMin);
    const ySpan = Math.max(5, scene.planBounds.yMax - scene.planBounds.yMin);
    const maxPlanSpan = Math.max(xSpan, ySpan);

    // Target ~48 cells on coarse pass (< 8 ms) and ~96 cells on fine pass (< 25 ms)
    const planStepM =
      quality === 'coarse'
        ? Math.max(0.45, maxPlanSpan / 46)
        : Math.max(0.22, maxPlanSpan / 96);

    const secSpan = Math.max(
      5,
      scene.sectionBounds.xMax - scene.sectionBounds.xMin
    );
    const sectionStepM =
      quality === 'coarse'
        ? Math.max(0.4, secSpan / 46)
        : Math.max(0.2, secSpan / 92);

    this.inFlight = true;
    const requestId = this.nextRequestId++;

    this.postToEngine({
      type: 'EVALUATE_SCENE',
      requestId,
      scene,
      planStepM,
      sectionStepM,
    });
  }

  private onWorkerResult(res: SimulationWorkerResponse): void {
    this.inFlight = false;
    const willRefine = this.pendingQuality !== null || this.refineTimer !== null;

    this.latestSnapshot = {
      planGrid: res.planGrid ?? this.latestSnapshot.planGrid,
      sectionGrid: res.sectionGrid ?? this.latestSnapshot.sectionGrid,
      virtualMics: res.virtualMics,
      computeTimeMs: res.computeTimeMs,
      isRefining: willRefine,
    };

    for (const fn of this.listeners) {
      fn(this.latestSnapshot);
    }

    if (this.pendingQuality !== null) {
      const nextQ = this.pendingQuality;
      this.pendingQuality = null;
      this.dispatchNow(nextQ);
    }
  }
}
