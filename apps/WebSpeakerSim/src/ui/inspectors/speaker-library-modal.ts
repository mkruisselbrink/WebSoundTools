// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `<wss-speaker-library-modal>` Lit 3 modal combining Catalog, Datasheet Spec Builder,
 * and client-side `.gll` / `.clf` / `.frd` / `.csv` / `.json` Loudspeaker File Importer.
 */

import { fohControlsCss, fohTokensCss } from '@foh/ui';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  importSpeakerArrayBuffer,
  serializeSpeakerToJson,
} from '../../library/importers/index.js';
import type { SpeakerDefinition } from '../../library/speaker-schema.js';
import { buildSpeakerFromSpec } from '../../library/spec-builder.js';
import type { ProjectStore } from '../../model/project-store.js';
import { renderCatalogTab } from './catalog-tab.js';
import { renderImportTab } from './import-tab.js';
import { renderSpecBuilderTab, type SpecBuilderDraft } from './spec-builder-tab.js';

type LibraryModalTab = 'catalog' | 'spec-builder' | 'import';

@customElement('wss-speaker-library-modal')
export class WssSpeakerLibraryModal extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    css`
    :where(button, select, input, a, [tabindex]):focus-visible {
      outline: 2px solid #38bdf8;
      outline-offset: 2px;
    }

    .tabs {
      display: flex;
      gap: 6px;
      padding: 8px 14px;
      background: #090d16;
      border-bottom: 1px solid #1e293b;
    }

    .tab-btn {
      position: relative;
      font: inherit;
      background: #162033;
      color: #cbd5e1;
      border: 1px solid #263554;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
    }

    .tab-btn:is([aria-selected='true'], [data-active='true']) {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
    }

    .tab-btn:is([aria-selected='true'], [data-active='true'])::after {
      content: '';
      position: absolute;
      inset: auto 2px 0;
      border-block-end: 2px solid #e0f2fe;
    }

    .body {
      padding: 12px 14px;
      overflow-y: auto;
      flex: 1;
    }

    .spk-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .spk-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      background: #080d19;
      border: 1px solid #1e293b;
      border-radius: 6px;
    }

    .spk-meta {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .badge {
      display: inline-block;
      font-size: 9.5px;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      background: #162033;
      border: 1px solid #334155;
      color: #38bdf8;
      margin-left: 6px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field label {
      font-size: 11px;
      color: #cbd5e1;
    }

    input,
    select {
      background-color: #090d16;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 5px 8px;
      font-size: 12px;
    }

    select {
      padding-inline-end: 26px;
    }

    .dropzone {
      border: 2px dashed #334155;
      border-radius: 8px;
      padding: 26px 16px;
      text-align: center;
      background: #080d19;
      cursor: pointer;
      margin-bottom: 12px;
    }

    .dropzone:hover,
    .dropzone[data-drag='true'] {
      border-color: #38bdf8;
      background: rgba(2, 132, 199, 0.08);
    }

    .btn {
      background: #162033;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 11.5px;
      cursor: pointer;
    }

    .btn-primary {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
      font-weight: 600;
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.16);
      border-color: rgba(239, 68, 68, 0.5);
      color: #fca5a5;
    }

    .status {
      margin-top: 10px;
      padding: 7px 10px;
      border-radius: 5px;
      background: #0f172a;
      border: 1px solid #38bdf8;
      font-size: 11.5px;
    }
    `,
  ];

  @property({ type: Boolean })
  public open = false;

  @property({ attribute: false })
  public store!: ProjectStore;

  @property({ attribute: false })
  public onSaveCustomSpeaker?: (spk: SpeakerDefinition) => void;

  @property({ attribute: false })
  public onDeleteCustomSpeaker?: (speakerId: string) => void;

  @state()
  private activeTab: LibraryModalTab = 'catalog';

  @state()
  private statusMessage = '';

  @state()
  private dragActive = false;

  @state()
  private specDraft: SpecBuilderDraft = {
    name: 'Custom 12" 90×50 Top',
    manufacturer: 'Custom Spec',
    category: 'point-source',
    hDeg: 90,
    vDeg: 50,
    lowHz: 55,
    highHz: 19000,
    maxSplDb: 132,
    lfPattern: 'omni',
  };

  @state() private frdHDeg = 90;
  @state() private frdVDeg = 60;
  @state() private frdMaxSplDb = 131;

  private close(): void {
    this.statusMessage = '';
    this.dispatchEvent(new CustomEvent('close-modal', { bubbles: true, composed: true }));
  }

  private createFromSpecBuilder(): void {
    const d = this.specDraft;
    const spk = buildSpeakerFromSpec({
      name: d.name.trim() || 'Custom Spec Loudspeaker',
      manufacturer: d.manufacturer.trim() || 'Custom Spec',
      category: d.category,
      horizontalDispersionDeg: d.category === 'subwoofer' ? 360 : d.hDeg,
      verticalDispersionDeg: d.category === 'subwoofer' ? 360 : d.vDeg,
      low3dBHz: d.lowHz,
      high3dBHz: d.highHz,
      maxContinuousSpl1mDb: d.maxSplDb,
      lfPattern: d.lfPattern,
    });
    this.store.upsertCustomSpeaker(spk);
    this.onSaveCustomSpeaker?.(spk);
    this.statusMessage = `Added "${spk.name}" to Loudspeaker Library.`;
    this.activeTab = 'catalog';
  }

  private async handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    let importedCount = 0;
    const names: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const buffer = await file.arrayBuffer();
        const parsedList = await importSpeakerArrayBuffer(file.name, buffer, {
          horizontalDispersionDeg: this.frdHDeg,
          verticalDispersionDeg: this.frdVDeg,
          maxContinuousSpl1mDb: this.frdMaxSplDb,
        });
        for (const spk of parsedList) {
          this.store.upsertCustomSpeaker(spk);
          this.onSaveCustomSpeaker?.(spk);
          importedCount++;
          names.push(spk.name);
        }
      } catch (err) {
        this.statusMessage = `Import error (${file.name}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        return;
      }
    }

    if (importedCount > 0) {
      this.statusMessage = `Imported ${importedCount} loudspeaker(s): ${names.join(', ')}`;
      this.activeTab = 'catalog';
    }
  }

  private exportSpeakerJson(spk: SpeakerDefinition): void {
    const json = serializeSpeakerToJson(spk);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${spk.id}.wss-speaker.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected render() {
    if (!this.open || !this.store) return html``;
    const allSpeakers = this.store.getAllSpeakers();

    return html`
      <foh-modal
        .open=${this.open}
        modalTitle="Loudspeaker Library, Spec Builder & File Importer"
        maxWidth="700px"
        dialogTestId="speaker-library-modal"
        closeButtonTestId="btn-close-library-modal"
        @close-modal=${() => this.close()}
      >
        <div
          class="tabs"
          slot="subheader"
          role="tablist"
          focusgroup="tablist nomemory"
          aria-label="Loudspeaker library sections"
          @keydown=${(ev: KeyboardEvent) => {
            if (typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype) {
              return;
            }
            const order: readonly LibraryModalTab[] = ['catalog', 'spec-builder', 'import'];
            const idx = order.indexOf(this.activeTab);
            let next = -1;
            if (ev.key === 'ArrowRight') next = (idx + 1) % order.length;
            else if (ev.key === 'ArrowLeft') next = (idx - 1 + order.length) % order.length;
            else if (ev.key === 'Home') next = 0;
            else if (ev.key === 'End') next = order.length - 1;
            if (next < 0) return;
            ev.preventDefault();
            this.activeTab = order[next];
            void this.updateComplete.then(() => {
              this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            });
          }}
        >
          <button
            type="button"
            role="tab"
            id="spk-lib-tab-catalog"
            class="tab-btn"
            data-testid="tab-catalog"
            aria-selected=${String(this.activeTab === 'catalog')}
            data-active=${String(this.activeTab === 'catalog')}
            ?focusgroupstart=${this.activeTab === 'catalog'}
            tabindex=${this.activeTab === 'catalog' ? '0' : '-1'}
            @click=${() => (this.activeTab = 'catalog')}
          >
            Catalog (${allSpeakers.length})
          </button>
          <button
            type="button"
            role="tab"
            id="spk-lib-tab-spec-builder"
            class="tab-btn"
            data-testid="tab-spec-builder"
            aria-selected=${String(this.activeTab === 'spec-builder')}
            data-active=${String(this.activeTab === 'spec-builder')}
            ?focusgroupstart=${this.activeTab === 'spec-builder'}
            tabindex=${this.activeTab === 'spec-builder' ? '0' : '-1'}
            @click=${() => (this.activeTab = 'spec-builder')}
          >
            Datasheet Spec Builder
          </button>
          <button
            type="button"
            role="tab"
            id="spk-lib-tab-import"
            class="tab-btn"
            data-testid="tab-import-file"
            aria-selected=${String(this.activeTab === 'import')}
            data-active=${String(this.activeTab === 'import')}
            ?focusgroupstart=${this.activeTab === 'import'}
            tabindex=${this.activeTab === 'import' ? '0' : '-1'}
            @click=${() => (this.activeTab = 'import')}
          >
            Import .gll / .clf / .frd / .json
          </button>
        </div>

        <div
          class="body"
          role="tabpanel"
          aria-labelledby="spk-lib-tab-${this.activeTab}"
        >
          ${this.activeTab === 'catalog'
            ? renderCatalogTab({
                allSpeakers,
                onExportJson: (spk) => this.exportSpeakerJson(spk),
                onDeleteCustom: (speakerId) => {
                  this.store.removeCustomSpeaker(speakerId);
                  this.onDeleteCustomSpeaker?.(speakerId);
                },
              })
            : this.activeTab === 'spec-builder'
              ? renderSpecBuilderTab({
                  draft: this.specDraft,
                  onPatchDraft: (patch) => {
                    this.specDraft = { ...this.specDraft, ...patch };
                  },
                  onCreate: () => this.createFromSpecBuilder(),
                })
              : renderImportTab({
                  dragActive: this.dragActive,
                  frdHDeg: this.frdHDeg,
                  frdVDeg: this.frdVDeg,
                  onSetDragActive: (active) => {
                    this.dragActive = active;
                  },
                  onBrowseClick: () => {
                    const input = this.renderRoot.querySelector(
                      '#speaker-file-input'
                    ) as HTMLInputElement | null;
                    input?.click();
                  },
                  onFilesSelected: (files) => {
                    void this.handleFiles(files);
                  },
                  onPatchFallbackDispersion: (patch) => {
                    if (patch.frdHDeg !== undefined) this.frdHDeg = patch.frdHDeg;
                    if (patch.frdVDeg !== undefined) this.frdVDeg = patch.frdVDeg;
                  },
                })}

          ${this.statusMessage ? html`<div class="status">${this.statusMessage}</div>` : ''}
        </div>
      </foh-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-speaker-library-modal': WssSpeakerLibraryModal;
  }
}
