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

import { html, nothing, TemplateResult } from 'lit';
import type { LayoutPreset } from '../app-shell.js';
import { WorkspaceMode } from '../url-state.js';
import { GeneratorGroupProps, renderGeneratorGroup } from './generator-group.js';
import {
  InputRoutingGroupProps,
  renderInputRoutingGroup,
} from './input-routing-group.js';
import { renderSplMeterGroup, SplMeterGroupProps } from './spl-meter-group.js';

export interface TopbarViewProps
  extends InputRoutingGroupProps,
    GeneratorGroupProps,
    SplMeterGroupProps {
  readonly workspaceMode?: WorkspaceMode;
  readonly layoutPreset: LayoutPreset;
  readonly onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  readonly onLayoutPresetChange: (preset: LayoutPreset) => void;
}

export function renderTopbar(props: TopbarViewProps): TemplateResult {
  const mode = props.workspaceMode ?? 'tuning';

  return html`
    <header class="topbar">
      <div class="brand">
        <span>WebSoundMeter</span>
        <div class="mode-toggle-group" role="group" aria-label="Workspace Mode">
          <button
            class=${mode === 'tuning' ? 'active' : ''}
            data-testid="btn-mode-tuning"
            title="System Tuning & Alignment Mode"
            @click=${() => props.onWorkspaceModeChange?.('tuning')}
          >
            🛠 Tuning
          </button>
          <button
            class=${mode === 'show' ? 'active show-active' : ''}
            data-testid="btn-mode-show"
            title="Live Show Monitoring Mode (locks out Signal Generator & expands SPL / Feedback Watch)"
            @click=${() => props.onWorkspaceModeChange?.('show')}
          >
            🎚 Show
          </button>
        </div>

        <select
          aria-label="Chart Layout"
          data-testid="select-layout"
          .value=${props.layoutPreset}
          @change=${(e: Event) =>
            props.onLayoutPresetChange((e.target as HTMLSelectElement).value as LayoutPreset)}
        >
          <option value="pa-triple">PA Alignment (Mag + Phase + Impulse)</option>
          <option value="tf-dual">Transfer Function (Mag + Phase)</option>
          <option value="rta-mix">Live Mixing (RTA + Magnitude)</option>
          <option value="single">Single Chart</option>
        </select>
      </div>

      ${renderInputRoutingGroup(props)}
      ${mode === 'show' ? nothing : renderGeneratorGroup(props)}
      ${renderSplMeterGroup(props)}
    </header>
  `;
}
