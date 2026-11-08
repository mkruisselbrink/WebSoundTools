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
import { DelayEstimate } from '../../dsp/deconvolution.js';

export interface DelayCaptureGroupProps {
  readonly delayEstimate?: DelayEstimate;
  readonly isPaused: boolean;
  readonly onFindAndApplyDelay: () => void;
  readonly onCaptureTrace: () => void;
  readonly onTogglePause: () => void;
}

export function renderDelayCaptureGroup(props: DelayCaptureGroupProps): TemplateResult {
  const delayEst = props.delayEstimate;

  return html`
    <div class="toolbar-group">
      <span class="toolbar-label delay-readout" data-testid="delay-estimate-readout">
        <span>Est Delay:</span>
        <strong class="delay-value" data-testid="estimated-delay-ms"
          >${delayEst ? `${delayEst.delayMs.toFixed(2)} ms` : '—'}</strong
        >
        <span class="pol-badge ${delayEst && delayEst.polarity < 0 ? '' : 'hidden'}"
          >(−POL)</span
        >
      </span>
      <button
        class="btn-primary"
        data-testid="btn-apply-delay"
        title="Find propagation delay via cross-correlation and apply to Reference channel (Shortcut: D)"
        @click=${props.onFindAndApplyDelay}
      >
        Find & Apply Delay
      </button>
      <button
        data-testid="btn-capture-trace"
        title="Capture current trace into Stored Sources (Shortcut: Space / C)"
        @click=${props.onCaptureTrace}
      >
        Capture (Space)
      </button>
      <button
        data-testid="btn-pause"
        class="btn-toggle-pause ${props.isPaused ? 'btn-active' : ''}"
        @click=${props.onTogglePause}
      >
        ${props.isPaused ? 'Resume' : 'Pause'}
      </button>
    </div>
  `;
}

