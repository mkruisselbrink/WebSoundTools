// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reactive `ProjectStore` with transaction-coalesced Undo/Redo history,
 * selection state, colormap settings, and merged speaker library.
 */

import type { AtmosphericConditions } from '@foh/acoustics';
import {
  DEFAULT_SOURCE_DSP_CONFIG,
  type SourceDspConfig,
  type SourceDspConfigPatch,
} from '@foh/dsp';
import { ReactiveUndoStore } from '@foh/state';
import { getBuiltinSpeakerMap } from '../library/builtin-speakers.js';
import { getDemoPresetById } from '../library/demo-presets.js';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import { DEFAULT_GROUND_REFLECTOR } from '../physics/transform3d.js';
import {
  DEFAULT_COLORMAP_CONFIG,
  resolveEffectiveSplRange,
  type ColormapConfig,
  type ColormapPaletteId,
  type ColormapRangeMode,
  type IsolineStepDb,
} from './colormap-config.js';
import type {
  AnalysisBandSelection,
  AudienceSurface,
  DspGroup,
  PointSourceInstance,
  ProjectScene,
  SubArrayInstance,
  VirtualMicInstance,
} from './project-types.js';

export {
  DEFAULT_COLORMAP_CONFIG,
  resolveEffectiveSplRange,
  type ColormapConfig,
  type ColormapPaletteId,
  type ColormapRangeMode,
  type IsolineStepDb,
};

export type SelectedEntity =
  | { readonly kind: 'surface'; readonly id: string }
  | { readonly kind: 'point-source'; readonly id: string }
  | { readonly kind: 'sub-array'; readonly id: string }
  | { readonly kind: 'dsp-group'; readonly id: string }
  | { readonly kind: 'virtual-mic'; readonly id: string }
  | { readonly kind: 'environment' };

export type StoreChangeKind = 'scene' | 'selection' | 'colormap' | 'speakers';

export type ProjectStoreListener = (changeKind: StoreChangeKind, isInteractive: boolean) => void;

const GROUP_PALETTE = ['#38bdf8', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#eab308'];

export class ProjectStore {
  private readonly sceneStore: ReactiveUndoStore<ProjectScene>;

  private selected: SelectedEntity | null = null;
  private colormapState: ColormapConfig = { ...DEFAULT_COLORMAP_CONFIG };
  private readonly customSpeakers = new Map<string, SpeakerDefinition>();
  private readonly listeners = new Set<ProjectStoreListener>();
  private idCounter = 1;

  constructor(initialScene?: ProjectScene, maxHistory: number = 60) {
    const startScene = initialScene ?? getDemoPresetById('club-cardioid-pa').createScene();
    this.sceneStore = new ReactiveUndoStore<ProjectScene>(startScene, { maxHistory });
    this.sceneStore.subscribe((_state, isInteractive) => {
      this.emit('scene', isInteractive);
    });
    if (startScene.pointSources.length > 0) {
      this.selected = { kind: 'point-source', id: startScene.pointSources[0].id };
    }
  }

  public get scene(): ProjectScene {
    return this.sceneStore.state;
  }

  public get selectedEntity(): SelectedEntity | null {
    return this.selected;
  }

  public get colormap(): ColormapConfig {
    return this.colormapState;
  }

  public get canUndo(): boolean {
    return this.sceneStore.canUndo;
  }

  public get canRedo(): boolean {
    return this.sceneStore.canRedo;
  }

  public subscribe(listener: ProjectStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(kind: StoreChangeKind, isInteractive: boolean = false): void {
    for (const fn of this.listeners) {
      fn(kind, isInteractive);
    }
  }

  private nextId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${this.idCounter++}`;
  }

  public getSpeakerMap(): Map<string, SpeakerDefinition> {
    const merged = new Map<string, SpeakerDefinition>(getBuiltinSpeakerMap());
    for (const [id, spk] of this.customSpeakers) {
      merged.set(id, spk);
    }
    return merged;
  }

  public getAllSpeakers(): SpeakerDefinition[] {
    return Array.from(this.getSpeakerMap().values());
  }

  public getCustomSpeakers(): SpeakerDefinition[] {
    return Array.from(this.customSpeakers.values());
  }

  public getSpeakerById(id: string): SpeakerDefinition | undefined {
    return this.customSpeakers.get(id) ?? getBuiltinSpeakerMap().get(id);
  }

  public upsertCustomSpeaker(speaker: SpeakerDefinition): void {
    this.customSpeakers.set(speaker.id, speaker);
    this.emit('speakers', false);
  }

  public setCustomSpeakers(speakers: readonly SpeakerDefinition[]): void {
    this.customSpeakers.clear();
    for (const spk of speakers) {
      this.customSpeakers.set(spk.id, spk);
    }
    this.emit('speakers', false);
  }

  public removeCustomSpeaker(speakerId: string): void {
    if (this.customSpeakers.delete(speakerId)) {
      this.emit('speakers', false);
    }
  }

  public setSelection(selection: SelectedEntity | null): void {
    this.selected = selection;
    this.emit('selection', false);
  }

  public setColormap(patch: Partial<ColormapConfig>): void {
    const switchToManual =
      patch.rangeMode === undefined &&
      (patch.minSplDb !== undefined || patch.maxSplDb !== undefined);
    this.colormapState = {
      ...this.colormapState,
      ...(switchToManual ? { rangeMode: 'manual' as const } : {}),
      ...patch,
    };
    this.emit('colormap', false);
  }

  public endTransaction(): void {
    this.sceneStore.endTransaction();
  }

  /**
   * Applies an immutable scene update. Consecutive updates sharing a non-empty `transactionKey`
   * within 800 ms coalesce into a single Undo snapshot while firing live interactive updates.
   */
  public updateScene(
    updater: (prev: ProjectScene) => ProjectScene,
    transactionKey?: string
  ): void {
    this.sceneStore.update(updater, transactionKey);
  }

  /** Replaces the entire active project (e.g. preset load or file open) and clears undo history. */
  public replaceProject(scene: ProjectScene, recordUndo: boolean = false): void {
    if (scene.pointSources.length > 0) {
      this.selected = { kind: 'point-source', id: scene.pointSources[0].id };
    } else if (scene.subArrays.length > 0) {
      this.selected = { kind: 'sub-array', id: scene.subArrays[0].id };
    } else {
      this.selected = null;
    }
    this.sceneStore.replace(scene, recordUndo);
  }

  public loadPreset(presetId: string): void {
    const preset = getDemoPresetById(presetId);
    this.replaceProject(preset.createScene(), true);
  }

  public undo(): boolean {
    return this.sceneStore.undo();
  }

  public redo(): boolean {
    return this.sceneStore.redo();
  }

  // --- Domain Convenience Mutators ---

  public setBandSelection(bandSelection: AnalysisBandSelection): void {
    this.updateScene((s) => ({ ...s, bandSelection }));
  }

  public setAtmosphere(patch: Partial<AtmosphericConditions>, txKey?: string): void {
    this.updateScene(
      (s) => ({ ...s, atmosphere: { ...s.atmosphere, ...patch } }),
      txKey
    );
  }

  public setDriveOffsetDb(driveOffsetDb: number, txKey?: string): void {
    this.updateScene((s) => ({ ...s, driveOffsetDb }), txKey);
  }

  public setGroundReflection(enabled: boolean, reflectionFactor?: number, txKey?: string): void {
    this.updateScene((s) => {
      const existing = s.reflectors.find((r) => r.id === DEFAULT_GROUND_REFLECTOR.id);
      const updated = existing
        ? s.reflectors.map((r) =>
            r.id === DEFAULT_GROUND_REFLECTOR.id
              ? {
                  ...r,
                  enabled,
                  reflectionFactor: reflectionFactor ?? r.reflectionFactor,
                }
              : r
          )
        : [
            ...s.reflectors,
            {
              ...DEFAULT_GROUND_REFLECTOR,
              enabled,
              reflectionFactor: reflectionFactor ?? DEFAULT_GROUND_REFLECTOR.reflectionFactor,
            },
          ];
      return { ...s, reflectors: updated };
    }, txKey);
  }

  public setSliceYM(sliceYM: number, txKey?: string): void {
    this.updateScene(
      (s) => ({
        ...s,
        sectionBounds: { ...s.sectionBounds, sliceYM },
      }),
      txKey
    );
  }

  public setVenueBounds(
    patch: {
      readonly xMin?: number;
      readonly xMax?: number;
      readonly yMin?: number;
      readonly yMax?: number;
      readonly zMax?: number;
    },
    txKey?: string
  ): void {
    this.updateScene((s) => {
      const rawXMin = patch.xMin ?? s.planBounds.xMin;
      const rawXMax = patch.xMax ?? s.planBounds.xMax;
      const xMin = Math.min(rawXMin, rawXMax - 4);
      const xMax = Math.max(rawXMax, xMin + 4);

      const rawYMin = patch.yMin ?? s.planBounds.yMin;
      const rawYMax = patch.yMax ?? s.planBounds.yMax;
      const yMin = Math.min(rawYMin, rawYMax - 4);
      const yMax = Math.max(rawYMax, yMin + 4);

      const zMax = Math.max(2, patch.zMax ?? s.sectionBounds.zMax);
      const clampedSliceY = Math.max(yMin, Math.min(yMax, s.sectionBounds.sliceYM));

      return {
        ...s,
        planBounds: { xMin, xMax, yMin, yMax },
        sectionBounds: {
          ...s.sectionBounds,
          xMin,
          xMax,
          zMax,
          sliceYM: clampedSliceY,
        },
      };
    }, txKey);
  }

  public addDspGroup(partial?: Partial<DspGroup>): DspGroup {
    const idx = this.scene.dspGroups.length;
    const group: DspGroup = {
      id: partial?.id ?? this.nextId('grp'),
      name: partial?.name ?? `DSP Group ${idx + 1}`,
      color: partial?.color ?? GROUP_PALETTE[idx % GROUP_PALETTE.length],
      dsp: partial?.dsp ?? { ...DEFAULT_SOURCE_DSP_CONFIG },
    };
    this.updateScene((s) => ({ ...s, dspGroups: [...s.dspGroups, group] }));
    this.selected = { kind: 'dsp-group', id: group.id };
    this.emit('selection', false);
    return group;
  }

  public updateDspGroup(
    groupId: string,
    patch: Partial<Omit<DspGroup, 'id' | 'dsp'>> & { dsp?: SourceDspConfigPatch },
    txKey?: string
  ): void {
    this.updateScene(
      (s) => ({
        ...s,
        dspGroups: s.dspGroups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                ...patch,
                dsp: patch.dsp
                  ? {
                      ...g.dsp,
                      ...patch.dsp,
                      highPass: patch.dsp.highPass
                        ? { ...g.dsp.highPass, ...patch.dsp.highPass }
                        : g.dsp.highPass,
                      lowPass: patch.dsp.lowPass
                        ? { ...g.dsp.lowPass, ...patch.dsp.lowPass }
                        : g.dsp.lowPass,
                    }
                  : g.dsp,
              }
            : g
        ),
      }),
      txKey
    );
  }

  public removeDspGroup(groupId: string): void {
    if (this.scene.dspGroups.length <= 1) return;
    const fallbackGroupId =
      this.scene.dspGroups.find((g) => g.id !== groupId)?.id ?? groupId;
    this.updateScene((s) => ({
      ...s,
      dspGroups: s.dspGroups.filter((g) => g.id !== groupId),
      pointSources: s.pointSources.map((ps) =>
        ps.dspGroupId === groupId ? { ...ps, dspGroupId: fallbackGroupId } : ps
      ),
      subArrays: s.subArrays.map((sa) =>
        sa.dspGroupId === groupId ? { ...sa, dspGroupId: fallbackGroupId } : sa
      ),
    }));
    if (this.selected?.kind === 'dsp-group' && this.selected.id === groupId) {
      this.selected = { kind: 'dsp-group', id: fallbackGroupId };
      this.emit('selection', false);
    }
  }

  public addPointSource(partial?: Partial<PointSourceInstance>): PointSourceInstance {
    const defaultGroup = this.scene.dspGroups[0]?.id ?? this.addDspGroup().id;
    const idx = this.scene.pointSources.length + 1;
    const ps: PointSourceInstance = {
      id: partial?.id ?? this.nextId('ps'),
      name: partial?.name ?? `Point Source ${idx}`,
      speakerId: partial?.speakerId ?? 'builtin-top-12-90x60',
      dspGroupId: partial?.dspGroupId ?? defaultGroup,
      position: partial?.position ?? { x: 0.5, y: 4.0, z: 3.5 },
      orientation: partial?.orientation ?? { azimuthDeg: -10, tiltDeg: -10, rollDeg: 0 },
      mirrorLeftRight: partial?.mirrorLeftRight ?? true,
      trimGainDb: partial?.trimGainDb ?? 0,
      trimDelayMs: partial?.trimDelayMs ?? 0,
      invertPolarity: partial?.invertPolarity ?? false,
      muted: partial?.muted ?? false,
    };
    this.updateScene((s) => ({ ...s, pointSources: [...s.pointSources, ps] }));
    this.selected = { kind: 'point-source', id: ps.id };
    this.emit('selection', false);
    return ps;
  }

  public updatePointSource(
    id: string,
    patch: Partial<Omit<PointSourceInstance, 'id'>>,
    txKey?: string
  ): void {
    this.updateScene(
      (s) => ({
        ...s,
        pointSources: s.pointSources.map((ps) => (ps.id === id ? { ...ps, ...patch } : ps)),
      }),
      txKey
    );
  }

  public removePointSource(id: string): void {
    this.updateScene((s) => ({
      ...s,
      pointSources: s.pointSources.filter((ps) => ps.id !== id),
    }));
    if (this.selected?.kind === 'point-source' && this.selected.id === id) {
      this.selected = null;
      this.emit('selection', false);
    }
  }

  public addSubArray(partial?: Partial<SubArrayInstance>): SubArrayInstance {
    const defaultGroup =
      this.scene.dspGroups.find((g) => g.dsp.lowPass.topology !== 'off')?.id ??
      this.scene.dspGroups[0]?.id ??
      this.addDspGroup().id;
    const idx = this.scene.subArrays.length + 1;
    const sa: SubArrayInstance = {
      id: partial?.id ?? this.nextId('sa'),
      name: partial?.name ?? `Sub Array ${idx}`,
      speakerId: partial?.speakerId ?? 'builtin-sub-18-reflex',
      dspGroupId: partial?.dspGroupId ?? defaultGroup,
      mode: partial?.mode ?? 'cardioid-csa',
      boxCount: partial?.boxCount ?? 4,
      origin: partial?.origin ?? { x: 0.4, y: 0, z: 0.35 },
      azimuthDeg: partial?.azimuthDeg ?? 0,
      spacingM: partial?.spacingM ?? 1.4,
      cardioidDepthOffsetM: partial?.cardioidDepthOffsetM ?? 0.85,
      tuningFrequencyHz: partial?.tuningFrequencyHz ?? 63,
      arcAngleDeg: partial?.arcAngleDeg ?? 75,
      muted: partial?.muted ?? false,
    };
    this.updateScene((s) => ({ ...s, subArrays: [...s.subArrays, sa] }));
    this.selected = { kind: 'sub-array', id: sa.id };
    this.emit('selection', false);
    return sa;
  }

  public updateSubArray(
    id: string,
    patch: Partial<Omit<SubArrayInstance, 'id'>>,
    txKey?: string
  ): void {
    this.updateScene(
      (s) => ({
        ...s,
        subArrays: s.subArrays.map((sa) => (sa.id === id ? { ...sa, ...patch } : sa)),
      }),
      txKey
    );
  }

  public removeSubArray(id: string): void {
    this.updateScene((s) => ({
      ...s,
      subArrays: s.subArrays.filter((sa) => sa.id !== id),
    }));
    if (this.selected?.kind === 'sub-array' && this.selected.id === id) {
      this.selected = null;
      this.emit('selection', false);
    }
  }

  public addSurface(partial?: Partial<AudienceSurface>): AudienceSurface {
    const idx = this.scene.surfaces.length + 1;
    const surf: AudienceSurface = {
      id: partial?.id ?? this.nextId('surf'),
      name: partial?.name ?? `Audience Zone ${idx}`,
      role: partial?.role ?? 'audience',
      enabled: partial?.enabled ?? true,
      xStart: partial?.xStart ?? 4,
      xEnd: partial?.xEnd ?? 18,
      yCenter: partial?.yCenter ?? 0,
      widthStart: partial?.widthStart ?? 12,
      widthEnd: partial?.widthEnd ?? 12,
      zStart: partial?.zStart ?? 0,
      zEnd: partial?.zEnd ?? 0,
      earHeightM: partial?.earHeightM ?? 1.65,
    };
    this.updateScene((s) => ({ ...s, surfaces: [...s.surfaces, surf] }));
    this.selected = { kind: 'surface', id: surf.id };
    this.emit('selection', false);
    return surf;
  }

  public updateSurface(
    id: string,
    patch: Partial<Omit<AudienceSurface, 'id'>>,
    txKey?: string
  ): void {
    this.updateScene(
      (s) => ({
        ...s,
        surfaces: s.surfaces.map((sf) => (sf.id === id ? { ...sf, ...patch } : sf)),
      }),
      txKey
    );
  }

  public removeSurface(id: string): void {
    this.updateScene((s) => ({
      ...s,
      surfaces: s.surfaces.filter((sf) => sf.id !== id),
    }));
    if (this.selected?.kind === 'surface' && this.selected.id === id) {
      this.selected = null;
      this.emit('selection', false);
    }
  }

  public addVirtualMic(partial?: Partial<VirtualMicInstance>): VirtualMicInstance {
    const idx = this.scene.virtualMics.length + 1;
    const mic: VirtualMicInstance = {
      id: partial?.id ?? this.nextId('mic'),
      name: partial?.name ?? `Virtual Mic ${idx}`,
      color: partial?.color ?? GROUP_PALETTE[(idx - 1) % GROUP_PALETTE.length],
      position: partial?.position ?? { x: 10, y: 0, z: 1.65 },
      enabled: partial?.enabled ?? true,
    };
    this.updateScene((s) => ({ ...s, virtualMics: [...s.virtualMics, mic] }));
    this.selected = { kind: 'virtual-mic', id: mic.id };
    this.emit('selection', false);
    return mic;
  }

  public updateVirtualMic(
    id: string,
    patch: Partial<Omit<VirtualMicInstance, 'id'>>,
    txKey?: string
  ): void {
    this.updateScene(
      (s) => ({
        ...s,
        virtualMics: s.virtualMics.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      }),
      txKey
    );
  }

  public removeVirtualMic(id: string): void {
    this.updateScene((s) => ({
      ...s,
      virtualMics: s.virtualMics.filter((m) => m.id !== id),
    }));
    if (this.selected?.kind === 'virtual-mic' && this.selected.id === id) {
      this.selected = null;
      this.emit('selection', false);
    }
  }
}

