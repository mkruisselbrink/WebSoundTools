// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Portable `.wss-project.json` bundle I/O, File System Access API (`showOpenFilePicker` /
 * `showSaveFilePicker` + direct `Cmd/Ctrl + S` save-in-place), and IndexedDB scene snapshots.
 */

import { downloadTextFile, slugifyFilename } from '@foh/ui';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import type { ProjectStore } from './project-store.js';
import type { ProjectScene } from './project-types.js';
import {
  deserializeProjectBundle,
  serializeProjectBundle,
  type ProjectFileHandleLike,
  type SavedProjectRecord,
} from './session-storage.js';

export type { ProjectFileHandleLike };

export interface ProjectPersistenceRepositoryLike {
  saveSpeaker(speaker: SpeakerDefinition): Promise<void>;
  saveProject(record: SavedProjectRecord): Promise<void>;
  listProjects(): Promise<SavedProjectRecord[]>;
  deleteProject(projectId: string): Promise<void>;
  saveActiveFileHandle?(handle: ProjectFileHandleLike): Promise<void>;
  clearActiveFileHandle?(): Promise<void>;
}

export interface FilePickerWindowLike {
  showOpenFilePicker?: (options?: unknown) => Promise<ProjectFileHandleLike[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<ProjectFileHandleLike>;
}

export interface SerializedProjectDownload {
  readonly filename: string;
  readonly json: string;
}

const WSS_PROJECT_PICKER_TYPES = [
  {
    description: 'WebSpeakerSim Project Bundle (.wss-project.json, .json)',
    accept: {
      'application/json': ['.wss-project.json', '.json'],
    },
  },
];

export function supportsOpenFilePicker(win?: FilePickerWindowLike | null): boolean {
  const target = win ?? (typeof window !== 'undefined' ? (window as FilePickerWindowLike) : null);
  return Boolean(target && typeof target.showOpenFilePicker === 'function');
}

export function supportsSaveFilePicker(win?: FilePickerWindowLike | null): boolean {
  const target = win ?? (typeof window !== 'undefined' ? (window as FilePickerWindowLike) : null);
  return Boolean(target && typeof target.showSaveFilePicker === 'function');
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
  );
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
  repository: Pick<ProjectPersistenceRepositoryLike, 'saveSpeaker' | 'clearActiveFileHandle'>
): Promise<ProjectScene> {
  const text = await file.text();
  const scene = await importProjectBundleText(text, store, repository);
  await repository.clearActiveFileHandle?.().catch(() => {});
  return scene;
}

export type OpenProjectPickerOutcome =
  | { readonly kind: 'opened'; readonly scene: ProjectScene; readonly handle: ProjectFileHandleLike }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported' };

/**
 * Opens a `.wss-project.json` file via the File System Access API (`showOpenFilePicker`),
 * persisting the `FileSystemFileHandle` for subsequent `Cmd/Ctrl + S` direct saves.
 * Returns `{ kind: 'unsupported' }` when the browser lacks `showOpenFilePicker`.
 */
export async function openProjectViaFilePicker(
  store: ProjectStore,
  repository: Pick<ProjectPersistenceRepositoryLike, 'saveSpeaker' | 'saveActiveFileHandle'>,
  win?: FilePickerWindowLike
): Promise<OpenProjectPickerOutcome> {
  const target = win ?? (typeof window !== 'undefined' ? (window as FilePickerWindowLike) : undefined);
  if (!target || typeof target.showOpenFilePicker !== 'function') {
    return { kind: 'unsupported' };
  }
  try {
    const [handle] = await target.showOpenFilePicker({
      multiple: false,
      types: WSS_PROJECT_PICKER_TYPES,
    });
    if (!handle) return { kind: 'cancelled' };
    const file = await handle.getFile();
    const scene = await importProjectBundleText(await file.text(), store, repository);
    await repository.saveActiveFileHandle?.(handle).catch(() => {});
    return { kind: 'opened', scene, handle };
  } catch (err) {
    if (isAbortError(err)) {
      return { kind: 'cancelled' };
    }
    throw err;
  }
}

export type DirectSaveOutcome =
  | { readonly ok: true; readonly fileName: string }
  | { readonly ok: false; readonly reason: 'permission-denied' | 'error'; readonly message: string };

/**
 * Writes the current project bundle directly into an existing `FileSystemFileHandle`.
 */
export async function saveProjectToHandle(
  handle: ProjectFileHandleLike,
  store: ProjectStore
): Promise<DirectSaveOutcome> {
  try {
    if (typeof handle.queryPermission === 'function') {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
        perm = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') {
        return {
          ok: false,
          reason: 'permission-denied',
          message: `Write permission was not granted for "${handle.name}".`,
        };
      }
    }
    const { json } = buildProjectBundleDownload(store);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return { ok: true, fileName: handle.name };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SaveProjectAsOutcome =
  | { readonly kind: 'saved-handle'; readonly handle: ProjectFileHandleLike; readonly fileName: string }
  | { readonly kind: 'downloaded'; readonly fileName: string }
  | { readonly kind: 'cancelled' };

/**
 * Prompts via `showSaveFilePicker` when supported (upgrading the session to direct-save
 * `Cmd/Ctrl + S` mode), or triggers a standard `.wss-project.json` download fallback.
 */
export async function saveProjectAsViaPicker(
  store: ProjectStore,
  repository: Pick<ProjectPersistenceRepositoryLike, 'saveActiveFileHandle'>,
  win?: FilePickerWindowLike
): Promise<SaveProjectAsOutcome> {
  const target = win ?? (typeof window !== 'undefined' ? (window as FilePickerWindowLike) : undefined);
  const payload = buildProjectBundleDownload(store);

  if (target && typeof target.showSaveFilePicker === 'function') {
    try {
      const handle = await target.showSaveFilePicker({
        suggestedName: payload.filename,
        types: WSS_PROJECT_PICKER_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(payload.json);
      await writable.close();
      await repository.saveActiveFileHandle?.(handle).catch(() => {});
      return { kind: 'saved-handle', handle, fileName: handle.name };
    } catch (err) {
      if (isAbortError(err)) {
        return { kind: 'cancelled' };
      }
      throw err;
    }
  }

  downloadTextFile(payload.filename, payload.json, 'application/json');
  return { kind: 'downloaded', fileName: payload.filename };
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
