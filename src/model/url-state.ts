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
 * Tier-1 URL query parameter state (`src/model/url-state.ts`).
 */

import type { FrequencyWeighting } from '../physics/atmosphere.js';
import type { AnalysisBandSelection } from './project-types.js';

export type ViewportLayoutMode = 'split' | 'plan' | 'section';

export interface UrlViewState {
  readonly presetId?: string;
  readonly bandSelection?: AnalysisBandSelection;
  readonly layoutMode?: ViewportLayoutMode;
}

const VALID_LAYOUTS = new Set<ViewportLayoutMode>(['split', 'plan', 'section']);
const VALID_WEIGHTINGS = new Set<FrequencyWeighting>(['A', 'C', 'Z']);

/**
 * Parses URL query parameters (`?preset=...&band=...&weighting=...&shape=...&layout=...`)
 * into a validated `UrlViewState`.
 */
export function parseUrlState(search: string): UrlViewState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const presetRaw = params.get('preset')?.trim();
  const layoutRaw = params.get('layout')?.trim() as ViewportLayoutMode | undefined;
  const bandRaw = params.get('band')?.trim();
  const weightRaw = (params.get('weighting')?.trim().toUpperCase() ?? 'A') as FrequencyWeighting;
  const shapeRaw = params.get('shape')?.trim() === 'music' ? 'music' : 'pink';

  let bandSelection: AnalysisBandSelection | undefined;
  if (bandRaw) {
    if (bandRaw === 'broadband') {
      const weighting = VALID_WEIGHTINGS.has(weightRaw) ? weightRaw : 'A';
      bandSelection = {
        kind: 'band-average',
        label: `Broadband (${shapeRaw === 'music' ? 'Music' : 'Pink'} dB${weighting})`,
        minHz: 31.5,
        maxHz: 16000,
        weighting,
        spectrumShape: shapeRaw,
      };
    } else if (bandRaw === 'sub') {
      bandSelection = {
        kind: 'band-average',
        label: 'Subband (31.5–100 Hz dBC)',
        minHz: 31.5,
        maxHz: 100,
        weighting: 'C',
        spectrumShape: 'pink',
      };
    } else {
      const hz = Number(bandRaw);
      if (Number.isFinite(hz) && hz >= 20 && hz <= 20000) {
        bandSelection = {
          kind: 'single',
          frequencyHz: hz,
        };
      }
    }
  }

  return {
    presetId: presetRaw && presetRaw.length > 0 ? presetRaw : undefined,
    layoutMode: layoutRaw && VALID_LAYOUTS.has(layoutRaw) ? layoutRaw : undefined,
    bandSelection,
  };
}

/**
 * Serializes `UrlViewState` into a clean query string (`?preset=...&band=...`).
 */
export function serializeUrlState(state: UrlViewState): string {
  const params = new URLSearchParams();
  if (state.presetId) {
    params.set('preset', state.presetId);
  }
  if (state.bandSelection) {
    if (state.bandSelection.kind === 'single') {
      params.set('band', String(state.bandSelection.frequencyHz));
    } else if (state.bandSelection.maxHz <= 125) {
      params.set('band', 'sub');
    } else {
      params.set('band', 'broadband');
      params.set('weighting', state.bandSelection.weighting);
      if (state.bandSelection.spectrumShape === 'music') {
        params.set('shape', 'music');
      }
    }
  }
  if (state.layoutMode && state.layoutMode !== 'split') {
    params.set('layout', state.layoutMode);
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

export function replaceBrowserUrlState(state: UrlViewState): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  const query = serializeUrlState(state);
  const nextUrl = `${window.location.pathname}${query}${window.location.hash}`;
  window.history.replaceState(null, '', nextUrl);
}
