/**
 * Dedicated Background DSP Web Worker (`dsp.worker.ts`).
 *
 * Runs the `MeasurementPipeline` at ~25-30 Hz, reading either:
 *  - Real-time hardware samples from `DualChannelRingBuffer` (when in 'hardware' input mode), OR
 *  - Deterministic simulated PA/room samples from `SignalGenerator` + `SyntheticAcousticRig`
 *    (when in 'simulator' input mode, enabling zero-setup demos and E2E testing).
 */

import { DualChannelRingBuffer, RingBufferStorage } from '../audio/ring-buffer.js';
import {
  MeasurementPipeline,
  MeasurementPipelineConfig,
} from './analyzer-pipeline.js';
import { parseCalibrationFile } from './calibration.js';
import {
  SignalGenerator,
  SignalGeneratorConfig,
} from './signal-generator.js';
import {
  SIMULATOR_PRESETS,
  SimulatorPresetId,
  SimulatorRigConfig,
  SyntheticAcousticRig,
} from './synthetic-rig.js';

export type InputSourceMode = 'simulator' | 'hardware';

export type WorkerInboundMessage =
  | { type: 'init'; sampleRate: number; ringBufferStorage?: RingBufferStorage }
  | { type: 'set-input-mode'; mode: InputSourceMode }
  | { type: 'set-simulator-preset'; preset: SimulatorPresetId | SimulatorRigConfig }
  | { type: 'update-measurement-config'; config: Partial<MeasurementPipelineConfig> }
  | { type: 'update-generator-config'; config: Partial<SignalGeneratorConfig> }
  | { type: 'load-calibration'; text: string; name: string }
  | { type: 'clear-calibration' }
  | { type: 'find-delay' }
  | { type: 'apply-estimated-delay' }
  | { type: 'reset-averaging' }
  | { type: 'audio-chunk'; m: Float32Array; r: Float32Array }
  | { type: 'pause'; paused: boolean };

let sampleRate = 48000;
let inputMode: InputSourceMode = 'simulator';
let isPaused = false;

const pipeline = new MeasurementPipeline({ sampleRate });
const generator = new SignalGenerator(sampleRate);
const simulatorRig = new SyntheticAcousticRig(sampleRate, 'pa-room-modes');
let ringBuffer: DualChannelRingBuffer | null = null;

// Scratch buffers for simulation & ring buffer draining
const simChunkSize = 2048;
const simRefBuf = new Float32Array(simChunkSize);
const simMeasBuf = new Float32Array(simChunkSize);
const hwReadBufM = new Float32Array(4096);
const hwReadBufR = new Float32Array(4096);

let lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

function tick(): void {
  if (isPaused) {
    lastTickTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return;
  }

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dtSeconds = Math.max(0.005, Math.min(0.25, (now - lastTickTime) / 1000.0));
  lastTickTime = now;

  try {
    if (inputMode === 'simulator') {
      // Synthesize ~42.6 ms (2048 samples at 48 kHz) per tick
      generator.fillBuffer(simRefBuf, simChunkSize);
      simulatorRig.processBlock(simRefBuf, simMeasBuf, simChunkSize);
      pipeline.writeSamples(simMeasBuf, simRefBuf, simChunkSize);
    } else if (ringBuffer) {
      let avail = ringBuffer.availableRead();
      while (avail > 0) {
        const toRead = Math.min(avail, hwReadBufM.length);
        const readCount = ringBuffer.read(hwReadBufM, hwReadBufR, toRead);
        if (readCount <= 0) break;
        pipeline.writeSamples(hwReadBufM, hwReadBufR, readCount);
        avail -= readCount;
      }
    }

    const snapshot = pipeline.computeTransform(dtSeconds);
    self.postMessage({
      type: 'measurement-frame',
      sourceData: snapshot,
    });
  } catch (err) {
    self.postMessage({
      type: 'worker-error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const intervalId = setInterval(tick, 40); // 25 FPS DSP transform rate

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  try {
    switch (msg.type) {
      case 'init':
        sampleRate = msg.sampleRate || 48000;
        pipeline.updateConfig({ sampleRate });
        generator.setSampleRate(sampleRate);
        simulatorRig.setSampleRate(sampleRate);
        if (msg.ringBufferStorage) {
          ringBuffer = new DualChannelRingBuffer(msg.ringBufferStorage);
        }
        break;

      case 'set-input-mode':
        if (msg.mode === 'hardware' && ringBuffer) {
          ringBuffer.clear();
        }
        inputMode = msg.mode;
        pipeline.resetAveraging();
        break;

      case 'set-simulator-preset':
        simulatorRig.setConfig(msg.preset);
        pipeline.resetAveraging();
        self.postMessage({
          type: 'simulator-config-updated',
          config: simulatorRig.getConfig(),
        });
        break;

      case 'update-measurement-config':
        if (msg.config.sampleRate !== undefined && msg.config.sampleRate !== sampleRate) {
          sampleRate = msg.config.sampleRate;
          generator.setSampleRate(sampleRate);
          simulatorRig.setSampleRate(sampleRate);
        }
        pipeline.updateConfig(msg.config);
        self.postMessage({
          type: 'measurement-config-updated',
          config: pipeline.getConfig(),
        });
        break;

      case 'update-generator-config':
        generator.updateConfig(msg.config);
        break;

      case 'load-calibration': {
        const curve = parseCalibrationFile(msg.text, msg.name);
        pipeline.setCalibrationCurve(curve);
        pipeline.updateConfig({ calibrationEnabled: curve.points.length > 0 });
        self.postMessage({
          type: 'calibration-loaded',
          name: curve.name,
          pointCount: curve.points.length,
        });
        break;
      }

      case 'clear-calibration':
        pipeline.setCalibrationCurve(null);
        pipeline.updateConfig({ calibrationEnabled: false });
        break;

      case 'find-delay': {
        const est = pipeline.findDelayNow();
        self.postMessage({
          type: 'delay-found',
          estimate: est,
        });
        break;
      }

      case 'apply-estimated-delay': {
        const est = pipeline.findDelayNow();
        const roundedMs = Math.round(est.delayMs * 100) / 100;
        pipeline.updateConfig({ delayMs: roundedMs });
        self.postMessage({
          type: 'measurement-config-updated',
          config: pipeline.getConfig(),
        });
        break;
      }

      case 'reset-averaging':
        pipeline.resetAveraging();
        break;

      case 'audio-chunk':
        if (inputMode === 'hardware') {
          pipeline.writeSamples(msg.m, msg.r, msg.m.length);
        }
        break;

      case 'pause':
        isPaused = msg.paused;
        break;
    }
  } catch (err) {
    self.postMessage({
      type: 'worker-error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export { intervalId, SIMULATOR_PRESETS };

