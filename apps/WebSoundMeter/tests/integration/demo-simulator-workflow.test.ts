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

import { describe, it, expect } from 'vitest';
import { SyntheticAcousticRig, SIMULATOR_PRESETS } from '../../src/dsp/synthetic-rig.js';
import { MeasurementPipeline } from '../../src/dsp/analyzer-pipeline.js';
import { SignalGenerator } from '../../src/dsp/signal-generator.js';
import {
  cloneSourceDataAsStored,
  serializeSourceData,
  deserializeSourceData,
} from '../../src/sources/source-data.js';
import { computeEqualizerSourceData, createDefaultEqBands } from '../../src/sources/eq-source.js';
import { computeUnionSourceData } from '../../src/sources/union-source.js';
import { buildTraceVertices, computeCursorReadout } from '../../src/charts/plot-types.js';
import { parseCalibrationFile } from '@foh/acoustics';

describe('End-to-End Demo Simulator & PA Tuning Workflows', () => {
  it('verifies all 5 built-in simulator presets produce valid acoustic measurements', () => {
    const sampleRate = 48000;

    for (const presetInfo of Object.values(SIMULATOR_PRESETS)) {
      const gen = new SignalGenerator(sampleRate, {
        enabled: true,
        type: 'pink',
        levelDbFs: -12,
      });
      const rig = new SyntheticAcousticRig(sampleRate, presetInfo.id);
      const pipeline = new MeasurementPipeline({
        sampleRate,
        fftSize: 4096,
        windowType: 'hann',
        averagingType: 'fifo',
        fifoDepth: 4,
        octaveSmoothing: '1/12',
      });

      const refBlock = new Float32Array(2048);
      const measBlock = new Float32Array(2048);
      for (let i = 0; i < 6; i++) {
        gen.fillBuffer(refBlock);
        rig.processBlock(refBlock, measBlock);
        pipeline.writeSamples(measBlock, refBlock);
      }

      const data = pipeline.computeTransform();
      expect(data.freqData.length).toBe(2049);
      expect(data.levels).toBeDefined();
      expect(Number.isFinite(data.levels!.levelsDb.A.Fast)).toBe(true);
      expect(Number.isFinite(data.levels!.levelsDb.A.Leq)).toBe(true);
      expect(data.levels!.levelsDb.Z.Fast).toBeGreaterThan(40);
    }
  });

  it('runs full PA Alignment & Tuning workflow: Delay Finder -> Stored Trace -> Auto-EQ -> Union Math -> Chart Vertices', () => {
    const sampleRate = 48000;
    const gen = new SignalGenerator(sampleRate, {
      enabled: true,
      type: 'pink',
      levelDbFs: -12,
    });
    const rig = new SyntheticAcousticRig(sampleRate, 'pa-room-modes');
    const pipeline = new MeasurementPipeline({
      sampleRate,
      fftSize: 4096,
      windowType: 'hann',
      averagingType: 'fifo',
      fifoDepth: 8,
      octaveSmoothing: '1/12',
    });

    const refBlock = new Float32Array(4096);
    const measBlock = new Float32Array(4096);

    // Step 1: Run initial measurement before delay compensation
    for (let i = 0; i < 8; i++) {
      gen.fillBuffer(refBlock);
      rig.processBlock(refBlock, measBlock);
      pipeline.writeSamples(measBlock, refBlock);
    }
    const est = pipeline.findDelayNow();
    expect(est.delayMs).toBeCloseTo(8.5, 1);

    // Step 2: Apply Found Delay (simulates clicking "Apply Delay" in UI)
    pipeline.updateConfig({
      delayMs: est.delayMs,
    });
    let alignedLive = pipeline.computeTransform();
    for (let i = 0; i < 8; i++) {
      gen.fillBuffer(refBlock);
      rig.processBlock(refBlock, measBlock);
      pipeline.writeSamples(measBlock, refBlock);
      alignedLive = pipeline.computeTransform();
    }

    // Impulse response peak should now be centered at t = 0 ms (index 2048)
    expect(Math.abs(alignedLive.timeData.impulse[2048])).toBeGreaterThan(0.25);

    // Step 3: Capture a Stored Trace & verify serialization round-trip (IndexedDB storage model)
    const capturedTrace = cloneSourceDataAsStored(alignedLive, 'Before EQ', '#ffab00');
    const serialized = serializeSourceData(capturedTrace);
    const restoredTrace = deserializeSourceData(serialized);
    expect(restoredTrace.kind).toBe('stored');
    expect(restoredTrace.name).toBe('Before EQ');
    expect(restoredTrace.freqData.length).toBe(capturedTrace.freqData.length);
    expect(restoredTrace.freqData.magnitude[14]).toBeCloseTo(capturedTrace.freqData.magnitude[14], 5);

    // Step 4: Create Virtual Equalizer & auto-compensate room modes (160 Hz peak, 800 Hz dip)
    const bands = createDefaultEqBands();
    // Auto-invert magnitude at each peaking band frequency
    const df = sampleRate / 4096;
    for (let b = 0; b < bands.length; b++) {
      if (bands[b].type === 'peaking' && bands[b].enabled !== false) {
        const binIdx = Math.round(bands[b].frequency / df);
        const mag = restoredTrace.freqData.magnitude[binIdx];
        const currentDb = mag > 1e-6 ? 20 * Math.log10(mag) : 0;
        bands[b] = { ...bands[b], gainDb: -currentDb };
      }
    }

    const eqData = computeEqualizerSourceData(
      {
        id: 'eq-1',
        name: 'Virtual EQ 1',
        color: '#e040fb',
        visible: true,
        bands,
        targetSourceId: null,
      },
      null,
      restoredTrace.freqData.length,
      sampleRate
    );

    // Step 5: Combine Captured Trace + Virtual EQ in a Union Math Source ('apply' = A * B)
    const predictedPostEq = computeUnionSourceData(
      {
        id: 'union-1',
        name: 'Predicted Post-EQ',
        color: '#69f0ae',
        visible: true,
        operation: 'apply',
        sourceIds: [restoredTrace.id, eqData.id],
      },
      [restoredTrace, eqData]
    );

    // Verify that the 160 Hz room mode peak (+6.5 dB) is flattened in the predicted response
    const bin160 = Math.round(160 / df);
    const beforeDb160 = 20 * Math.log10(restoredTrace.freqData.magnitude[bin160]);
    const afterDb160 = 20 * Math.log10(predictedPostEq.freqData.magnitude[bin160]);
    expect(Math.abs(afterDb160)).toBeLessThan(Math.abs(beforeDb160));

    // Step 6: Verify WebGL/Canvas chart vertex builders & cursor readouts on all plot types
    const magVerts = buildTraceVertices(predictedPostEq, 'magnitude', 20, 20000, -24, 24);
    expect(magVerts.vertexCount).toBeGreaterThan(100);

    const phaseVerts = buildTraceVertices(predictedPostEq, 'phase', 20, 20000, -180, 180);
    expect(phaseVerts.vertexCount).toBeGreaterThan(100);

    const gdVerts = buildTraceVertices(predictedPostEq, 'group-delay', 20, 20000, -20, 20);
    expect(gdVerts.vertexCount).toBeGreaterThan(100);

    const irVerts = buildTraceVertices(alignedLive, 'impulse', -10, 30, -1, 1);
    expect(irVerts.vertexCount).toBeGreaterThan(50);

    const cursor = computeCursorReadout('magnitude', 1000, [restoredTrace, predictedPostEq]);
    expect(cursor.isFrequencyDomain).toBe(true);
    expect(cursor.wavelengthMeters).toBeCloseTo(0.343, 3);
    expect(cursor.sourceValues.length).toBe(2);
  });

  it('applies microphone calibration curves accurately inside the measurement pipeline', () => {
    const sampleRate = 48000;
    const gen = new SignalGenerator(sampleRate, {
      enabled: true,
      type: 'pink',
      levelDbFs: -12,
    });
    const rig = new SyntheticAcousticRig(sampleRate, 'flat-delayed');
    const calCurve = parseCalibrationFile(
      [
        '# Sample Calibration File',
        '20 0.0 0.0',
        '1000 3.0 0.0',
        '20000 3.0 0.0',
      ].join('\n'),
      'TestMic.cal'
    );

    const pipeline = new MeasurementPipeline({
      sampleRate,
      fftSize: 4096,
      windowType: 'hann',
      averagingType: 'fifo',
      fifoDepth: 8,
      octaveSmoothing: '1/6',
      delayMs: 10.0,
      calibrationEnabled: true,
    });
    pipeline.setCalibrationCurve(calCurve);

    const refBlock = new Float32Array(4096);
    const measBlock = new Float32Array(4096);
    let data = pipeline.computeTransform();
    for (let i = 0; i < 10; i++) {
      gen.fillBuffer(refBlock);
      rig.processBlock(refBlock, measBlock);
      pipeline.writeSamples(measBlock, refBlock);
      data = pipeline.computeTransform();
    }

    // Since the flat system is 0 dB and calibration subtracts +3 dB above 1 kHz, calibrated magnitude at 2 kHz should be ~ -3 dB
    const bin2k = Math.round(2000 / (sampleRate / 4096));
    const calibratedDb = 20 * Math.log10(data.freqData.magnitude[bin2k]);
    expect(calibratedDb).toBeCloseTo(-3.0, 0);
  });
});
