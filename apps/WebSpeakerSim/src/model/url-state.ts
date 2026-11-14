// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatQueryString, parseSearchParams, syncBrowserQueryString } from '@foh/state';
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

export function parseUrlState(search: string): UrlViewState {
  const params = parseSearchParams(search);
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
  return formatQueryString(params);
}

export function replaceBrowserUrlState(state: UrlViewState): void {
  syncBrowserQueryString(serializeUrlState(state), 'replace');
}
