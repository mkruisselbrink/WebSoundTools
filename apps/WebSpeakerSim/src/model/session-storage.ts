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
 * Tier-3 `IndexedDB` persistence (`web-speaker-sim-db` v1) for saved projects and
 * custom/imported loudspeakers + portable `.wss-project.json` project bundle I/O
 * (`src/model/session-storage.ts`).
 */

import {
  deserializeSpeakerFromJson,
  serializeSpeakerToJson,
} from '../library/importers/frd-importer.js';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import { DEFAULT_COLORMAP_CONFIG, type ColormapConfig } from './project-store.js';
import type { ProjectScene } from './project-types.js';

export const IDB_DATABASE_NAME = 'web-speaker-sim-db';
export const IDB_DATABASE_VERSION = 1;
export const IDB_STORE_PROJECTS = 'projects';
export const IDB_STORE_SPEAKERS = 'speakers';

export interface SavedProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly updatedAtIso: string;
  readonly scene: ProjectScene;
  readonly colormap: ColormapConfig;
}

export interface ProjectFileBundle {
  readonly format: 'wss-project-v1';
  readonly exportedAtIso: string;
  readonly scene: ProjectScene;
  readonly colormap: ColormapConfig;
  readonly customSpeakers: readonly SpeakerDefinition[];
}

export function serializeProjectBundle(
  scene: ProjectScene,
  colormap: ColormapConfig,
  customSpeakers: readonly SpeakerDefinition[]
): string {
  const speakerJsonObjects = customSpeakers.map((s) => JSON.parse(serializeSpeakerToJson(s)));
  return JSON.stringify(
    {
      format: 'wss-project-v1',
      exportedAtIso: new Date().toISOString(),
      scene,
      colormap,
      customSpeakers: speakerJsonObjects,
    },
    null,
    2
  );
}

export function deserializeProjectBundle(jsonText: string): ProjectFileBundle {
  const raw = JSON.parse(jsonText) as Record<string, unknown>;
  if (!raw || raw.format !== 'wss-project-v1' || !raw.scene) {
    throw new Error('Invalid .wss-project.json project bundle.');
  }
  const scene = raw.scene as ProjectScene;
  if (typeof scene.id !== 'string' || !Array.isArray(scene.surfaces)) {
    throw new Error('Malformed scene inside .wss-project.json bundle.');
  }
  const colormap: ColormapConfig = raw.colormap
    ? { ...DEFAULT_COLORMAP_CONFIG, ...(raw.colormap as Partial<ColormapConfig>) }
    : DEFAULT_COLORMAP_CONFIG;

  const rawSpeakers = Array.isArray(raw.customSpeakers) ? raw.customSpeakers : [];
  const customSpeakers: SpeakerDefinition[] = rawSpeakers.map((item) =>
    deserializeSpeakerFromJson(JSON.stringify(item), true)
  );

  return {
    format: 'wss-project-v1',
    exportedAtIso: typeof raw.exportedAtIso === 'string' ? raw.exportedAtIso : '',
    scene,
    colormap,
    customSpeakers,
  };
}

/**
 * Persistent library & project repository backed by browser `IndexedDB`, with an automatic
 * in-memory Map fallback for headless Node test environments or private-browsing restrictions.
 */
export class SessionStorageRepository {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private readonly memProjects = new Map<string, SavedProjectRecord>();
  private readonly memSpeakers = new Map<string, string>(); // id -> serialized JSON

  private openDatabase(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE_PROJECTS)) {
            db.createObjectStore(IDB_STORE_PROJECTS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(IDB_STORE_SPEAKERS)) {
            db.createObjectStore(IDB_STORE_SPEAKERS, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  public async saveSpeaker(speaker: SpeakerDefinition): Promise<void> {
    const json = serializeSpeakerToJson(speaker);
    const db = await this.openDatabase();
    if (!db) {
      this.memSpeakers.set(speaker.id, json);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_SPEAKERS, 'readwrite');
      tx.objectStore(IDB_STORE_SPEAKERS).put({ id: speaker.id, json });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async deleteSpeaker(speakerId: string): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      this.memSpeakers.delete(speakerId);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_SPEAKERS, 'readwrite');
      tx.objectStore(IDB_STORE_SPEAKERS).delete(speakerId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async listSpeakers(): Promise<SpeakerDefinition[]> {
    const db = await this.openDatabase();
    if (!db) {
      return Array.from(this.memSpeakers.values()).map((j) => deserializeSpeakerFromJson(j, true));
    }

    const rows = await new Promise<Array<{ id: string; json: string }>>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_SPEAKERS, 'readonly');
      const req = tx.objectStore(IDB_STORE_SPEAKERS).getAll();
      req.onsuccess = () => resolve((req.result as Array<{ id: string; json: string }>) ?? []);
      req.onerror = () => reject(req.error);
    });

    const out: SpeakerDefinition[] = [];
    for (const row of rows) {
      try {
        out.push(deserializeSpeakerFromJson(row.json, true));
      } catch {
        // Ignore corrupted entries
      }
    }
    return out;
  }

  public async saveProject(record: SavedProjectRecord): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      this.memProjects.set(record.id, record);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_PROJECTS, 'readwrite');
      tx.objectStore(IDB_STORE_PROJECTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async deleteProject(projectId: string): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      this.memProjects.delete(projectId);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_PROJECTS, 'readwrite');
      tx.objectStore(IDB_STORE_PROJECTS).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async listProjects(): Promise<SavedProjectRecord[]> {
    const db = await this.openDatabase();
    if (!db) {
      return Array.from(this.memProjects.values()).sort((a, b) =>
        b.updatedAtIso.localeCompare(a.updatedAtIso)
      );
    }

    const rows = await new Promise<SavedProjectRecord[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(IDB_STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve((req.result as SavedProjectRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });

    return rows.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
  }
}

