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
import {
  BroadbandLevelsSnapshot,
  MeterIntegrationTime,
  WeightingCurve,
} from '../../dsp/weighting-meters.js';

export interface SplMeterGroupProps {
  readonly splWeighting: WeightingCurve;
  readonly splTime: MeterIntegrationTime;
  readonly levels?: BroadbandLevelsSnapshot;
  readonly onSplWeightingChange: (curve: WeightingCurve) => void;
  readonly onSplTimeChange: (time: MeterIntegrationTime) => void;
}

export function renderSplMeterGroup(props: SplMeterGroupProps): TemplateResult {
  const { levels } = props;
  const currentSpl = levels ? levels.levelsDb[props.splWeighting][props.splTime] : -40.0;
  const currentLeq = levels ? levels.levelsDb[props.splWeighting].Leq : -40.0;
  const currentPeak = levels ? levels.peaksDb[props.splWeighting] : -40.0;

  return html`
    <div class="toolbar-group spl-readout" data-testid="spl-meter-bar">
      <select
        aria-label="SPL Weighting"
        data-testid="select-spl-weighting"
        .value=${props.splWeighting}
        @change=${(e: Event) =>
          props.onSplWeightingChange((e.target as HTMLSelectElement).value as WeightingCurve)}
      >
        <option value="A">dBA</option>
        <option value="C">dBC</option>
        <option value="Z">dBZ</option>
      </select>
      <select
        aria-label="SPL Integration Time"
        .value=${props.splTime}
        @change=${(e: Event) =>
          props.onSplTimeChange(
            (e.target as HTMLSelectElement).value as MeterIntegrationTime
          )}
      >
        <option value="Fast">Fast</option>
        <option value="Slow">Slow</option>
        <option value="Impulse">Impulse</option>
      </select>
      <div class="spl-main-value" data-testid="spl-main-value">
        ${currentSpl.toFixed(1)} dB${props.splWeighting}
      </div>
      <div class="spl-sub-value">
        <div class="spl-sub-row"><span>Leq:</span><strong>${currentLeq.toFixed(1)}</strong></div>
        <div class="spl-sub-row"><span>Pk:</span><strong>${currentPeak.toFixed(1)}</strong></div>
      </div>
    </div>
  `;
}
