// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dedicated Simulation Web Worker entrypoint (`src/physics/sim.worker.ts`).
 */

import {
  SimulationWorkerEngine,
  collectResponseTransferables,
  type SimulationWorkerRequest,
} from './sim-worker-core.js';

const engine = new SimulationWorkerEngine(true);

interface DedicatedWorkerScopeLike {
  onmessage: ((event: MessageEvent<SimulationWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerSelf = self as unknown as DedicatedWorkerScopeLike;

workerSelf.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const response = engine.handleMessage(event.data);
  if (response) {
    const transfer = collectResponseTransferables(response);
    workerSelf.postMessage(response, transfer);
  }
};

