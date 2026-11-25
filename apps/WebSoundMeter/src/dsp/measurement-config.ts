// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import type { OctaveSmoothingType, WindowFunctionType } from '@foh/dsp';
import type {
  FeedbackReferenceMode,
  FeedbackSensitivityMode,
} from './feedback-detector.js';
import type { AveragingType, TransferEstimatorType } from './transfer-function.js';

export type InputPreFilterType = 'Z' | 'A' | 'C' | 'notch-1k';

export interface MeasurementPipelineConfig {
  id: string;
  name: string;
  color: string;
  sampleRate: number;
  fftSize: number;
  windowType: WindowFunctionType;
  averagingType: AveragingType;
  fifoDepth: number;
  lpfCutoffHz: number;
  coherenceDepth: number;
  estimator: TransferEstimatorType;
  octaveSmoothing: OctaveSmoothingType;
  /** Delay applied to Reference channel in milliseconds to align with Measurement */
  delayMs: number;
  /** Input gain applied to Measurement channel in dB */
  gainDb: number;
  invertPolarity: boolean;
  inputFilter: InputPreFilterType;
  splOffsetDb: number;
  calibrationEnabled: boolean;
  /** Per-slot acoustic feedback detector sensitivity profile */
  feedbackMode?: FeedbackSensitivityMode;
  /** How Reference (R) interacts with single-slot Feedback Watch (default: 'closed-loop-mix') */
  feedbackRefMode?: FeedbackReferenceMode;
}

export const DEFAULT_MEASUREMENT_CONFIG: MeasurementPipelineConfig = {
  id: 'live-measurement',
  name: 'Live Measurement',
  color: '#38bdf8',
  sampleRate: 48000,
  fftSize: 4096,
  windowType: 'hann',
  averagingType: 'fifo',
  fifoDepth: 16,
  lpfCutoffHz: 1.0,
  coherenceDepth: 16,
  estimator: 'h1',
  octaveSmoothing: 'off',
  delayMs: 0.0,
  gainDb: 0.0,
  invertPolarity: false,
  inputFilter: 'Z',
  splOffsetDb: 100.0,
  calibrationEnabled: false,
  feedbackMode: 'foh-normal',
  feedbackRefMode: 'closed-loop-mix',
};

/** Sentinel value on `LiveMeasurementSlotConfig.referenceChannel` meaning "follow the Topbar Global Reference Channel". */
export const REFERENCE_CHANNEL_GLOBAL = -2;

export function resolveEffectiveReferenceChannel(
  slotRefChannel: number,
  globalRefChannel: number
): number {
  return slotRefChannel === REFERENCE_CHANNEL_GLOBAL
    ? globalRefChannel
    : slotRefChannel;
}

export const SHARED_MEASUREMENT_CONFIG_KEYS = [
  'sampleRate',
  'fftSize',
  'windowType',
  'averagingType',
  'fifoDepth',
  'lpfCutoffHz',
  'coherenceDepth',
  'estimator',
  'octaveSmoothing',
] as const;

export function splitMeasurementConfigPartial(
  partial: Partial<MeasurementPipelineConfig>
): {
  sharedPartial: Partial<MeasurementPipelineConfig>;
  perSlotPartial: Partial<MeasurementPipelineConfig>;
} {
  const sharedPartial: Partial<MeasurementPipelineConfig> = {};
  const perSlotPartial: Partial<MeasurementPipelineConfig> = {};
  const sharedSet = new Set<string>(SHARED_MEASUREMENT_CONFIG_KEYS);
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if (sharedSet.has(k)) {
      (sharedPartial as Record<string, unknown>)[k] = v;
    } else {
      (perSlotPartial as Record<string, unknown>)[k] = v;
    }
  }
  return { sharedPartial, perSlotPartial };
}
