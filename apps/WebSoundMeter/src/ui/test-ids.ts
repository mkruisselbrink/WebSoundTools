// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Canonical `data-testid` registry for `WebSoundMeter` UI components, E2E drivers,
 * and Retina documentation screenshot scripts.
 */

export const WSM_TEST_IDS = {
  // Topbar & Mode / Routing / Generator / SPL
  appTopbar: 'app-topbar',
  modeTuningBtn: 'btn-mode-tuning',
  modeShowBtn: 'btn-mode-show',
  undoBtn: 'btn-undo',
  redoBtn: 'btn-redo',
  layout1xBtn: 'btn-layout-1x',
  layout2xBtn: 'btn-layout-2x',
  layout3xBtn: 'btn-layout-3x',
  layoutPopoverBtn: 'btn-layout-popover',
  layoutSelect: 'select-layout',
  ioPopoverBtn: 'btn-io-popover',
  inputModeSelect: 'select-input-mode',
  refChannelSelect: 'select-ref-channel',
  pauseBtn: 'btn-pause',
  generatorToggleBtn: 'btn-generator-toggle',
  genPopoverBtn: 'btn-gen-popover',
  generatorTypeSelect: 'select-generator-type',
  generatorLevelSelect: 'select-generator-level',
  generatorOutChannelSelect: 'select-generator-output-channel',
  splMeterBar: 'spl-meter-bar',
  splPopoverBtn: 'btn-spl-popover',
  splWeightingSelect: 'select-spl-weighting',
  splMainValue: 'spl-main-value',
  splStatusBadge: 'spl-status-badge',
  splShowComplianceMetrics: 'spl-show-compliance-metrics',
  helpBtn: 'btn-help',
  githubLink: 'link-github',
  helpModal: 'help-modal',
  helpIssuesLink: 'help-link-issues',
  helpSourceLink: 'help-link-source',

  // Chart Header Controls
  coherenceModeSelect: 'select-coherence-mode',
  coherenceThresholdSelect: 'select-coherence-threshold',
  feedbackWatchToggle: 'toggle-feedback-watch',
  splWindowSelect: 'select-spl-window',
  splTraceModeSelect: 'select-spl-trace-mode',
  splThresholdsToggle: 'toggle-spl-thresholds',

  // Tuning Sidebar & Source Creation
  simulatorDescription: 'simulator-description',
  addMeasBtn: 'btn-add-meas',
  addEqBtn: 'btn-add-eq',
  addUnionBtn: 'btn-add-union',
  importFrdInput: 'input-import-frd',
  importFrdBtn: 'btn-import-frd',

  // Live Measurement Inspector
  liveMeasurementInspector: 'inspector-live-measurement',
  captureTraceBtn: 'btn-capture-trace',
  deleteLiveSlotBtn: 'btn-delete-live-slot',
  liveSlotNameInput: 'input-live-slot-name',
  liveSlotPresetSelect: 'select-live-slot-preset',
  liveSlotMeasChannelSelect: 'select-live-slot-meas-channel',
  liveSlotRefChannelSelect: 'select-live-slot-ref-channel',
  inputDbfsMeterStrip: 'input-dbfs-meter-strip',
  refDelayMsInput: 'input-ref-delay-ms',
  delayEstimateReadout: 'delay-estimate-readout',
  estimatedDelayMs: 'estimated-delay-ms',
  applyDelayBtn: 'btn-apply-delay',
  splOffsetDbInput: 'input-spl-offset-db',
  calibrateSplBtn: 'btn-calibrate-spl',
  feedbackModeSelect: 'select-feedback-mode',
  calibrationCurveSelect: 'select-calibration-curve',
  toggleAdvancedMeasBtn: 'btn-toggle-advanced-meas',
  fftSizeSelect: 'select-fft-size',
  smoothingSelect: 'select-smoothing',

  // Stored, Virtual EQ & Math Union Inspectors
  storedSourceInspector: 'inspector-stored-source',
  exportStoredFrdBtn: 'btn-export-stored-frd',
  eqSourceInspector: 'inspector-eq-source',
  autoFlattenEqBtn: 'btn-auto-flatten-eq',
  eqDspGain: 'eq-dsp-gain',
  eqDspDelay: 'eq-dsp-delay',
  eqDspPolarity: 'eq-dsp-polarity',
  eqDspMuted: 'eq-dsp-muted',
  eqHpfTopology: 'eq-hpf-topology',
  eqHpfFreq: 'eq-hpf-freq',
  eqLpfTopology: 'eq-lpf-topology',
  eqLpfFreq: 'eq-lpf-freq',
  addEqBandBtn: 'btn-add-eq-band',
  unionSourceInspector: 'inspector-union-source',
  unionSourceChecklist: 'union-source-checklist',

  // Show Mode Sidebar
  showSidebar: 'show-sidebar',
  liveMicsWatchCard: 'card-live-mics-watch',
  showAddMeasBtn: 'btn-show-add-meas',
  feedbackRingLogCard: 'card-feedback-ring-log',
  clearRingLogBtn: 'btn-clear-ring-log',
  emptyRingLog: 'empty-ring-log',
  ringLogList: 'ring-log-list',
  showLimitsExportCard: 'card-show-limits-export',
  resetShowLogBtn: 'btn-reset-show-log',
  exportSplCsvBtn: 'btn-export-spl-csv',
  splAlertMetricSelect: 'select-spl-alert-metric',
  splWarnDbInput: 'input-spl-warn-db',
  splLimitDbInput: 'input-spl-limit-db',
} as const;

export type WsmTestId = (typeof WSM_TEST_IDS)[keyof typeof WSM_TEST_IDS];

export const WSM_DYNAMIC_TEST_IDS = {
  chartPanel: (idx: number) => `chart-panel-${idx}` as const,
  showMic: (slotId: string) => `show-mic-${slotId}` as const,
  showSimPreset: (slotId: string) => `select-show-sim-preset-${slotId}` as const,
  showGainInput: (slotId: string) => `input-show-gain-${slotId}` as const,
  showSplOffsetInput: (slotId: string) => `input-show-spl-offset-${slotId}` as const,
  showCalBtn: (slotId: string) => `btn-show-cal-${slotId}` as const,
  ringLogNotchBtn: (trackId: string) => `btn-notch-eq-${trackId}` as const,
} as const;

