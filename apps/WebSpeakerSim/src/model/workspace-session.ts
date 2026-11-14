// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type StorageLike,
  readStorageJson,
  removeStorageKey,
  writeStorageJson,
} from '@foh/state';
import { DEFAULT_COLORMAP_CONFIG, type ColormapConfig } from './project-store.js';
import type { ProjectScene } from './project-types.js';
import type { ViewportLayoutMode } from './url-state.js';

export type { StorageLike };
export const WORKSPACE_STORAGE_KEY = 'wss.workspace.v1';

export interface WorkspaceSessionSnapshot {
  readonly version: 1;
  readonly savedAtIso: string;
  readonly activePresetId?: string;
  readonly scene: ProjectScene;
  readonly colormap: ColormapConfig;
  readonly layoutMode: ViewportLayoutMode;
  readonly chartDrawerExpanded: boolean;
}

export function saveWorkspaceSession(
  snapshot: Omit<WorkspaceSessionSnapshot, 'version' | 'savedAtIso'>,
  storage?: StorageLike
): boolean {
  const payload: WorkspaceSessionSnapshot = {
    version: 1,
    savedAtIso: new Date().toISOString(),
    ...snapshot,
  };
  return writeStorageJson(WORKSPACE_STORAGE_KEY, payload, storage);
}

export function loadWorkspaceSession(storage?: StorageLike): WorkspaceSessionSnapshot | null {
  const parsed = readStorageJson<Partial<WorkspaceSessionSnapshot>>(
    WORKSPACE_STORAGE_KEY,
    storage
  );
  if (
    !parsed ||
    parsed.version !== 1 ||
    !parsed.scene ||
    typeof parsed.scene.id !== 'string' ||
    !Array.isArray(parsed.scene.surfaces)
  ) {
    return null;
  }

  return {
    version: 1,
    savedAtIso: typeof parsed.savedAtIso === 'string' ? parsed.savedAtIso : '',
    activePresetId: typeof parsed.activePresetId === 'string' ? parsed.activePresetId : undefined,
    scene: parsed.scene,
    colormap: parsed.colormap
      ? { ...DEFAULT_COLORMAP_CONFIG, ...parsed.colormap }
      : DEFAULT_COLORMAP_CONFIG,
    layoutMode:
      parsed.layoutMode === 'plan' || parsed.layoutMode === 'section'
        ? parsed.layoutMode
        : 'split',
    chartDrawerExpanded: parsed.chartDrawerExpanded !== false,
  };
}

export function clearWorkspaceSession(storage?: StorageLike): void {
  removeStorageKey(WORKSPACE_STORAGE_KEY, storage);
}
