// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Property inspector for ISO 9613-1 Atmosphere, Ground Reflection, SPL Colormap,
 * and Side Section Slice plane.
 */

import { computeSpeedOfSoundMpS } from '@foh/acoustics';
import { numVal } from '@foh/ui';
import { html, type TemplateResult } from 'lit';
import type {
  ColormapPaletteId,
  ColormapRangeMode,
  IsolineStepDb,
  ProjectStore,
} from '../../model/project-store.js';
import { DEFAULT_GROUND_REFLECTOR } from '../../physics/transform3d.js';

export function renderEnvironmentInspector(store: ProjectStore): TemplateResult {
  const scene = store.scene;
  const cmap = store.colormap;
  const speedOfSound = computeSpeedOfSoundMpS(scene.atmosphere);
  const ground = scene.reflectors.find((r) => r.id === DEFAULT_GROUND_REFLECTOR.id);

  return html`
    <div data-testid="inspector-environment">
      <div class="insp-header">
        <span class="insp-title">Atmosphere, Colormap & Venue Bounds</span>
      </div>

      <div class="form-section">
        <div class="form-section-title">Project & Drive Level</div>
        <div class="field-row">
          <label class="field-label" for="env-project-name">Project Name</label>
          <input
            type="text"
            id="env-project-name"
            name="project-name"
            .value=${scene.name}
            @change=${(ev: Event) =>
              store.updateScene((s) => ({
                ...s,
                name: (ev.target as HTMLInputElement).value,
              }))}
          />
        </div>
        <div class="field-row">
          <label class="field-label" for="env-drive-offset">Drive Offset (dB)</label>
          <input
            type="number"
            id="env-drive-offset"
            name="drive-offset-db"
            step="1"
            min="-40"
            max="6"
            .value=${String(scene.driveOffsetDb)}
            @input=${(ev: Event) =>
              store.setDriveOffsetDb(numVal(ev, scene.driveOffsetDb), 'env-drive')}
          />
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">
          <span>ISO 9613-1 Atmosphere</span>
          <span>c = ${speedOfSound.toFixed(1)} m/s</span>
        </div>
        <div class="xyz-grid">
          <label class="mini-field">
            <span>Temp (°C)</span>
            <input
              type="number"
              name="env-temp-c"
              step="1"
              min="-20"
              max="50"
              data-testid="env-temp-c"
              .value=${String(scene.atmosphere.temperatureCelsius)}
              @input=${(ev: Event) =>
                store.setAtmosphere(
                  { temperatureCelsius: numVal(ev, scene.atmosphere.temperatureCelsius) },
                  'env-atm'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Humidity (%)</span>
            <input
              type="number"
              name="env-rh-pct"
              step="5"
              min="5"
              max="100"
              data-testid="env-rh-pct"
              .value=${String(scene.atmosphere.relativeHumidityPercent)}
              @input=${(ev: Event) =>
                store.setAtmosphere(
                  {
                    relativeHumidityPercent: Math.max(
                      5,
                      Math.min(100, numVal(ev, scene.atmosphere.relativeHumidityPercent))
                    ),
                  },
                  'env-atm'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Pressure (kPa)</span>
            <input
              type="number"
              name="env-pressure-kpa"
              step="0.5"
              .value=${String(scene.atmosphere.pressureKpa)}
              @input=${(ev: Event) =>
                store.setAtmosphere(
                  { pressureKpa: Math.max(70, numVal(ev, scene.atmosphere.pressureKpa)) },
                  'env-atm'
                )}
            />
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Ground-Plane Reflection (Z = 0)</div>
        <div class="field-row">
          <label class="field-label" for="env-ground-reflect">ReflectFactor</label>
          <input
            type="number"
            id="env-ground-reflect"
            name="ground-reflection-factor"
            step="0.05"
            min="0"
            max="1"
            .value=${String(ground?.reflectionFactor ?? 0.9)}
            @input=${(ev: Event) =>
              store.setGroundReflection(
                ground?.enabled ?? true,
                Math.max(0, Math.min(1, numVal(ev, 0.9))),
                'env-gnd'
              )}
          />
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">SPL Colormap & Contours</div>
        <div class="field-row">
          <label class="field-label" for="env-cmap-range">Range Mode</label>
          <select
            id="env-cmap-range"
            name="env-cmap-range"
            .value=${cmap.rangeMode}
            @change=${(ev: Event) =>
              store.setColormap({
                rangeMode: (ev.target as HTMLSelectElement).value as ColormapRangeMode,
              })}
          >
            <option value="auto-6" ?selected=${cmap.rangeMode === 'auto-6'}>
              Auto ±3 dB (Tight Coverage)
            </option>
            <option value="auto-12" ?selected=${cmap.rangeMode === 'auto-12'}>
              Auto ±6 dB (Fine Coverage)
            </option>
            <option value="auto-21" ?selected=${cmap.rangeMode === 'auto-21'}>
              Auto 21 dB (Standard)
            </option>
            <option value="auto-36" ?selected=${cmap.rangeMode === 'auto-36'}>
              Auto 36 dB (Wide / Sub Rejection)
            </option>
            <option value="manual" ?selected=${cmap.rangeMode === 'manual'}>
              Manual Min / Max
            </option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label" for="env-cmap-palette">Palette</label>
          <select
            id="env-cmap-palette"
            name="env-cmap-palette"
            .value=${cmap.palette}
            @change=${(ev: Event) =>
              store.setColormap({
                palette: (ev.target as HTMLSelectElement).value as ColormapPaletteId,
              })}
          >
            <option value="turbo" ?selected=${cmap.palette === 'turbo'}>
              Rainbow (High-Contrast)
            </option>
            <option value="inferno" ?selected=${cmap.palette === 'inferno'}>
              Thermal (Inferno)
            </option>
            <option value="viridis" ?selected=${cmap.palette === 'viridis'}>
              Viridis (Colorblind-Safe)
            </option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label" for="env-cmap-contours">Contours</label>
          <select
            id="env-cmap-contours"
            name="env-cmap-contours"
            .value=${String(cmap.isolineStepDb)}
            @change=${(ev: Event) =>
              store.setColormap({
                isolineStepDb: Number((ev.target as HTMLSelectElement).value) as IsolineStepDb,
              })}
          >
            <option value="1" ?selected=${cmap.isolineStepDb === 1}>1 dB (Ultra-Fine)</option>
            <option value="2" ?selected=${cmap.isolineStepDb === 2}>2 dB (Fine)</option>
            <option value="3" ?selected=${cmap.isolineStepDb === 3}>3 dB (Standard)</option>
            <option value="6" ?selected=${cmap.isolineStepDb === 6}>6 dB (Coarse)</option>
            <option value="0" ?selected=${cmap.isolineStepDb === 0}>Off</option>
          </select>
        </div>
        <div class="xy-grid" style="margin-top:6px">
          <label class="mini-field">
            <span>Manual Min (dB)</span>
            <input
              type="number"
              name="env-cmap-min"
              step="3"
              .value=${String(cmap.minSplDb)}
              @input=${(ev: Event) => store.setColormap({ minSplDb: numVal(ev, cmap.minSplDb) })}
            />
          </label>
          <label class="mini-field">
            <span>Manual Max (dB)</span>
            <input
              type="number"
              name="env-cmap-max"
              step="3"
              .value=${String(cmap.maxSplDb)}
              @input=${(ev: Event) => store.setColormap({ maxSplDb: numVal(ev, cmap.maxSplDb) })}
            />
          </label>
        </div>
        <div class="check-row">
          <label class="check-label">
            <input
              type="checkbox"
              name="env-cmap-stepped"
              .checked=${cmap.stepped}
              @change=${(ev: Event) =>
                store.setColormap({
                  stepped: (ev.target as HTMLInputElement).checked,
                })}
            />
            Stepped Isobar Color Bands
          </label>
        </div>
        <div class="check-row">
          <label class="check-label">
            <input
              type="checkbox"
              name="env-cmap-outside"
              .checked=${cmap.showOutsideSurfaces}
              @change=${(ev: Event) =>
                store.setColormap({
                  showOutsideSurfaces: (ev.target as HTMLInputElement).checked,
                })}
            />
            Show SPL Outside Audience Zones
          </label>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Venue Grid Bounds & Section Slice (m)</div>
        <div class="xy-grid">
          <label class="mini-field">
            <span>X Min (m)</span>
            <input
              type="number"
              name="env-bounds-xmin"
              step="1"
              data-testid="env-bounds-xmin"
              .value=${String(scene.planBounds.xMin)}
              @change=${(ev: Event) =>
                store.setVenueBounds(
                  { xMin: numVal(ev, scene.planBounds.xMin) },
                  'env-bounds'
                )}
            />
          </label>
          <label class="mini-field">
            <span>X Max (m)</span>
            <input
              type="number"
              name="env-bounds-xmax"
              step="1"
              data-testid="env-bounds-xmax"
              .value=${String(scene.planBounds.xMax)}
              @change=${(ev: Event) =>
                store.setVenueBounds(
                  { xMax: numVal(ev, scene.planBounds.xMax) },
                  'env-bounds'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Y Min (m)</span>
            <input
              type="number"
              name="env-bounds-ymin"
              step="1"
              data-testid="env-bounds-ymin"
              .value=${String(scene.planBounds.yMin)}
              @change=${(ev: Event) =>
                store.setVenueBounds(
                  { yMin: numVal(ev, scene.planBounds.yMin) },
                  'env-bounds'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Y Max (m)</span>
            <input
              type="number"
              name="env-bounds-ymax"
              step="1"
              data-testid="env-bounds-ymax"
              .value=${String(scene.planBounds.yMax)}
              @change=${(ev: Event) =>
                store.setVenueBounds(
                  { yMax: numVal(ev, scene.planBounds.yMax) },
                  'env-bounds'
                )}
            />
          </label>
        </div>
        <div class="xy-grid" style="margin-top:6px">
          <label class="mini-field">
            <span>Ceiling Z Max (m)</span>
            <input
              type="number"
              name="env-bounds-zmax"
              step="0.5"
              min="2"
              data-testid="env-bounds-zmax"
              .value=${String(scene.sectionBounds.zMax)}
              @change=${(ev: Event) =>
                store.setVenueBounds(
                  { zMax: numVal(ev, scene.sectionBounds.zMax) },
                  'env-bounds'
                )}
            />
          </label>
          <label class="mini-field">
            <span>Slice Y (m)</span>
            <input
              type="number"
              name="env-slice-y"
              step="0.5"
              data-testid="env-slice-y"
              .value=${String(Number(scene.sectionBounds.sliceYM.toFixed(2)))}
              @input=${(ev: Event) =>
                store.setSliceYM(numVal(ev, scene.sectionBounds.sliceYM), 'env-slice')}
            />
          </label>
        </div>
      </div>
    </div>
  `;
}
