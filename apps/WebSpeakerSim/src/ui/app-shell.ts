// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Root application shell `<web-speaker-sim-app>` (`src/ui/app-shell.ts`),
 * composing `ProjectStore`, `SimulationController`, `<wss-topbar>`,
 * `<wss-viewport-panel>`, `<wss-chart-panel>`, `<wss-projects-modal>`,
 * and `<wss-speaker-library-modal>`.
 */

import {
  observeServiceWorkerUpdate,
  observeWindowControlsOverlay,
} from '@foh/pwa/client';
import '@foh/ui';
import { ShellWindowController, hasOpenPopover } from '@foh/ui';
import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '../charts/chart-panel.js';
import { DEMO_VENUE_PRESETS, getDemoPresetById } from '../library/demo-presets.js';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import {
  importProjectBundleFile,
  openProjectViaFilePicker,
  saveProjectAsViaPicker,
  saveProjectToHandle,
  saveSceneSnapshotToDb,
  type ProjectFileHandleLike,
} from '../model/project-io.js';
import { ProjectStore } from '../model/project-store.js';
import {
  SessionStorageRepository,
  type SavedProjectRecord,
} from '../model/session-storage.js';
import {
  parseUrlState,
  replaceBrowserUrlState,
  type ViewportLayoutMode,
} from '../model/url-state.js';
import {
  clearWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
} from '../model/workspace-session.js';
import {
  SimulationController,
  type SimulationSnapshot,
} from '../physics/sim-controller.js';
import { DEFAULT_GROUND_REFLECTOR } from '../physics/transform3d.js';
import '../viewport/viewport-panel.js';
import { appShellStyles } from './app-shell-styles.js';
import {
  WSS_HELP_ATTRIBUTION,
  WSS_HELP_RESOURCES,
  WSS_HELP_SHORTCUTS,
  WSS_HELP_SUMMARY,
} from './help-content.js';
import { renderEntityInspector } from './inspectors/index.js';
import './inspectors/speaker-library-modal.js';
import { dispatchAppShortcut } from './keyboard-shortcuts.js';
import './modals/wss-projects-modal.js';
import { renderSceneSidebar } from './sidebar/sidebar-view.js';
import './topbar/wss-topbar.js';
import type { WssTopbar } from './topbar/wss-topbar.js';

@customElement('web-speaker-sim-app')
export class WebSpeakerSimApp extends LitElement {
  static styles = appShellStyles;

  public readonly store: ProjectStore;
  public readonly simController: SimulationController;
  public readonly repository = new SessionStorageRepository();

  @state() private snapshot: SimulationSnapshot | null = null;
  @state() private activePresetId = 'club-cardioid-pa';
  @state() private layoutMode: ViewportLayoutMode = 'split';
  @state() private chartDrawerExpanded = true;
  @state() private speakerLibraryOpen = false;
  @state() private projectsModalOpen = false;
  @state() private helpModalOpen = false;
  @state() private savedProjects: SavedProjectRecord[] = [];
  @state() private activeFileHandle: ProjectFileHandleLike | null = null;
  @state() private hasUnsavedFileChanges = false;
  @state() private toastMessage = '';

  // Alignment UI state for Virtual Mic inspector
  @state() private alignRefGroupId = '';
  @state() private alignTargetGroupId = '';
  @state() private alignFreqHz = 80;

  // Counter incremented on store notifications to trigger Lit re-render & viewport sync
  @state() private storeRevision = 0;

  private isSceneModified = false;
  private isLoadingPreset = false;
  private unsubStore: (() => void) | null = null;
  private unsubSim: (() => void) | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly shellWindow = new ShellWindowController(this, {
    observeWco: (cb) => observeWindowControlsOverlay((snap) => cb(snap.visible)),
    observeSwUpdate: observeServiceWorkerUpdate,
    onFlushPersistence: () => this.flushAutosave(),
    onKeyDown: (ev) => this.handleKeyDown(ev),
  });

  constructor() {
    super();

    const urlState =
      typeof window !== 'undefined' ? parseUrlState(window.location.search) : {};
    const savedSession = loadWorkspaceSession();

    let initialScene = getDemoPresetById('club-cardioid-pa').createScene();
    if (urlState.presetId && DEMO_VENUE_PRESETS.some((p) => p.id === urlState.presetId)) {
      this.activePresetId = urlState.presetId;
      initialScene = getDemoPresetById(urlState.presetId).createScene();
    } else if (savedSession) {
      initialScene = savedSession.scene;
      this.isSceneModified = true;
      if (savedSession.activePresetId) {
        this.activePresetId = savedSession.activePresetId;
      }
      this.layoutMode = savedSession.layoutMode;
      this.chartDrawerExpanded = savedSession.chartDrawerExpanded;
    }

    if (urlState.layoutMode) {
      this.layoutMode = urlState.layoutMode;
    }

    this.store = new ProjectStore(initialScene);
    if (
      savedSession?.colormap &&
      (!urlState.presetId || savedSession.activePresetId === urlState.presetId)
    ) {
      this.store.setColormap(savedSession.colormap);
    }
    if (urlState.bandSelection) {
      this.store.setBandSelection(urlState.bandSelection);
    }

    this.simController = new SimulationController(this.store);
  }

  public connectedCallback(): void {
    super.connectedCallback();

    this.unsubStore = this.store.subscribe((changeKind) => {
      this.storeRevision++;
      if (changeKind === 'scene' && !this.isLoadingPreset) {
        this.isSceneModified = true;
        this.hasUnsavedFileChanges = true;
      }
      if (changeKind === 'colormap' && !this.isLoadingPreset) {
        this.hasUnsavedFileChanges = true;
      }
      if (changeKind === 'scene' || changeKind === 'colormap') {
        this.scheduleAutosave();
      }
      if (changeKind === 'scene') {
        this.syncUrlBar();
      }
    });

    this.unsubSim = this.simController.subscribe((snap) => {
      this.snapshot = snap;
    });

    void this.hydrateIndexedDb();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubStore?.();
    this.unsubSim?.();
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.simController.dispose();
  }

  private handleKeyDown(ev: KeyboardEvent): void {
    dispatchAppShortcut(ev, {
      undo: () => this.store.undo(),
      redo: () => this.store.redo(),
      save: () => {
        void this.handleSaveProjectFile();
      },
      addPointSource: () => this.store.addPointSource(),
      addSubArray: () => this.store.addSubArray(),
      addVirtualMic: () => this.store.addVirtualMic(),
      toggleGroundReflection: () => {
        const g = this.store.scene.reflectors.find(
          (r) => r.id === DEFAULT_GROUND_REFLECTOR.id
        );
        this.store.setGroundReflection(!(g?.enabled ?? false));
      },
      setLayoutMode: (m) => this.setLayoutMode(m),
      openSpeakerLibrary: () => {
        this.speakerLibraryOpen = true;
      },
      openHelp: () => {
        this.helpModalOpen = !this.helpModalOpen;
      },
      onEscape: () => {
        if (hasOpenPopover(this.renderRoot)) {
          return;
        }
        if (this.helpModalOpen) {
          this.helpModalOpen = false;
        } else if (this.speakerLibraryOpen) {
          this.speakerLibraryOpen = false;
        } else if (this.projectsModalOpen) {
          this.projectsModalOpen = false;
        } else {
          this.store.setSelection(null);
        }
      },
    });
  }

  private async hydrateIndexedDb(): Promise<void> {
    const [speakers, projects, savedHandle] = await Promise.all([
      this.repository.listSpeakers(),
      this.repository.listProjects(),
      this.repository.loadActiveFileHandle().catch(() => null),
    ]);
    if (speakers.length > 0) {
      this.store.setCustomSpeakers(speakers);
    }
    this.savedProjects = projects;
    if (savedHandle) {
      this.activeFileHandle = savedHandle;
    }
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = setTimeout(() => {
      this.flushAutosave();
    }, 220);
  }

  private flushAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    saveWorkspaceSession({
      activePresetId: this.activePresetId,
      scene: this.store.scene,
      colormap: this.store.colormap,
      layoutMode: this.layoutMode,
      chartDrawerExpanded: this.chartDrawerExpanded,
    });
  }

  private syncUrlBar(): void {
    replaceBrowserUrlState({
      presetId: this.isSceneModified ? undefined : this.activePresetId,
      bandSelection: this.store.scene.bandSelection,
      layoutMode: this.layoutMode,
    });
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = '';
    }, 3200);
  }

  private setLayoutMode(mode: ViewportLayoutMode): void {
    this.layoutMode = mode;
    this.scheduleAutosave();
    this.syncUrlBar();
  }

  private handleSelectPreset(presetId: string): void {
    this.activePresetId = presetId;
    this.isSceneModified = false;
    this.hasUnsavedFileChanges = false;
    this.activeFileHandle = null;
    void this.repository.clearActiveFileHandle().catch(() => {});
    this.isLoadingPreset = true;
    try {
      this.store.loadPreset(presetId);
    } finally {
      this.isLoadingPreset = false;
    }
    this.syncUrlBar();
    this.scheduleAutosave();
    this.showToast(`Loaded venue preset: ${this.store.scene.name}`);
  }

  private async handleSaveProjectFile(): Promise<void> {
    if (this.activeFileHandle) {
      const res = await saveProjectToHandle(this.activeFileHandle, this.store);
      if (res.ok) {
        this.hasUnsavedFileChanges = false;
        this.flushAutosave();
        this.showToast(`Saved directly to "${res.fileName}".`);
        return;
      }
      if (res.reason === 'permission-denied') {
        this.showToast(res.message);
        return;
      }
    }
    await this.handleSaveProjectAs();
  }

  private async handleSaveProjectAs(): Promise<void> {
    try {
      const res = await saveProjectAsViaPicker(this.store, this.repository);
      if (res.kind === 'cancelled') return;
      if (res.kind === 'saved-handle') {
        this.activeFileHandle = res.handle;
        this.hasUnsavedFileChanges = false;
        this.flushAutosave();
        this.showToast(`Saved project to "${res.fileName}".`);
        return;
      }
      this.hasUnsavedFileChanges = false;
      this.showToast(`Exported "${res.fileName}".`);
    } catch (err) {
      this.showToast(
        `Project save failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleOpenProjectPickerOrFallback(): Promise<void> {
    try {
      const res = await openProjectViaFilePicker(this.store, this.repository);
      if (res.kind === 'cancelled') return;
      if (res.kind === 'opened') {
        this.activeFileHandle = res.handle;
        this.isSceneModified = true;
        this.hasUnsavedFileChanges = false;
        this.flushAutosave();
        this.showToast(`Opened "${res.handle.name}".`);
        return;
      }
    } catch (err) {
      this.showToast(
        `Project open failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    const inp = this.renderRoot.querySelector(
      '#project-file-input'
    ) as HTMLInputElement | null;
    inp?.click();
  }

  private async importProjectFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const importedScene = await importProjectBundleFile(file, this.store, this.repository);
      this.activeFileHandle = null;
      this.isSceneModified = true;
      this.hasUnsavedFileChanges = false;
      this.scheduleAutosave();
      this.showToast(`Imported project "${importedScene.name}".`);
    } catch (err) {
      this.showToast(
        `Project import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async saveCurrentProjectToDb(): Promise<void> {
    const { record, projects } = await saveSceneSnapshotToDb(this.store, this.repository);
    this.savedProjects = projects;
    this.showToast(`Saved "${record.name}" to browser library.`);
  }

  protected render() {
    void this.storeRevision;

    return html`
      <wss-topbar
        .store=${this.store}
        .snapshot=${this.snapshot}
        .activePresetId=${this.activePresetId}
        .layoutMode=${this.layoutMode}
        .chartDrawerExpanded=${this.chartDrawerExpanded}
        .wcoVisible=${this.shellWindow.wcoVisible}
        .updateReady=${this.shellWindow.swUpdateReady}
        .isSceneModified=${this.isSceneModified}
        .activeFileName=${this.activeFileHandle?.name ?? ''}
        .hasUnsavedFileChanges=${this.hasUnsavedFileChanges}
        .onSelectPreset=${(id: string) => this.handleSelectPreset(id)}
        .onOpenProjectsModal=${() => {
          this.projectsModalOpen = true;
        }}
        .onSaveSnapshot=${() => {
          void this.saveCurrentProjectToDb();
        }}
        .onSaveProjectFile=${() => {
          void this.handleSaveProjectFile();
        }}
        .onExportProjectJson=${() => {
          void this.handleSaveProjectAs();
        }}
        .onTriggerImportProjectJson=${() => {
          void this.handleOpenProjectPickerOrFallback();
        }}
        .onOpenSpeakerLibrary=${() => {
          this.speakerLibraryOpen = true;
        }}
        .onSetLayoutMode=${(m: ViewportLayoutMode) => this.setLayoutMode(m)}
        .onToggleChartDrawer=${() => {
          this.chartDrawerExpanded = !this.chartDrawerExpanded;
          this.scheduleAutosave();
        }}
        .onOpenHelp=${() => {
          this.helpModalOpen = true;
        }}
      ></wss-topbar>

      <input
        id="project-file-input"
        name="project-file-input"
        aria-label="Import Project Bundle JSON"
        data-testid="project-file-input"
        type="file"
        accept=".json"
        class="foh-sr-only"
        tabindex="-1"
        @change=${(ev: Event) => {
          const input = ev.target as HTMLInputElement;
          void this.importProjectFile(input.files?.[0]);
          input.value = '';
        }}
      />

      <main class="workspace">
        <div class="center-column">
          <div
            class="viewports-grid"
            data-layout=${this.layoutMode}
            @open-heatmap-popover=${() => {
              (this.renderRoot.querySelector('wss-topbar') as WssTopbar | null)?.openHeatmapPopover();
            }}
          >
            ${this.layoutMode !== 'section'
              ? html`
                  <wss-viewport-panel
                    data-testid="viewport-plan"
                    mode="plan"
                    .store=${this.store}
                    .snapshot=${this.snapshot}
                    .revision=${this.storeRevision}
                  ></wss-viewport-panel>
                `
              : ''}
            ${this.layoutMode !== 'plan'
              ? html`
                  <wss-viewport-panel
                    data-testid="viewport-section"
                    mode="section"
                    .store=${this.store}
                    .snapshot=${this.snapshot}
                    .revision=${this.storeRevision}
                  ></wss-viewport-panel>
                `
              : ''}
          </div>

          ${this.chartDrawerExpanded
            ? html`
                <div class="chart-drawer" data-testid="chart-drawer">
                  <wss-chart-panel
                    .store=${this.store}
                    .snapshot=${this.snapshot}
                    .revision=${this.storeRevision}
                  ></wss-chart-panel>
                </div>
              `
            : ''}
        </div>

        <aside class="right-dock">
          ${renderSceneSidebar(this.store)}
          <div class="inspector-pane" data-testid="inspector-pane">
            ${renderEntityInspector(this.store, this.snapshot, {
              refGroupId: this.alignRefGroupId,
              targetGroupId: this.alignTargetGroupId,
              alignFreqHz: this.alignFreqHz,
              onChange: (patch) => {
                if (patch.refGroupId !== undefined) this.alignRefGroupId = patch.refGroupId;
                if (patch.targetGroupId !== undefined)
                  this.alignTargetGroupId = patch.targetGroupId;
                if (patch.alignFreqHz !== undefined) this.alignFreqHz = patch.alignFreqHz;
              },
              onNotify: (msg) => this.showToast(msg),
            })}
          </div>
        </aside>
      </main>

      <wss-speaker-library-modal
        .open=${this.speakerLibraryOpen}
        .store=${this.store}
        .onSaveCustomSpeaker=${(spk: SpeakerDefinition) => {
          void this.repository.saveSpeaker(spk);
        }}
        .onDeleteCustomSpeaker=${(speakerId: string) => {
          void this.repository.deleteSpeaker(speakerId);
        }}
        @close-modal=${() => {
          this.speakerLibraryOpen = false;
        }}
      ></wss-speaker-library-modal>

      <wss-projects-modal
        .open=${this.projectsModalOpen}
        .sceneName=${this.store.scene.name}
        .savedProjects=${this.savedProjects}
        .onSaveCurrent=${() => {
          void this.saveCurrentProjectToDb();
        }}
        .onResetAutosave=${() => {
          clearWorkspaceSession();
          this.handleSelectPreset('club-cardioid-pa');
          this.projectsModalOpen = false;
        }}
        .onLoadProject=${(proj: SavedProjectRecord) => {
          this.activeFileHandle = null;
          void this.repository.clearActiveFileHandle().catch(() => {});
          this.store.setColormap(proj.colormap);
          this.store.replaceProject(proj.scene, true);
          this.hasUnsavedFileChanges = false;
          this.projectsModalOpen = false;
          this.showToast(`Loaded "${proj.name}".`);
        }}
        .onDeleteProject=${async (projectId: string) => {
          await this.repository.deleteProject(projectId);
          this.savedProjects = await this.repository.listProjects();
        }}
        @close-modal=${() => {
          this.projectsModalOpen = false;
        }}
      ></wss-projects-modal>

      <foh-help-modal
        .open=${this.helpModalOpen}
        .updateReady=${this.shellWindow.swUpdateReady}
        appName="WebSpeakerSim"
        .appSummary=${WSS_HELP_SUMMARY}
        .resources=${WSS_HELP_RESOURCES}
        .shortcuts=${WSS_HELP_SHORTCUTS}
        .attribution=${WSS_HELP_ATTRIBUTION}
        dialogTestId="help-modal"
        @apply-app-update=${() => this.shellWindow.applyServiceWorkerUpdate()}
        @close-modal=${() => {
          this.helpModalOpen = false;
        }}
      ></foh-help-modal>

      ${this.toastMessage &&
      !this.speakerLibraryOpen &&
      !this.projectsModalOpen &&
      !this.helpModalOpen
        ? html`<foh-toast
            data-testid="toast-banner"
            .message=${this.toastMessage}
            @dismiss-toast=${() => {
              this.toastMessage = '';
              if (this.toastTimer !== null) {
                clearTimeout(this.toastTimer);
                this.toastTimer = null;
              }
            }}
          ></foh-toast>`
        : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'web-speaker-sim-app': WebSpeakerSimApp;
  }
}
