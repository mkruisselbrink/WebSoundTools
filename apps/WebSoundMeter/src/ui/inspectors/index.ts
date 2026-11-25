// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type PopoverParentRootLike,
  downloadTextFile,
  slugifyFilename,
} from '@foh/ui';
import type { TemplateResult } from 'lit';
import { exportSourceDataToFrd, type SourceData } from '../../sources/source-data.js';
import { isLiveSourceId, type SourceStore } from '../../sources/source-store.js';
import type { AudioSessionController } from '../controllers/audio-session-controller.js';
import type { MixerWatchController } from '../controllers/mixer-watch-controller.js';
import type { WorkspaceLayoutController } from '../workspace-store.js';
import { renderEqInspector } from './eq-source-inspector.js';
import { renderLiveMeasurementInspector } from './live-measurement-inspector.js';
import { renderStoredInspector } from './stored-source-inspector.js';
import { renderUnionInspector } from './union-source-inspector.js';

export interface RenderSourceInspectorParams {
  readonly allSources: readonly SourceData[];
  readonly sources: SourceStore;
  readonly audio: AudioSessionController;
  readonly workspace: WorkspaceLayoutController;
  readonly mixerWatch: MixerWatchController;
  readonly popoverRoot: PopoverParentRootLike;
  readonly showAdvanced: boolean;
  readonly onToggleAdvanced: () => void;
}

export function renderSourceInspector(
  params: RenderSourceInspectorParams
): TemplateResult {
  const { allSources, sources, audio, workspace, mixerWatch, popoverRoot } = params;
  const selectedId = sources.getSelectedSourceId();
  const activeLiveId = sources.getActiveLiveSourceId();
  const liveSlot = audio.engine!.getLiveSlot(activeLiveId);
  const activeLiveSource = sources.getLiveSource(activeLiveId);
  const canDeleteSlot = (audio.engine?.getLiveSlots().length ?? 1) > 1;

  const liveHandlers = {
    slot: liveSlot,
    delayEstimate: activeLiveSource?.delayEstimate,
    levels: activeLiveSource?.levels,
    splWeighting: workspace.splWeighting,
    popoverRoot,
    audioInputMode: workspace.audioInputMode,
    availableChannels: audio.availableChannels,
    globalReferenceChannel: audio.globalReferenceChannel,
    showAdvanced: params.showAdvanced,
    onToggleAdvanced: params.onToggleAdvanced,
    canDeleteSlot,
    onUpdateSlotMeta: (
      partial: Parameters<AudioSessionController['updateLiveSlotMeta']>[1]
    ) => audio.updateLiveSlotMeta(liveSlot.id, partial),
    onDeleteSlot: () => audio.removeLiveSlot(liveSlot.id),
    onFindAndApplyDelay: () => audio.findAndApplyDelay(liveSlot.id),
    onCaptureTrace: () => {
      sources.captureCurrentTrace();
      audio.persistState('replace');
    },
    savedCalibrations: audio.calibrationMgr.getAll(),
    activeCalibrationId: liveSlot.activeCalibrationId,
    onSelectCalibration: (calId: string | null) =>
      audio.selectCalibration(liveSlot.id, calId),
    onDeleteCalibration: (calId: string) =>
      audio.deleteCalibration(liveSlot.id, calId),
    onResetAveraging: () => audio.resetAveraging(liveSlot.id, true),
    onUpdateConfig: (
      partial: Parameters<AudioSessionController['updateMeasurementConfig']>[0]
    ) => audio.updateMeasurementConfig(partial, liveSlot.id),
    onCalibrationUpload: (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) audio.uploadCalibrationFile(liveSlot.id, file);
    },
    mixerWatchEnabled: mixerWatch.config.enabled,
    mixerWatchChannelCount: mixerWatch.enabledChannelCount,
    onOpenMixerWatch: () => mixerWatch.openModal(),
  };

  if (isLiveSourceId(selectedId)) {
    return renderLiveMeasurementInspector(liveSlot.config, liveHandlers);
  }

  const stored = sources.getStoredSources().find((s) => s.id === selectedId);
  if (stored) {
    return renderStoredInspector(stored, {
      onDelete: (id) => {
        sources.deleteStoredSource(id);
        audio.persistState('replace');
      },
      onUpdateStored: (id, partial) => sources.updateStoredSource(id, partial),
      onExportFrd: (src) => {
        const frdText = exportSourceDataToFrd(src);
        downloadTextFile(
          frdText,
          `${slugifyFilename(src.name, 'trace')}.frd`,
          'text/plain;charset=utf-8'
        );
      },
    });
  }

  const eq = sources.getEqSources().find((s) => s.id === selectedId);
  if (eq) {
    return renderEqInspector(eq, allSources, {
      onAutoFlatten: (eqId) => sources.autoFlattenRoomModesWithEq(eqId),
      onTargetSourceChange: (eqId, targetSourceId) =>
        sources.setEqTargetSource(eqId, targetSourceId),
      onUpdateEqBand: (eqId, bandIdx, partial) =>
        sources.updateEqBand(eqId, bandIdx, partial),
      onUpdateEqDsp: (eqId, patch, txKey) =>
        sources.updateEqDsp(eqId, patch, txKey),
      onDelete: (eqId) => {
        sources.deleteEqSource(eqId);
        audio.persistState('replace');
      },
    });
  }

  const union = sources.getUnionSources().find((s) => s.id === selectedId);
  if (union) {
    return renderUnionInspector(union, allSources, {
      onUpdateUnion: (unionId, partial) =>
        sources.updateUnionSource(unionId, partial),
      onDelete: (unionId) => {
        sources.deleteUnionSource(unionId);
        audio.persistState('replace');
      },
    });
  }

  return renderLiveMeasurementInspector(liveSlot.config, liveHandlers);
}
