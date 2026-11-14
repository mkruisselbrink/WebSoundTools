// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Multi-slot Live Measurement configuration state and skeleton frame builder for `AudioEngine`.
 */

import {
  DEFAULT_MEASUREMENT_CONFIG,
  MeasurementPipelineConfig,
  REFERENCE_CHANNEL_GLOBAL,
  resolveEffectiveReferenceChannel,
  splitMeasurementConfigPartial,
} from '../dsp/analyzer-pipeline.js';
import type { LiveMeasurementSlotConfig } from '../dsp/dsp-worker-protocol.js';
import type { SimulatorPresetId } from '../dsp/synthetic-rig.js';
import {
  DEFAULT_SOURCE_PALETTE,
  SourceData,
  createEmptyFrequencyDomainData,
  createEmptyTimeDomainData,
} from '../sources/source-data.js';

const SIMULATOR_PRESET_CYCLE: readonly SimulatorPresetId[] = [
  'pa-room-modes',
  'sub-top-misaligned',
  'comb-filtering',
  'flat-delayed',
  'noisy-crowd',
];

export function createDefaultLiveSlot(
  id: string = 'live-measurement',
  index: number = 0
): LiveMeasurementSlotConfig {
  const paletteIdx = index % DEFAULT_SOURCE_PALETTE.length;
  const preset = SIMULATOR_PRESET_CYCLE[index % SIMULATOR_PRESET_CYCLE.length];
  return {
    id,
    name: index === 0 ? 'Live Measurement' : `Live Measurement #${index + 1}`,
    color: DEFAULT_SOURCE_PALETTE[paletteIdx],
    visible: true,
    simulatorPreset: preset,
    measurementChannel: index === 0 ? 0 : index * 2,
    referenceChannel: REFERENCE_CHANNEL_GLOBAL,
    config: { ...DEFAULT_MEASUREMENT_CONFIG },
    activeCalibrationId: null,
  };
}

export function createSkeletonLiveFrame(slot: LiveMeasurementSlotConfig): SourceData {
  const N = slot.config.fftSize || 4096;
  const binCount = (N >>> 1) + 1;
  const sr = slot.config.sampleRate || 48000;
  return {
    id: slot.id,
    name: slot.name,
    kind: 'measurement',
    color: slot.color,
    visible: slot.visible,
    active: true,
    sampleRate: sr,
    gainOffsetDb: 0,
    delayOffsetMs: 0,
    invertPolarity: slot.config.invertPolarity,
    createdAt: new Date().toISOString(),
    notes: '',
    freqData: createEmptyFrequencyDomainData(binCount, sr),
    timeData: createEmptyTimeDomainData(N, sr),
  };
}

export class LiveSlotManager {
  private liveSlots: LiveMeasurementSlotConfig[] = [createDefaultLiveSlot()];
  private globalReferenceChannel = 1;
  private readonly calibrationNames = new Map<string, string>();

  getGlobalReferenceChannel(): number {
    return this.globalReferenceChannel;
  }

  setGlobalReferenceChannel(refChannel: number): void {
    this.globalReferenceChannel = refChannel;
  }

  getSlots(): readonly LiveMeasurementSlotConfig[] {
    return this.liveSlots;
  }

  getSlot(slotId: string = 'live-measurement'): LiveMeasurementSlotConfig {
    return (
      this.liveSlots.find((s) => s.id === slotId) ??
      this.liveSlots[0] ??
      createDefaultLiveSlot()
    );
  }

  setSlots(slots: readonly LiveMeasurementSlotConfig[]): void {
    this.liveSlots = slots.length > 0 ? [...slots] : [createDefaultLiveSlot()];
  }

  addSlot(partial?: Partial<LiveMeasurementSlotConfig>): LiveMeasurementSlotConfig {
    const idx = this.liveSlots.length;
    const uid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 6)
        : `${Date.now().toString(36)}-${idx}`;
    const base = createDefaultLiveSlot(`live-${uid}`, idx);
    const primaryCfg = this.liveSlots[0]?.config ?? DEFAULT_MEASUREMENT_CONFIG;
    const { sharedPartial } = splitMeasurementConfigPartial(primaryCfg);
    const created: LiveMeasurementSlotConfig = {
      ...base,
      ...partial,
      config: {
        ...base.config,
        ...sharedPartial,
        ...(partial?.config ?? {}),
      },
    };
    this.liveSlots = [...this.liveSlots, created];
    return created;
  }

  removeSlot(slotId: string): boolean {
    if (this.liveSlots.length <= 1) return false;
    this.liveSlots = this.liveSlots.filter((s) => s.id !== slotId);
    this.calibrationNames.delete(slotId);
    return true;
  }

  updateSlot(slotId: string, partial: Partial<LiveMeasurementSlotConfig>): void {
    this.liveSlots = this.liveSlots.map((slot) => {
      if (slot.id !== slotId) return slot;
      return {
        ...slot,
        ...partial,
        config: partial.config ? { ...slot.config, ...partial.config } : slot.config,
      };
    });
  }

  applyMeasurementConfigPartial(
    partial: Partial<MeasurementPipelineConfig>,
    targetSlotId: string
  ): void {
    const { sharedPartial, perSlotPartial } = splitMeasurementConfigPartial(partial);
    const hasShared = Object.keys(sharedPartial).length > 0;
    this.liveSlots = this.liveSlots.map((s) => {
      let nextCfg = s.config;
      if (hasShared) {
        nextCfg = { ...nextCfg, ...sharedPartial };
      }
      if (s.id === targetSlotId && Object.keys(perSlotPartial).length > 0) {
        nextCfg = { ...nextCfg, ...perSlotPartial };
      }
      return nextCfg !== s.config ? { ...s, config: nextCfg } : s;
    });
  }

  replaceSlotConfig(slotId: string, config: MeasurementPipelineConfig): void {
    this.liveSlots = this.liveSlots.map((s) => (s.id === slotId ? { ...s, config } : s));
  }

  setCalibrationLabel(slotId: string, label: string): void {
    this.calibrationNames.set(slotId, label);
  }

  clearCalibrationLabel(slotId: string): void {
    this.calibrationNames.delete(slotId);
  }

  getCalibrationLabel(slotId: string): string | null {
    return this.calibrationNames.get(slotId) ?? null;
  }

  collectActivePhysicalChannels(): number[] {
    const chs: number[] = [];
    for (const slot of this.liveSlots) {
      if (slot.measurementChannel >= 0) {
        chs.push(slot.measurementChannel);
      }
      const effectiveRef = resolveEffectiveReferenceChannel(
        slot.referenceChannel,
        this.globalReferenceChannel
      );
      if (effectiveRef >= 0) {
        chs.push(effectiveRef);
      }
    }
    return chs;
  }
}
