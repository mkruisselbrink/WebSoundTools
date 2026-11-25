// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildSpeakerFromSpec } from '../library/spec-builder.js';
import {
  buildProjectBundleDownload,
  importProjectBundleText,
  saveSceneSnapshotToDb,
  type ProjectPersistenceRepositoryLike,
} from './project-io.js';
import { ProjectStore } from './project-store.js';
import type { SavedProjectRecord } from './session-storage.js';

function createMemoryRepo(): ProjectPersistenceRepositoryLike & {
  readonly speakers: Map<string, unknown>;
  readonly projects: Map<string, SavedProjectRecord>;
} {
  const speakers = new Map<string, unknown>();
  const projects = new Map<string, SavedProjectRecord>();
  return {
    speakers,
    projects,
    async saveSpeaker(spk) {
      speakers.set(spk.id, spk);
    },
    async saveProject(rec) {
      projects.set(rec.id, rec);
    },
    async listProjects() {
      return Array.from(projects.values());
    },
    async deleteProject(id) {
      projects.delete(id);
    },
  };
}

describe('project-io helpers', () => {
  it('serializes and re-imports project bundles including custom speakers and colormap', async () => {
    const srcStore = new ProjectStore();
    srcStore.updateScene((s) => ({ ...s, name: 'Arena Main Hang #2' }));
    srcStore.setColormap({ palette: 'viridis', rangeMode: 'auto-12' });

    const customSpk = buildSpeakerFromSpec({
      name: 'Custom 15" Wedge',
      manufacturer: 'Test Labs',
      category: 'point-source',
      horizontalDispersionDeg: 80,
      verticalDispersionDeg: 50,
      low3dBHz: 52,
      high3dBHz: 18500,
      maxContinuousSpl1mDb: 133,
      lfPattern: 'omni',
    });
    srcStore.upsertCustomSpeaker(customSpk);

    const download = buildProjectBundleDownload(srcStore);
    expect(download.filename).toBe('arena-main-hang-2.wss-project.json');

    const dstStore = new ProjectStore();
    const repo = createMemoryRepo();
    const importedScene = await importProjectBundleText(download.json, dstStore, repo);

    expect(importedScene.name).toBe('Arena Main Hang #2');
    expect(dstStore.scene.name).toBe('Arena Main Hang #2');
    expect(dstStore.colormap.palette).toBe('viridis');
    expect(dstStore.colormap.rangeMode).toBe('auto-12');
    expect(dstStore.getSpeakerById(customSpk.id)?.name).toBe('Custom 15" Wedge');
    expect(repo.speakers.has(customSpk.id)).toBe(true);
  });

  it('saves scene snapshots to the repository with normalized proj-* identifiers', async () => {
    const store = new ProjectStore();
    store.updateScene((s) => ({ ...s, name: 'Festival Delay Tower' }));
    const repo = createMemoryRepo();

    const fixedNow = new Date('2026-06-15T18:30:00.000Z');
    const { record, projects } = await saveSceneSnapshotToDb(store, repo, fixedNow);

    expect(record.id.startsWith('proj-')).toBe(true);
    expect(record.name).toBe('Festival Delay Tower');
    expect(record.updatedAtIso).toBe('2026-06-15T18:30:00.000Z');
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('Festival Delay Tower');
  });
});
