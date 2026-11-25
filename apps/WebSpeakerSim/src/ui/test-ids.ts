// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Canonical `data-testid` registry for `WebSpeakerSim` UI components, E2E drivers,
 * and Retina documentation screenshot scripts.
 */

export const WSS_TEST_IDS = {
  // Topbar & Layout
  appTopbar: 'app-topbar',
  scenePopoverBtn: 'btn-scene-popover',
  presetSelect: 'preset-select',
  projectsBtn: 'btn-projects',
  saveSnapshotBtn: 'btn-save-snapshot',
  exportProjectBtn: 'btn-export-project',
  importProjectBtn: 'btn-import-project',
  undoBtn: 'btn-undo',
  redoBtn: 'btn-redo',
  bandSelect: 'band-select',
  heatmapPopoverBtn: 'btn-heatmap-popover',
  colormapRangeSelect: 'colormap-range-select',
  topbarMinSpl: 'topbar-min-spl',
  topbarMaxSpl: 'topbar-max-spl',
  colormapPaletteSelect: 'colormap-palette-select',
  isolineSelect: 'isoline-select',
  colormapSteppedBtn: 'btn-colormap-stepped',
  groundBounceBtn: 'btn-ground-bounce',
  speakerLibraryBtn: 'btn-speaker-library',
  coverageMetrics: 'coverage-metrics',
  layoutSplitBtn: 'layout-split',
  layoutPlanBtn: 'layout-plan',
  layoutSectionBtn: 'layout-section',
  toggleChartsBtn: 'btn-toggle-charts',
  helpBtn: 'btn-help',
  helpModal: 'help-modal',
  helpIssuesLink: 'help-link-issues',
  helpSourceLink: 'help-link-source',

  // Main Shell, Viewports, Charts & Modals
  projectFileInput: 'project-file-input',
  viewportPlan: 'viewport-plan',
  viewportSection: 'viewport-section',
  chartDrawer: 'chart-drawer',
  chartMagSpanSelect: 'chart-mag-span-select',
  sceneSidebar: 'scene-sidebar',
  inspectorPane: 'inspector-pane',
  toastBanner: 'toast-banner',
  saveProjectDbBtn: 'btn-save-project-db',

  // Scene Tree Action Buttons & Fixed Rows
  addPointSourceBtn: 'btn-add-point-source',
  addSubArrayBtn: 'btn-add-sub-array',
  addDspGroupBtn: 'btn-add-dsp-group',
  addSurfaceBtn: 'btn-add-surface',
  addVirtualMicBtn: 'btn-add-virtual-mic',
  treeEnvironment: 'tree-environment',

  // Entity Inspectors
  pointSourceInspector: 'inspector-point-source',
  subArrayInspector: 'inspector-sub-array',
  dspGroupInspector: 'inspector-dsp-group',
  surfaceInspector: 'inspector-surface',
  virtualMicInspector: 'inspector-virtual-mic',
  environmentInspector: 'inspector-environment',
  deleteEntityBtn: 'btn-delete-entity',

  // Point Source & Sub Array Controls
  psNameInput: 'ps-name-input',
  psSpeakerSelect: 'ps-speaker-select',
  psGroupSelect: 'ps-group-select',
  psMirrorCheckbox: 'ps-mirror-checkbox',
  psPosX: 'ps-pos-x',
  psPosY: 'ps-pos-y',
  psPosZ: 'ps-pos-z',
  psAzimuth: 'ps-azimuth',
  psTilt: 'ps-tilt',
  saModeSelect: 'sa-mode-select',
  saSpeakerSelect: 'sa-speaker-select',
  saBoxCount: 'sa-box-count',
  saTuningHz: 'sa-tuning-hz',
  saQuarterWaveBtn: 'btn-sa-quarter-wave',

  // DSP Group Controls
  grpGainDb: 'grp-gain-db',
  grpDelayMs: 'grp-delay-ms',
  grpPolarityCheckbox: 'grp-polarity-checkbox',
  grpHpfTopology: 'grp-hpf-topology',
  grpLpfTopology: 'grp-lpf-topology',
  addEqBandBtn: 'btn-add-eq-band',

  // Virtual Mic Controls
  micPosX: 'mic-pos-x',
  micPosY: 'mic-pos-y',
  micPosZ: 'mic-pos-z',
  micPredictedReadout: 'mic-predicted-readout',
  exportMicFrdBtn: 'btn-export-mic-frd',
  autoTimeAlignPanel: 'auto-time-align-panel',
  alignRefSelect: 'align-ref-select',
  alignTargetSelect: 'align-target-select',
  applyAlignmentBtn: 'btn-apply-alignment',

  // Environment & Venue Bounds Controls
  envTempC: 'env-temp-c',
  envRhPct: 'env-rh-pct',
  envBoundsXMin: 'env-bounds-xmin',
  envBoundsXMax: 'env-bounds-xmax',
  envBoundsYMin: 'env-bounds-ymin',
  envBoundsYMax: 'env-bounds-ymax',
  envBoundsZMax: 'env-bounds-zmax',
  envSliceY: 'env-slice-y',

  // Speaker Library Modal, Spec Builder & Importer
  speakerLibraryModal: 'speaker-library-modal',
  closeLibraryModalBtn: 'btn-close-library-modal',
  tabCatalog: 'tab-catalog',
  tabSpecBuilder: 'tab-spec-builder',
  tabImportFile: 'tab-import-file',
  catalogSpeakerList: 'catalog-speaker-list',
  specBuilderForm: 'spec-builder-form',
  specNameInput: 'spec-name-input',
  specCategorySelect: 'spec-category-select',
  specHDeg: 'spec-h-deg',
  specVDeg: 'spec-v-deg',
  specMaxSpl: 'spec-max-spl',
  createSpecSpeakerBtn: 'btn-create-spec-speaker',
  speakerFileInput: 'speaker-file-input',
} as const;

export type WssTestId = (typeof WSS_TEST_IDS)[keyof typeof WSS_TEST_IDS];

export const WSS_DYNAMIC_TEST_IDS = {
  treeRow: (prefix: 'ps' | 'sa' | 'grp' | 'surf' | 'mic', id: string) =>
    `tree-${prefix}-${id}` as const,
  eqBand: (idx: number) => `eq-band-${idx}` as const,
} as const;

