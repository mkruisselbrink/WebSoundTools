// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Local Browser Session & Acoustic Library Persistence (`IndexedDB` v3) backed by `@foh/state`.
 */

import { IdbRepository } from '@foh/state';
import { SplHistoryCheckpoint } from '../dsp/spl-history.js';
import { EqualizerSourceConfig } from './eq-source.js';
import {
  SerializedSourceData,
  SourceData,
  deserializeSourceData,
  serializeSourceData,
} from './source-data.js';
import { UnionSourceConfig } from './union-source.js';

export interface StoredCalibrationFile {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly pointCount: number;
  readonly createdAt: string;
}

export const DB_NAME = 'web-sound-meter-db';
export const DB_VERSION = 3;
export const STORE_TRACES = 'stored-traces';
export const STORE_EQ_SOURCES = 'eq-sources';
export const STORE_UNION_SOURCES = 'union-sources';
export const STORE_CALIBRATIONS = 'calibration-curves';
export const STORE_SPL_SHOW_LOGS = 'spl-show-logs';

export const ALL_STORES = [
  STORE_TRACES,
  STORE_EQ_SOURCES,
  STORE_UNION_SOURCES,
  STORE_CALIBRATIONS,
  STORE_SPL_SHOW_LOGS,
] as const;

const wsmIdbRepo = new IdbRepository({
  dbName: DB_NAME,
  dbVersion: DB_VERSION,
  storeNames: ALL_STORES,
  fallbackMode: 'noop',
});

export async function saveStoredTraceToDb(source: SourceData): Promise<void> {
  await wsmIdbRepo.put(STORE_TRACES, serializeSourceData(source));
}

export async function deleteStoredTraceFromDb(id: string): Promise<void> {
  await wsmIdbRepo.delete(STORE_TRACES, id);
}

export async function loadAllStoredTracesFromDb(): Promise<SourceData[]> {
  const records = await wsmIdbRepo.getAll<SerializedSourceData>(STORE_TRACES);
  return records.map(deserializeSourceData);
}

export async function saveEqSourceToDb(eq: EqualizerSourceConfig): Promise<void> {
  await wsmIdbRepo.put(STORE_EQ_SOURCES, eq);
}

export async function deleteEqSourceFromDb(id: string): Promise<void> {
  await wsmIdbRepo.delete(STORE_EQ_SOURCES, id);
}

export async function loadAllEqSourcesFromDb(): Promise<EqualizerSourceConfig[]> {
  return wsmIdbRepo.getAll<EqualizerSourceConfig>(STORE_EQ_SOURCES);
}

export async function saveUnionSourceToDb(union: UnionSourceConfig): Promise<void> {
  await wsmIdbRepo.put(STORE_UNION_SOURCES, union);
}

export async function deleteUnionSourceFromDb(id: string): Promise<void> {
  await wsmIdbRepo.delete(STORE_UNION_SOURCES, id);
}

export async function loadAllUnionSourcesFromDb(): Promise<UnionSourceConfig[]> {
  return wsmIdbRepo.getAll<UnionSourceConfig>(STORE_UNION_SOURCES);
}

export async function saveCalibrationFileToDb(
  calibration: StoredCalibrationFile
): Promise<void> {
  await wsmIdbRepo.put(STORE_CALIBRATIONS, calibration);
}

export async function deleteCalibrationFileFromDb(id: string): Promise<void> {
  await wsmIdbRepo.delete(STORE_CALIBRATIONS, id);
}

export async function loadAllCalibrationFilesFromDb(): Promise<StoredCalibrationFile[]> {
  return wsmIdbRepo.getAll<StoredCalibrationFile>(STORE_CALIBRATIONS);
}

export async function saveSplShowCheckpointsToDb(
  checkpoints: readonly SplHistoryCheckpoint[]
): Promise<void> {
  await wsmIdbRepo.putMany(STORE_SPL_SHOW_LOGS, checkpoints);
}

export async function loadAllSplShowCheckpointsFromDb(): Promise<SplHistoryCheckpoint[]> {
  return wsmIdbRepo.getAll<SplHistoryCheckpoint>(STORE_SPL_SHOW_LOGS);
}

export async function clearSplShowCheckpointsFromDb(): Promise<void> {
  await wsmIdbRepo.clear(STORE_SPL_SHOW_LOGS);
}
