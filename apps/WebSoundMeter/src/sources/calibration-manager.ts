// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Microphone calibration library manager coordinating IndexedDB storage (`calibration-curves`)
 * and per-slot calibration application on `AudioEngine`.
 */

import { parseCalibrationFile } from '@foh/acoustics';
import type { AudioEngine } from '../audio/audio-engine.js';
import {
  StoredCalibrationFile,
  deleteCalibrationFileFromDb,
  loadAllCalibrationFilesFromDb,
  saveCalibrationFileToDb,
} from './session-storage.js';

export class CalibrationManager {
  private calibrations: StoredCalibrationFile[] = [];

  getAll(): readonly StoredCalibrationFile[] {
    return this.calibrations;
  }

  async hydrateAndSyncEngine(engine: AudioEngine | null): Promise<StoredCalibrationFile[]> {
    const loaded = await loadAllCalibrationFilesFromDb();
    this.calibrations = loaded;

    if (engine) {
      for (const slot of engine.getLiveSlots()) {
        if (slot.activeCalibrationId) {
          const match = loaded.find((c) => c.id === slot.activeCalibrationId);
          if (match) {
            engine.loadCalibrationFile(match.text, match.name, slot.id);
          } else {
            engine.updateLiveSlot(slot.id, { activeCalibrationId: null });
          }
        }
      }
    }

    return loaded;
  }

  async uploadFileForSlot(
    slotId: string,
    file: File,
    engine: AudioEngine | null
  ): Promise<StoredCalibrationFile> {
    const text = await file.text();
    const parsed = parseCalibrationFile(text, file.name);
    const id = `cal-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const record: StoredCalibrationFile = {
      id,
      name: file.name,
      text,
      pointCount: parsed.points.length,
      createdAt: new Date().toISOString(),
    };
    this.calibrations = [
      ...this.calibrations.filter((c) => c.id !== id),
      record,
    ];
    void saveCalibrationFileToDb(record);
    engine?.updateLiveSlot(slotId, { activeCalibrationId: id });
    engine?.loadCalibrationFile(text, file.name, slotId);
    return record;
  }

  selectForSlot(
    slotId: string,
    calibrationId: string | null,
    engine: AudioEngine | null
  ): void {
    engine?.updateLiveSlot(slotId, { activeCalibrationId: calibrationId });
    if (!calibrationId) {
      engine?.clearCalibration(slotId);
    } else {
      const found = this.calibrations.find((c) => c.id === calibrationId);
      if (found) {
        engine?.loadCalibrationFile(found.text, found.name, slotId);
      }
    }
  }

  deleteCalibration(calibrationId: string, engine: AudioEngine | null): void {
    this.calibrations = this.calibrations.filter((c) => c.id !== calibrationId);
    void deleteCalibrationFileFromDb(calibrationId);
    if (engine) {
      for (const slot of engine.getLiveSlots()) {
        if (slot.activeCalibrationId === calibrationId) {
          engine.updateLiveSlot(slot.id, { activeCalibrationId: null });
          engine.clearCalibration(slot.id);
        }
      }
    }
  }
}
