/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
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

/**
 * Root application shell `<web-speaker-sim-app>` (`src/ui/app-shell.ts`).
 */

import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '../charts/chart-panel.js';
import { DEMO_VENUE_PRESETS, getDemoPresetById } from '../library/demo-presets.js';
import type { SpeakerDefinition } from '../library/speaker-schema.js';
import { ProjectStore } from '../model/project-store.js';
import {
  SessionStorageRepository,
  deserializeProjectBundle,
  serializeProjectBundle,
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
import { renderEntityInspector } from './inspectors/entity-inspectors.js';
import './inspectors/speaker-library-modal.js';
import { dispatchAppShortcut } from './keyboard-shortcuts.js';
import { renderSceneSidebar } from './sidebar/sidebar-view.js';
import { renderTopbar } from './topbar/topbar-view.js';

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
  @state() private savedProjects: SavedProjectRecord[] = [];
  @state() private toastMessage = '';

  // Alignment UI state for Virtual Mic inspector
  @state() private alignRefGroupId = '';
  @state() private alignTargetGroupId = '';
  @state() private alignFreqHz = 80;

  // Counter incremented on store notifications to trigger Lit re-render
  @state() private storeRevision = 0;

  private isSceneModified = false;
  private isLoadingPreset = false;
  private unsubStore: (() => void) | null = null;
  private unsubSim: (() => void) | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onKeyDownBound = (ev: KeyboardEvent) => {
    dispatchAppShortcut(ev, {
      undo: () => this.store.undo(),
      redo: () => this.store.redo(),
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
      onEscape: () => {
        if (this.speakerLibraryOpen) {
          this.speakerLibraryOpen = false;
        } else if (this.projectsModalOpen) {
          this.projectsModalOpen = false;
        } else {
          this.store.setSelection(null);
        }
      },
    });
  };

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
    if (savedSession?.colormap && !urlState.presetId) {
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

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDownBound);
    }

    void this.hydrateIndexedDb();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubStore?.();
    this.unsubSim?.();
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDownBound);
    }
    this.simController.dispose();
  }

  private async hydrateIndexedDb(): Promise<void> {
    const [speakers, projects] = await Promise.all([
      this.repository.listSpeakers(),
      this.repository.listProjects(),
    ]);
    if (speakers.length > 0) {
      this.store.setCustomSpeakers(speakers);
    }
    this.savedProjects = projects;
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      saveWorkspaceSession({
        activePresetId: this.activePresetId,
        scene: this.store.scene,
        colormap: this.store.colormap,
        layoutMode: this.layoutMode,
        chartDrawerExpanded: this.chartDrawerExpanded,
      });
    }, 220);
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

  private exportProjectBundle(): void {
    const json = serializeProjectBundle(
      this.store.scene,
      this.store.colormap,
      this.store.getCustomSpeakers()
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeSlug =
      this.store.scene.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'project';
    a.download = `${safeSlug}.wss-project.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Exported .wss-project.json bundle.');
  }

  private async importProjectFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = deserializeProjectBundle(text);
      for (const spk of bundle.customSpeakers) {
        this.store.upsertCustomSpeaker(spk);
        await this.repository.saveSpeaker(spk);
      }
      this.store.setColormap(bundle.colormap);
      this.store.replaceProject(bundle.scene, true);
      this.scheduleAutosave();
      this.showToast(`Imported project "${bundle.scene.name}".`);
    } catch (err) {
      this.showToast(
        `Project import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async saveCurrentProjectToDb(): Promise<void> {
    const scene = this.store.scene;
    const record: SavedProjectRecord = {
      id: scene.id.startsWith('proj-') ? scene.id : `proj-${Date.now().toString(36)}`,
      name: scene.name,
      updatedAtIso: new Date().toISOString(),
      scene: {
        ...scene,
        id: scene.id.startsWith('proj-') ? scene.id : `proj-${Date.now().toString(36)}`,
      },
      colormap: this.store.colormap,
    };
    await this.repository.saveProject(record);
    this.savedProjects = await this.repository.listProjects();
    this.showToast(`Saved "${record.name}" to browser library.`);
  }

  protected render() {
    // Reference `storeRevision` so Lit tracks store mutations
    void this.storeRevision;

    return html`
      ${renderTopbar(
        this.store,
        this.snapshot,
        this.activePresetId,
        this.layoutMode,
        this.chartDrawerExpanded,
        {
          onSelectPreset: (id) => this.handleSelectPreset(id),
          onOpenProjectsModal: () => {
            this.projectsModalOpen = true;
          },
          onExportProjectJson: () => this.exportProjectBundle(),
          onTriggerImportProjectJson: () => {
            const inp = this.renderRoot.querySelector(
              '#project-file-input'
            ) as HTMLInputElement | null;
            inp?.click();
          },
          onOpenSpeakerLibrary: () => {
            this.speakerLibraryOpen = true;
          },
          onSetLayoutMode: (m) => this.setLayoutMode(m),
          onToggleChartDrawer: () => {
            this.chartDrawerExpanded = !this.chartDrawerExpanded;
            this.scheduleAutosave();
          },
        }
      )}

      <input
        id="project-file-input"
        data-testid="project-file-input"
        type="file"
        accept=".json"
        style="display:none"
        @change=${(ev: Event) => {
          const input = ev.target as HTMLInputElement;
          void this.importProjectFile(input.files?.[0]);
          input.value = '';
        }}
      />

      <main class="workspace">
        <div class="center-column">
          <div class="viewports-grid" data-layout=${this.layoutMode}>
            ${this.layoutMode !== 'section'
              ? html`
                  <wss-viewport-panel
                    data-testid="viewport-plan"
                    mode="plan"
                    .store=${this.store}
                    .snapshot=${this.snapshot}
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

      ${this.projectsModalOpen ? this.renderProjectsModal() : ''}
      ${this.toastMessage
        ? html`<div class="toast-banner" data-testid="toast-banner">${this.toastMessage}</div>`
        : ''}
    `;
  }

  private renderProjectsModal() {
    return html`
      <div
        class="modal-backdrop"
        data-testid="projects-modal"
        @click=${(ev: MouseEvent) => {
          if (ev.target === ev.currentTarget) this.projectsModalOpen = false;
        }}
      >
        <div class="modal-card">
          <div class="modal-head">
            <span>Saved Browser Projects (IndexedDB)</span>
            <button class="btn" @click=${() => (this.projectsModalOpen = false)}>Close</button>
          </div>
          <div class="modal-body">
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
              <button
                class="btn btn-primary"
                data-testid="btn-save-project-db"
                @click=${() => void this.saveCurrentProjectToDb()}
              >
                Save Current Scene ("${this.store.scene.name}")
              </button>
              <button
                class="btn btn-danger"
                @click=${() => {
                  clearWorkspaceSession();
                  this.handleSelectPreset('club-cardioid-pa');
                  this.projectsModalOpen = false;
                }}
              >
                Reset Local Autosave
              </button>
            </div>

            ${this.savedProjects.length === 0
              ? html`<div style="color:var(--text-muted)">
                  No projects saved in IndexedDB yet.
                </div>`
              : html`
                  <div style="display:flex;flex-direction:column;gap:6px">
                    ${this.savedProjects.map(
                      (proj) => html`
                        <div
                          style="display:flex;align-items:center;justify-content:space-between;padding:7px 9px;background:#080d19;border:1px solid var(--border-subtle);border-radius:5px"
                        >
                          <div>
                            <strong>${proj.name}</strong>
                            <div style="font-size:10.5px;color:var(--text-muted)">
                              Updated: ${proj.updatedAtIso.slice(0, 19).replace('T', ' ')}
                            </div>
                          </div>
                          <div style="display:flex;gap:6px">
                            <button
                              class="btn btn-primary"
                              data-testid="btn-load-proj-${proj.id}"
                              @click=${() => {
                                this.store.setColormap(proj.colormap);
                                this.store.replaceProject(proj.scene, true);
                                this.projectsModalOpen = false;
                                this.showToast(`Loaded "${proj.name}".`);
                              }}
                            >
                              Load
                            </button>
                            <button
                              class="btn btn-danger"
                              @click=${async () => {
                                await this.repository.deleteProject(proj.id);
                                this.savedProjects = await this.repository.listProjects();
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      `
                    )}
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'web-speaker-sim-app': WebSpeakerSimApp;
  }
}
