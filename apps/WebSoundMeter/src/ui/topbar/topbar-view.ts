// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

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
            type="button"
            class=${mode === 'tuning' ? 'active' : ''}
            aria-pressed=${String(mode === 'tuning')}
            data-testid="btn-mode-tuning"
            title="System Tuning & Alignment Mode"
            @click=${() => props.onWorkspaceModeChange?.('tuning')}
          >
            🛠 Tuning
          </button>
          <button
            type="button"
            class=${mode === 'show' ? 'active show-active' : ''}
            aria-pressed=${String(mode === 'show')}
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
          <optgroup label="Live Show Monitoring">
            <option value="show-dual" ?selected=${props.layoutPreset === 'show-dual'}>
              Live Show 2x (RTA + SPL History)
            </option>
            <option value="show-triple" ?selected=${props.layoutPreset === 'show-triple'}>
              Live Show 3x (RTA + Mag + SPL History)
            </option>
            <option value="rta-mix" ?selected=${props.layoutPreset === 'rta-mix'}>
              Live Mixing 2x (RTA + Magnitude)
            </option>
          </optgroup>
          <optgroup label="System Tuning & Alignment">
            <option value="pa-triple" ?selected=${props.layoutPreset === 'pa-triple'}>
              PA Alignment 3x (Mag + Phase + Impulse)
            </option>
            <option value="tf-dual" ?selected=${props.layoutPreset === 'tf-dual'}>
              Transfer Function 2x (Mag + Phase)
            </option>
            <option value="single" ?selected=${props.layoutPreset === 'single'}>
              Single Chart 1x
            </option>
          </optgroup>
        </select>
      </div>

      ${renderInputRoutingGroup(props)}
      ${mode === 'show' && props.audioInputMode === 'hardware'
        ? nothing
        : renderGeneratorGroup(props)}
      ${renderSplMeterGroup(props)}
    </header>
  `;
}
