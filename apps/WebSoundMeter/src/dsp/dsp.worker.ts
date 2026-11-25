// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Dedicated Background DSP Web Worker entrypoint (`dsp.worker.ts`), wiring a 40 ms
 * wall-clock tick loop and `self.onmessage` to `DspWorkerRuntime`.
 */

import {
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
} from './analyzer-pipeline.js';
import type {
  InputSourceMode,
  LiveMeasurementSlotConfig,
  WorkerInboundMessage,
} from './dsp-worker-protocol.js';
import { DspWorkerRuntime } from './dsp-worker-runtime.js';
import { SIMULATOR_PRESETS } from './synthetic-rig.js';

export {
  DspWorkerRuntime,
  REFERENCE_CHANNEL_GLOBAL,
  SHARED_MEASUREMENT_CONFIG_KEYS,
  SIMULATOR_PRESETS,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
};
export type { InputSourceMode, LiveMeasurementSlotConfig, WorkerInboundMessage };

const runtime = new DspWorkerRuntime((msg) => self.postMessage(msg));

let lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

function tick(): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dtSeconds = (now - lastTickTime) / 1000.0;
  lastTickTime = now;
  if (!runtime.isPaused) {
    runtime.tick(dtSeconds, Date.now());
  }
}

export const intervalId = setInterval(tick, 40);

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  if (event.data) {
    runtime.handleMessage(event.data);
  }
};
