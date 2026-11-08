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

import { html, TemplateResult } from 'lit';
import type { LayoutPreset } from '../app-shell.js';
import {
  DelayCaptureGroupProps,
  renderDelayCaptureGroup,
} from './delay-capture-group.js';
import { GeneratorGroupProps, renderGeneratorGroup } from './generator-group.js';
import {
  InputRoutingGroupProps,
  renderInputRoutingGroup,
} from './input-routing-group.js';
import { renderSplMeterGroup, SplMeterGroupProps } from './spl-meter-group.js';

export interface TopbarViewProps
  extends InputRoutingGroupProps,
    GeneratorGroupProps,
    DelayCaptureGroupProps,
    SplMeterGroupProps {
  readonly layoutPreset: LayoutPreset;
  readonly onLayoutPresetChange: (preset: LayoutPreset) => void;
}

export function renderTopbar(props: TopbarViewProps): TemplateResult {
  return html`
    <header class="topbar">
      <div class="brand">
        <span>WebSoundMeter</span>
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
      ${renderGeneratorGroup(props)}
      ${renderDelayCaptureGroup(props)}
      ${renderSplMeterGroup(props)}
    </header>
  `;
}

