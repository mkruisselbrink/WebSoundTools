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
