// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Portable `.wss-project.json` import/export and IndexedDB scene snapshot helpers.
 */

import { downloadTextFile, slugifyFilename } from '@foh/ui';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { ProjectStore } from './project-store.js';
import type { ProjectScene } from './project-types.js';
import {
  deserializeProjectBundle,
  serializeProjectBundle,
  type SavedProjectRecord,
} from './session-storage.js';

export interface ProjectPersistenceRepositoryLike {
  saveSpeaker(speaker: SpeakerDefinition): Promise<void>;
  saveProject(record: SavedProjectRecord): Promise<void>;
  listProjects(): Promise<SavedProjectRecord[]>;
  deleteProject(projectId: string): Promise<void>;
}

export interface SerializedProjectDownload {
  readonly filename: string;
  readonly json: string;
}

/**
 * Serializes the active project scene, colormap, and custom speaker definitions
 * into a downloadable `.wss-project.json` payload.
 */
export function buildProjectBundleDownload(store: ProjectStore): SerializedProjectDownload {
  const json = serializeProjectBundle(
    store.scene,
    store.colormap,
    store.getCustomSpeakers()
  );
  const slug = slugifyFilename(store.scene.name, 'project');
  return {
    filename: `${slug}.wss-project.json`,
    json,
  };
}

/**
 * Triggers a browser download of the active project's `.wss-project.json` bundle.
 */
export function exportProjectBundleToFile(store: ProjectStore): SerializedProjectDownload {
  const payload = buildProjectBundleDownload(store);
  downloadTextFile(payload.filename, payload.json, 'application/json');
  return payload;
}

/**
 * Parses a `.wss-project.json` text payload, upserts embedded custom speakers into
 * both `ProjectStore` and IndexedDB, and replaces the active scene + colormap.
 */
export async function importProjectBundleText(
  jsonText: string,
  store: ProjectStore,
  repository: Pick<ProjectPersistenceRepositoryLike, 'saveSpeaker'>
): Promise<ProjectScene> {
  const bundle = deserializeProjectBundle(jsonText);
  for (const spk of bundle.customSpeakers) {
    store.upsertCustomSpeaker(spk);
    await repository.saveSpeaker(spk);
  }
  store.setColormap(bundle.colormap);
  store.replaceProject(bundle.scene, true);
  return bundle.scene;
}

/**
 * Reads a user-selected `.json` `File` and imports it into `store` and `repository`.
 */
export async function importProjectBundleFile(
  file: File,
  store: ProjectStore,
  repository: Pick<ProjectPersistenceRepositoryLike, 'saveSpeaker'>
): Promise<ProjectScene> {
  const text = await file.text();
  return importProjectBundleText(text, store, repository);
}

/**
 * Saves the current `store.scene` and `store.colormap` into IndexedDB (`projects` store)
 * and returns both the saved record and the refreshed project list.
 */
export async function saveSceneSnapshotToDb(
  store: ProjectStore,
  repository: Pick<ProjectPersistenceRepositoryLike, 'saveProject' | 'listProjects'>,
  now: Date = new Date()
): Promise<{ readonly record: SavedProjectRecord; readonly projects: SavedProjectRecord[] }> {
  const scene = store.scene;
  const projectId = scene.id.startsWith('proj-')
    ? scene.id
    : `proj-${now.getTime().toString(36)}`;
  const record: SavedProjectRecord = {
    id: projectId,
    name: scene.name,
    updatedAtIso: now.toISOString(),
    scene: {
      ...scene,
      id: projectId,
    },
    colormap: store.colormap,
  };
  await repository.saveProject(record);
  const projects = await repository.listProjects();
  return { record, projects };
}
