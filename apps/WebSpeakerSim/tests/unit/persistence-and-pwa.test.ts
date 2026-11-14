/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { getDemoPresetById } from '../../src/library/demo-presets.js';
import { buildSpeakerFromSpec } from '../../src/library/spec-builder.js';
import { DEFAULT_COLORMAP_CONFIG } from '../../src/model/project-store.js';
import {
  IDB_DATABASE_NAME,
  IDB_DATABASE_VERSION,
  IDB_STORE_PROJECTS,
  IDB_STORE_SPEAKERS,
  SessionStorageRepository,
  deserializeProjectBundle,
  serializeProjectBundle,
} from '../../src/model/session-storage.js';
import { parseUrlState, serializeUrlState } from '../../src/model/url-state.js';
import {
  WORKSPACE_STORAGE_KEY,
  clearWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
  type StorageLike,
} from '../../src/model/workspace-session.js';
import {
  buildCacheName,
  selectObsoleteCaches,
  shouldInterceptSameOriginGet,
  withCrossOriginIsolationHeaders,
} from '@foh/pwa/sw';

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('3-Tier Persistence & Offline PWA Core', () => {
  it('parses and serializes Tier-1 URL query parameters cleanly', () => {
    const query = serializeUrlState({
      presetId: 'festival-endfire-delays',
      bandSelection: {
        kind: 'band-average',
        label: 'Broadband (Music dBC)',
        minHz: 31.5,
        maxHz: 16000,
        weighting: 'C',
        spectrumShape: 'music',
      },
      layoutMode: 'plan',
    });

    expect(query).toContain('preset=festival-endfire-delays');
    expect(query).toContain('weighting=C');
    expect(query).toContain('shape=music');
    expect(query).toContain('layout=plan');

    const parsed = parseUrlState(query);
    expect(parsed.presetId).toBe('festival-endfire-delays');
    expect(parsed.layoutMode).toBe('plan');
    expect(parsed.bandSelection?.kind).toBe('band-average');
    if (parsed.bandSelection?.kind === 'band-average') {
      expect(parsed.bandSelection.weighting).toBe('C');
      expect(parsed.bandSelection.spectrumShape).toBe('music');
    }

    const singleParsed = parseUrlState('?band=63');
    expect(singleParsed.bandSelection).toEqual({ kind: 'single', frequencyHz: 63 });
  });

  it('saves, hydrates, and clears Tier-2 localStorage workspace snapshots', () => {
    const mem = new MemoryStorage();
    const scene = getDemoPresetById('club-cardioid-pa').createScene();

    expect(
      saveWorkspaceSession(
        {
          activePresetId: 'club-cardioid-pa',
          scene,
          colormap: { ...DEFAULT_COLORMAP_CONFIG, minSplDb: 78, maxSplDb: 108 },
          layoutMode: 'section',
          chartDrawerExpanded: true,
        },
        mem
      )
    ).toBe(true);

    const loaded = loadWorkspaceSession(mem);
    expect(loaded).not.toBeNull();
    expect(loaded!.scene.id).toBe(scene.id);
    expect(loaded!.colormap.minSplDb).toBe(78);
    expect(loaded!.layoutMode).toBe('section');

    clearWorkspaceSession(mem);
    expect(loadWorkspaceSession(mem)).toBeNull();
  });

  it('persists projects and custom speakers in SessionStorageRepository and round-trips .wss-project.json bundles', async () => {
    const repo = new SessionStorageRepository();
    const customSub = buildSpeakerFromSpec({
      id: 'spk-custom-21-sub',
      name: '21" Touring Infra Sub',
      category: 'subwoofer',
      low3dBHz: 28,
      high3dBHz: 100,
      maxContinuousSpl1mDb: 139,
    });

    await repo.saveSpeaker(customSub);
    const speakers = await repo.listSpeakers();
    expect(speakers).toHaveLength(1);
    expect(speakers[0].id).toBe('spk-custom-21-sub');

    const scene = getDemoPresetById('theater-raked-balcony').createScene();
    await repo.saveProject({
      id: scene.id,
      name: scene.name,
      updatedAtIso: '2026-11-10T22:00:00.000Z',
      scene,
      colormap: DEFAULT_COLORMAP_CONFIG,
    });

    const projects = await repo.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe(scene.name);

    // Export / import self-contained .wss-project.json bundle
    const bundleText = serializeProjectBundle(scene, DEFAULT_COLORMAP_CONFIG, [customSub]);
    const restoredBundle = deserializeProjectBundle(bundleText);
    expect(restoredBundle.scene.name).toBe(scene.name);
    expect(restoredBundle.customSpeakers).toHaveLength(1);
    expect(restoredBundle.customSpeakers[0].maxContinuousSpl1mDb).toBe(139);

    await repo.deleteSpeaker(customSub.id);
    await repo.deleteProject(scene.id);
    expect(await repo.listSpeakers()).toHaveLength(0);
    expect(await repo.listProjects()).toHaveLength(0);
  });

  it('enforces exact browser storage keys and PWA cache pruning in sw-core', () => {
    expect(IDB_DATABASE_NAME).toBe('web-speaker-sim-db');
    expect(IDB_DATABASE_VERSION).toBe(1);
    expect([IDB_STORE_PROJECTS, IDB_STORE_SPEAKERS]).toEqual(['projects', 'speakers']);
    expect(WORKSPACE_STORAGE_KEY).toBe('wss.workspace.v1');

    const active = buildCacheName('web-speaker-sim-', 'abc12345');
    const obsolete = selectObsoleteCaches(
      ['web-speaker-sim-old1', 'web-speaker-sim-abc12345', 'other-app-cache'],
      active,
      'web-speaker-sim-'
    );
    expect(obsolete).toEqual(['web-speaker-sim-old1']);

    expect(
      shouldInterceptSameOriginGet('GET', 'https://example.com/assets/index.js', 'https://example.com')
    ).toBe(true);
    expect(
      shouldInterceptSameOriginGet('POST', 'https://example.com/api', 'https://example.com')
    ).toBe(false);

    const wrapped = withCrossOriginIsolationHeaders(
      new Response('hello', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    );
    expect(wrapped.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(wrapped.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });
});

