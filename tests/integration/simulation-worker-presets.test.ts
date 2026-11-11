/**
 * WebSpeakerSim
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { DEMO_VENUE_PRESETS } from '../../src/library/demo-presets.js';
import {
  SimulationWorkerEngine,
  collectResponseTransferables,
} from '../../src/physics/sim-worker-core.js';

describe('SimulationWorkerEngine & Demo Venue Presets integration', () => {
  it('evaluates Plan grids, Section grids, coverage metrics, and Virtual Mics across all built-in presets', () => {
    const worker = new SimulationWorkerEngine(true);
    expect(worker.getSpeakerCount()).toBe(7);

    let reqId = 1;
    for (const preset of DEMO_VENUE_PRESETS) {
      const scene = preset.createScene();
      const res = worker.handleMessage({
        type: 'EVALUATE_SCENE',
        requestId: reqId++,
        scene,
        planStepM: 1.5,
        sectionStepM: 1.0,
      });

      expect(res).not.toBeNull();
      expect(res!.planGrid).not.toBeNull();
      expect(res!.sectionGrid).not.toBeNull();

      const stats = res!.planGrid!.stats;
      expect(stats.audienceSampleCount).toBeGreaterThan(20);
      expect(stats.meanAudienceSplDb).toBeGreaterThan(80);
      expect(stats.meanAudienceSplDb).toBeLessThan(130);
      expect(stats.audienceToStageRejectionDb).not.toBeNull();
      // Every demo preset aims mains forward and deploys directional/delayed subs so mean audience SPL > mean stage SPL
      expect(stats.audienceToStageRejectionDb!).toBeGreaterThan(1.5);

      expect(res!.virtualMics.length).toBe(scene.virtualMics.length);
      for (const vm of res!.virtualMics) {
        expect(vm.frequenciesHz.length).toBe(241);
        expect(vm.arrivals.length).toBeGreaterThan(0);
        expect(Number.isFinite(vm.broadbandSplADb)).toBe(true);
      }

      const transferables = collectResponseTransferables(res!);
      expect(transferables.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('improves 63 Hz stage bass rejection by > 10 dB in cardioid-csa mode vs broadside mode', () => {
    const worker = new SimulationWorkerEngine(true);
    const clubScene = DEMO_VENUE_PRESETS[0].createScene();

    const cardioid63Scene = {
      ...clubScene,
      bandSelection: { kind: 'single' as const, frequencyHz: 63 },
    };
    const broadside63Scene = {
      ...cardioid63Scene,
      subArrays: clubScene.subArrays.map((sa) => ({ ...sa, mode: 'broadside' as const })),
    };

    const cardRes = worker.handleMessage({
      type: 'EVALUATE_SCENE',
      requestId: 10,
      scene: cardioid63Scene,
      planStepM: 0.75,
      sectionStepM: 1.0,
      includeSectionGrid: false,
      includeVirtualMics: false,
    })!;
    const broadRes = worker.handleMessage({
      type: 'EVALUATE_SCENE',
      requestId: 11,
      scene: broadside63Scene,
      planStepM: 0.75,
      sectionStepM: 1.0,
      includeSectionGrid: false,
      includeVirtualMics: false,
    })!;

    const cardRej = cardRes.planGrid!.stats.audienceToStageRejectionDb!;
    const broadRej = broadRes.planGrid!.stats.audienceToStageRejectionDb!;
    expect(cardRej - broadRej).toBeGreaterThan(10);
  });
});
