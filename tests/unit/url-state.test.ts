/**
 * WebSoundMeter
 * Copyright (C) 2026 WebSoundMeter Contributors
 * Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
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

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_URL_VIEW_STATE,
  UrlViewState,
  parseUrlViewState,
  serializeUrlViewState,
  syncBrowserUrlState,
} from '../../src/ui/url-state.js';

describe('url-state', () => {
  it('returns default view state when query string is empty and elides defaults on serialize', () => {
    const parsed = parseUrlViewState('');
    expect(parsed).toEqual(DEFAULT_URL_VIEW_STATE);
    expect(serializeUrlViewState(parsed)).toBe('');
  });

  it('round-trips non-default view state including custom plots, hardware mode, and SPL settings', () => {
    const custom: UrlViewState = {
      layoutPreset: 'tf-dual',
      chartPlotTypes: ['magnitude', 'coherence'],
      audioInputMode: 'hardware',
      simulatorPreset: 'sub-top-misaligned',
      splWeighting: 'C',
      splTime: 'Slow',
      selectedSourceId: 'eq-1234',
    };

    const qs = serializeUrlViewState(custom);
    expect(qs).toContain('layout=tf-dual');
    expect(qs).toContain('plots=magnitude%2Ccoherence');
    expect(qs).toContain('mode=hardware');
    expect(qs).toContain('preset=sub-top-misaligned');
    expect(qs).toContain('spl=C%2CSlow');
    expect(qs).toContain('src=eq-1234');

    const roundTripped = parseUrlViewState(qs);
    expect(roundTripped).toEqual(custom);
  });

  it('ignores invalid query parameter values and falls back to provided fallback state', () => {
    const fallback: Partial<UrlViewState> = {
      layoutPreset: 'rta-mix',
      chartPlotTypes: ['rta', 'magnitude'],
      simulatorPreset: 'comb-filtering',
    };
    const parsed = parseUrlViewState(
      '?layout=invalid&plots=bogus,notaplot&mode=alien&preset=nope&spl=X,Turbo',
      fallback
    );
    expect(parsed.layoutPreset).toBe('rta-mix');
    expect(parsed.chartPlotTypes).toEqual(['rta', 'magnitude']);
    expect(parsed.audioInputMode).toBe('simulator');
    expect(parsed.simulatorPreset).toBe('comb-filtering');
    expect(parsed.splWeighting).toBe('A');
    expect(parsed.splTime).toBe('Fast');
  });

  it('syncBrowserUrlState calls pushState or replaceState only when query string changes', () => {
    const pushState = vi.fn();
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: { pathname: '/', search: '', hash: '' },
        history: { pushState, replaceState },
      },
      configurable: true,
      writable: true,
    });

    // Default state matches empty search -> no history call
    syncBrowserUrlState(DEFAULT_URL_VIEW_STATE, 'push');
    expect(pushState).not.toHaveBeenCalled();

    // Non-default state with push mode
    syncBrowserUrlState(
      { ...DEFAULT_URL_VIEW_STATE, layoutPreset: 'single', chartPlotTypes: ['magnitude'] },
      'push'
    );
    expect(pushState).toHaveBeenCalledWith(null, '', '/?layout=single');

    // Non-default state with replace mode
    syncBrowserUrlState(
      { ...DEFAULT_URL_VIEW_STATE, selectedSourceId: 'stored-99' },
      'replace'
    );
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?src=stored-99');
  });

  it('serializes and parses Live Show workspaceMode via ?view=show and ?mode=show', () => {
    const showState: UrlViewState = {
      ...DEFAULT_URL_VIEW_STATE,
      workspaceMode: 'show',
      chartPlotTypes: ['rta', 'spl-history'],
    };
    const qs = serializeUrlViewState(showState);
    expect(qs).toContain('view=show');
    expect(qs).toContain('plots=rta%2Cspl-history');

    const parsedFromView = parseUrlViewState(qs);
    expect(parsedFromView.workspaceMode).toBe('show');
    expect(parsedFromView.chartPlotTypes).toEqual(['rta', 'spl-history']);

    const parsedFromModeAlias = parseUrlViewState('?mode=show');
    expect(parsedFromModeAlias.workspaceMode).toBe('show');
  });
});
