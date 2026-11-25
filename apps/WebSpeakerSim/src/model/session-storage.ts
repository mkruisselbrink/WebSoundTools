// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Tier-3 `IndexedDB` persistence (`web-speaker-sim-db` v2) backed by `@foh/state`
 * + portable `.wss-project.json` project bundle I/O (`src/model/session-storage.ts`).
 */

import { IdbRepository } from '@foh/state';
import {
  deserializeSpeakerFromJson,
  serializeSpeakerToJson,
} from '../library/importers/frd-importer.js';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import { DEFAULT_COLORMAP_CONFIG, type ColormapConfig } from './project-store.js';
import type { ProjectScene } from './project-types.js';

export const IDB_DATABASE_NAME = 'web-speaker-sim-db';
export const IDB_DATABASE_VERSION = 2;
export const IDB_STORE_PROJECTS = 'projects';
export const IDB_STORE_SPEAKERS = 'speakers';
export const IDB_STORE_FILE_HANDLES = 'file-handles';

const ACTIVE_FILE_HANDLE_RECORD_ID = 'active-project-handle';

export interface ProjectFileWritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectFileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<ProjectFileWritableLike>;
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<string>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<string>;
}

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

export class SessionStorageRepository {
  private readonly repo = new IdbRepository({
    dbName: IDB_DATABASE_NAME,
    dbVersion: IDB_DATABASE_VERSION,
    storeNames: [IDB_STORE_PROJECTS, IDB_STORE_SPEAKERS, IDB_STORE_FILE_HANDLES],
    fallbackMode: 'memory',
  });

  public async saveSpeaker(speaker: SpeakerDefinition): Promise<void> {
    const json = serializeSpeakerToJson(speaker);
    await this.repo.put(IDB_STORE_SPEAKERS, { id: speaker.id, json });
  }

  public async deleteSpeaker(speakerId: string): Promise<void> {
    await this.repo.delete(IDB_STORE_SPEAKERS, speakerId);
  }

  public async listSpeakers(): Promise<SpeakerDefinition[]> {
    const rows = await this.repo.getAll<{ id: string; json: string }>(IDB_STORE_SPEAKERS);
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
    await this.repo.put(IDB_STORE_PROJECTS, record);
  }

  public async deleteProject(projectId: string): Promise<void> {
    await this.repo.delete(IDB_STORE_PROJECTS, projectId);
  }

  public async listProjects(): Promise<SavedProjectRecord[]> {
    const rows = await this.repo.getAll<SavedProjectRecord>(IDB_STORE_PROJECTS);
    return rows.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
  }

  public async saveActiveFileHandle(handle: ProjectFileHandleLike): Promise<void> {
    await this.repo.put(IDB_STORE_FILE_HANDLES, {
      id: ACTIVE_FILE_HANDLE_RECORD_ID,
      handle,
    });
  }

  public async loadActiveFileHandle(): Promise<ProjectFileHandleLike | null> {
    const rows = await this.repo.getAll<{ id: string; handle?: ProjectFileHandleLike }>(
      IDB_STORE_FILE_HANDLES
    );
    const found = rows.find((r) => r.id === ACTIVE_FILE_HANDLE_RECORD_ID);
    return found?.handle && typeof found.handle.createWritable === 'function'
      ? found.handle
      : null;
  }

  public async clearActiveFileHandle(): Promise<void> {
    await this.repo.delete(IDB_STORE_FILE_HANDLES, ACTIVE_FILE_HANDLE_RECORD_ID);
  }
}
