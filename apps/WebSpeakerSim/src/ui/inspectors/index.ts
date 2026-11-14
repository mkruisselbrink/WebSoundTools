// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Context-sensitive property inspector router for Point Sources, Subwoofer Arrays,
 * DSP Groups, Audience/Stage Surfaces, Virtual Microphones, and Venue Environment.
 */

import type { TemplateResult } from 'lit';
import type { ProjectStore } from '../../model/project-store.js';
import type { SimulationSnapshot } from '../../physics/sim-controller.js';
import { renderDspGroupInspector } from './dsp-group-inspector.js';
import { renderEnvironmentInspector } from './environment-inspector.js';
import { renderPointSourceInspector } from './point-source-inspector.js';
import { renderSubArrayInspector } from './sub-array-inspector.js';
import { renderSurfaceInspector } from './surface-inspector.js';
import { renderVirtualMicInspector, type AlignmentUiState } from './virtual-mic-inspector.js';

export type { AlignmentUiState };

export function renderEntityInspector(
  store: ProjectStore,
  snapshot: SimulationSnapshot | null,
  alignUi: AlignmentUiState
): TemplateResult {
  const sel = store.selectedEntity;
  const scene = store.scene;

  if (!sel) {
    return renderEnvironmentInspector(store);
  }

  switch (sel.kind) {
    case 'point-source': {
      const ps = scene.pointSources.find((p) => p.id === sel.id);
      return ps ? renderPointSourceInspector(store, ps) : renderEnvironmentInspector(store);
    }
    case 'sub-array': {
      const sa = scene.subArrays.find((s) => s.id === sel.id);
      return sa ? renderSubArrayInspector(store, sa) : renderEnvironmentInspector(store);
    }
    case 'dsp-group': {
      const grp = scene.dspGroups.find((g) => g.id === sel.id);
      return grp ? renderDspGroupInspector(store, grp) : renderEnvironmentInspector(store);
    }
    case 'surface': {
      const surf = scene.surfaces.find((s) => s.id === sel.id);
      return surf ? renderSurfaceInspector(store, surf) : renderEnvironmentInspector(store);
    }
    case 'virtual-mic': {
      const mic = scene.virtualMics.find((m) => m.id === sel.id);
      return mic
        ? renderVirtualMicInspector(store, snapshot, mic, alignUi)
        : renderEnvironmentInspector(store);
    }
    case 'environment':
      return renderEnvironmentInspector(store);
  }
}
