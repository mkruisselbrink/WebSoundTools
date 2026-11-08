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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio-engine.js';
import { HardwareAudioRouter } from '../../src/audio/hardware-audio-router.js';
import { DEFAULT_GENERATOR_CONFIG } from '../../src/dsp/signal-generator.js';

describe('HardwareAudioRouter and AudioEngine', () => {
  let mockSplitterConnect: ReturnType<typeof vi.fn>;
  let mockWorkletConnect: ReturnType<typeof vi.fn>;
  let mockWorkletPostMessage: ReturnType<typeof vi.fn>;
  let mockWorkerPostMessage: ReturnType<typeof vi.fn>;
  let lastWorkerInstance: {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  } | null = null;

  beforeEach(() => {
    mockSplitterConnect = vi.fn();
    mockWorkletConnect = vi.fn();
    mockWorkletPostMessage = vi.fn();
    mockWorkerPostMessage = vi.fn();

    class MockWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      postMessage = mockWorkerPostMessage;
      terminate = vi.fn();
      constructor() {
        lastWorkerInstance = this;
      }
    }

    class MockAudioContext {
      sampleRate = 48000;
      state = 'running';
      destination = {
        maxChannelCount: 8,
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
      };
      audioWorklet = {
        addModule: vi.fn(async () => {}),
      };
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
      createMediaStreamSource = vi.fn(() => ({
        channelCount: 4,
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      createChannelSplitter = vi.fn(() => ({
        connect: mockSplitterConnect,
        disconnect: vi.fn(),
      }));
      createChannelMerger = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
    }

    class MockAudioWorkletNode {
      port = {
        postMessage: mockWorkletPostMessage,
        onmessage: null,
      };
      connect = mockWorkletConnect;
      disconnect = vi.fn();
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: MockWorker,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'AudioContext', {
      value: MockAudioContext,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      value: MockAudioWorkletNode,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          enumerateDevices: vi.fn(async () => [
            { kind: 'audioinput', deviceId: 'usb-1', label: 'USB Audio Interface' },
            { kind: 'videoinput', deviceId: 'cam-1', label: 'Webcam' },
          ]),
          getUserMedia: vi.fn(async () => ({
            getAudioTracks: () => [{ getSettings: () => ({ channelCount: 4 }) }],
            getTracks: () => [{ stop: vi.fn() }],
          })),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  it('HardwareAudioRouter enumerates audio inputs and routes M, Ref, and Generator output channels', async () => {
    const router = new HardwareAudioRouter();
    const devices = await router.listInputDevices();
    expect(devices).toEqual([{ deviceId: 'usb-1', label: 'USB Audio Interface' }]);

    const sr = await router.startStream({
      deviceId: 'usb-1',
      measurementChannel: 2,
      referenceChannel: -1, // Internal generator loopback
      generatorOutputChannel: 3, // Out Ch 4
      generatorConfig: DEFAULT_GENERATOR_CONFIG,
      isPaused: false,
      ringBufferStorage: null,
      onFallbackChunk: vi.fn(),
    });

    expect(sr).toBe(48000);
    expect(router.getAvailableChannels()).toBe(4);
    expect(router.getAvailableOutputChannels()).toBe(8);

    // Measurement channel 2 connected to worklet input 0
    expect(mockSplitterConnect).toHaveBeenCalledWith(expect.anything(), 2, 0);
    // Internal generator loopback enabled
    expect(mockWorkletPostMessage).toHaveBeenCalledWith({
      type: 'set-ref-loopback',
      useInternalGenAsRef: true,
    });
    // Worklet output 0 connected to output merger channel 3
    expect(mockWorkletConnect).toHaveBeenCalledWith(expect.anything(), 0, 3);

    // Muting output (-2) disconnects worklet from output merger
    mockWorkletConnect.mockClear();
    router.setGeneratorOutputChannel(-2);
    expect(mockWorkletConnect).not.toHaveBeenCalled();

    router.dispose();
  });

  it('AudioEngine coordinates worker messages, pause state, and hardware fallback on error', async () => {
    const engine = new AudioEngine();
    expect(engine.getInputMode()).toBe('simulator');

    // Switch to hardware mode
    await engine.setInputMode('hardware', 'usb-1', 0, 1);
    expect(engine.getInputMode()).toBe('hardware');

    // Pausing forwards to both worker and hardware worklet
    engine.setPaused(true);
    expect(engine.getPaused()).toBe(true);
    expect(mockWorkerPostMessage).toHaveBeenCalledWith({ type: 'pause', paused: true });
    expect(mockWorkletPostMessage).toHaveBeenCalledWith({ type: 'pause', paused: true });

    // Incoming worker config update notifies listeners
    const cfgSpy = vi.fn();
    engine.onMeasurementConfigChange(cfgSpy);
    lastWorkerInstance?.onmessage?.({
      data: {
        type: 'measurement-config-updated',
        config: { ...engine.getMeasurementConfig(), delayMs: 8.5 },
      },
    } as MessageEvent);
    expect(cfgSpy).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 8.5 }));

    // If getUserMedia fails, AudioEngine reverts to simulator mode
    (globalThis.navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Permission denied')
    );
    await expect(engine.setInputMode('hardware')).rejects.toThrow('Permission denied');
    expect(engine.getInputMode()).toBe('simulator');

    engine.dispose();
  });
});

