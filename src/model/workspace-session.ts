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
 * Tier-2 `localStorage` workspace autosave & hydration (`src/model/workspace-session.ts`).
 */

import { DEFAULT_COLORMAP_CONFIG, type ColormapConfig } from './project-store.js';
import type { ProjectScene } from './project-types.js';
import type { ViewportLayoutMode } from './url-state.js';

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

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveDefaultStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function saveWorkspaceSession(
  snapshot: Omit<WorkspaceSessionSnapshot, 'version' | 'savedAtIso'>,
  storage?: StorageLike
): boolean {
  const target = resolveDefaultStorage(storage);
  if (!target) return false;

  try {
    const payload: WorkspaceSessionSnapshot = {
      version: 1,
      savedAtIso: new Date().toISOString(),
      ...snapshot,
    };
    target.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadWorkspaceSession(storage?: StorageLike): WorkspaceSessionSnapshot | null {
  const target = resolveDefaultStorage(storage);
  if (!target) return null;

  try {
    const raw = target.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSessionSnapshot>;
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
      colormap: parsed.colormap ? { ...DEFAULT_COLORMAP_CONFIG, ...parsed.colormap } : DEFAULT_COLORMAP_CONFIG,
      layoutMode:
        parsed.layoutMode === 'plan' || parsed.layoutMode === 'section'
          ? parsed.layoutMode
          : 'split',
      chartDrawerExpanded: parsed.chartDrawerExpanded !== false,
    };
  } catch {
    return null;
  }
}

export function clearWorkspaceSession(storage?: StorageLike): void {
  const target = resolveDefaultStorage(storage);
  target?.removeItem(WORKSPACE_STORAGE_KEY);
}
