// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { getDemoPresetById } from '../library/demo-presets.js';
import { ProjectStore } from '../model/project-store.js';
import { SimulationController } from './sim-controller.js';

describe('SimulationController.whenIdle', () => {
  it('resolves immediately after synchronous fallback evaluation and waits across interactive refine', async () => {
    vi.useFakeTimers();
    try {
      const store = new ProjectStore(getDemoPresetById('club-cardioid-pa').createScene());
      const controller = new SimulationController(store, false);

      expect(controller.isIdle).toBe(true);
      await expect(controller.whenIdle()).resolves.toBeUndefined();

      // Trigger interactive evaluation (schedules 95 ms fine refinement timer)
      controller.scheduleEvaluation(true);
      expect(controller.isIdle).toBe(false);

      let settled = false;
      const idlePromise = controller.whenIdle().then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      await idlePromise;
      expect(settled).toBe(true);
      expect(controller.isIdle).toBe(true);

      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
