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
 * Pure simulation worker message protocol & stateful handler (`src/physics/sim-worker-core.ts`).
 * Decoupled from `WorkerGlobalScope` so unit and integration tests can exercise the exact
 * worker state machine synchronously in Node.
 */

import { getBuiltinSpeakers } from '../library/builtin-speakers.js';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { ProjectScene } from '../model/project-types.js';
import {
  evaluatePlanGrid,
  evaluateSectionGrid,
  expandSceneRadiators,
  type PlanGridResult,
  type SectionGridResult,
} from './summation-solver.js';
import {
  evaluateVirtualMicFromRadiators,
  type VirtualMicResponse,
} from './virtual-mic-solver.js';

export type SimulationWorkerRequest =
  | {
      readonly type: 'UPSERT_SPEAKERS';
      readonly speakers: readonly SpeakerDefinition[];
    }
  | {
      readonly type: 'REMOVE_SPEAKER';
      readonly speakerId: string;
    }
  | {
      readonly type: 'EVALUATE_SCENE';
      readonly requestId: number;
      readonly scene: ProjectScene;
      readonly planStepM: number;
      readonly sectionStepM: number;
      readonly includePlanGrid?: boolean;
      readonly includeSectionGrid?: boolean;
      readonly includeVirtualMics?: boolean;
    };

export interface SimulationWorkerResponse {
  readonly type: 'SCENE_RESULT';
  readonly requestId: number;
  readonly computeTimeMs: number;
  readonly planGrid: PlanGridResult | null;
  readonly sectionGrid: SectionGridResult | null;
  readonly virtualMics: readonly VirtualMicResponse[];
}

export class SimulationWorkerEngine {
  private readonly speakers = new Map<string, SpeakerDefinition>();

  constructor(seedBuiltinSpeakers: boolean = true) {
    if (seedBuiltinSpeakers) {
      for (const spk of getBuiltinSpeakers()) {
        this.speakers.set(spk.id, spk);
      }
    }
  }

  public getSpeakerCount(): number {
    return this.speakers.size;
  }

  public handleMessage(msg: SimulationWorkerRequest): SimulationWorkerResponse | null {
    switch (msg.type) {
      case 'UPSERT_SPEAKERS': {
        for (const spk of msg.speakers) {
          this.speakers.set(spk.id, spk);
        }
        return null;
      }
      case 'REMOVE_SPEAKER': {
        this.speakers.delete(msg.speakerId);
        return null;
      }
      case 'EVALUATE_SCENE': {
        const t0 = performance.now();
        const includePlan = msg.includePlanGrid ?? true;
        const includeSection = msg.includeSectionGrid ?? true;
        const includeMics = msg.includeVirtualMics ?? true;

        const planGrid = includePlan
          ? evaluatePlanGrid(msg.scene, this.speakers, msg.planStepM)
          : null;
        const sectionGrid = includeSection
          ? evaluateSectionGrid(msg.scene, this.speakers, msg.sectionStepM)
          : null;

        const virtualMics: VirtualMicResponse[] = [];
        if (includeMics) {
          const radiators = expandSceneRadiators(msg.scene, this.speakers);
          for (const mic of msg.scene.virtualMics) {
            if (!mic.enabled) continue;
            virtualMics.push(evaluateVirtualMicFromRadiators(mic, msg.scene, radiators));
          }
        }

        return {
          type: 'SCENE_RESULT',
          requestId: msg.requestId,
          computeTimeMs: performance.now() - t0,
          planGrid,
          sectionGrid,
          virtualMics,
        };
      }
    }
  }
}

/** Collects underlying `ArrayBuffer`s from a `SimulationWorkerResponse` for zero-copy `postMessage` transfer. */
export function collectResponseTransferables(res: SimulationWorkerResponse): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  if (res.planGrid) {
    buffers.add(res.planGrid.splDb.buffer as ArrayBuffer);
    buffers.add(res.planGrid.surfaceMask.buffer as ArrayBuffer);
  }
  if (res.sectionGrid) {
    buffers.add(res.sectionGrid.splDb.buffer as ArrayBuffer);
  }
  for (const mic of res.virtualMics) {
    buffers.add(mic.frequenciesHz.buffer as ArrayBuffer);
    buffers.add(mic.magnitudeDbSpl.buffer as ArrayBuffer);
    buffers.add(mic.phaseDeg.buffer as ArrayBuffer);
    buffers.add(mic.groupDelayMs.buffer as ArrayBuffer);
  }
  return Array.from(buffers);
}

