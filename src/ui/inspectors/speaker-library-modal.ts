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
 * `<wss-speaker-library-modal>` Lit 3 modal (`src/ui/inspectors/speaker-library-modal.ts`)
 * providing:
 *   1. Built-in + Custom/Imported Loudspeaker Catalog browser (with JSON export & delete)
 *   2. Datasheet Spec Builder (synthesize calibrated 3D directivity balloons from specs)
 *   3. Client-side `.gll`, `.clf`, `.frd`/`.csv`, and `.json` Loudspeaker File Importer
 */

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  importSpeakerArrayBuffer,
  serializeSpeakerToJson,
} from '../../library/importers/index.js';
import type { SpeakerCategory, SpeakerDefinition } from '../../library/speaker-schema.js';
import { buildSpeakerFromSpec } from '../../library/spec-builder.js';
import type { ProjectStore } from '../../model/project-store.js';

type LibraryModalTab = 'catalog' | 'spec-builder' | 'import';

@customElement('wss-speaker-library-modal')
export class WssSpeakerLibraryModal extends LitElement {
  static styles = css`
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(3, 6, 12, 0.78);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 120;
      padding: 16px;
    }

    .dialog {
      width: min(700px, 96vw);
      max-height: 88vh;
      background: #0b1120;
      border: 1px solid #334155;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #f8fafc;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
      font-size: 12px;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
    }

    .head-title {
      font-weight: 700;
      font-size: 13.5px;
    }

    .tabs {
      display: flex;
      gap: 6px;
      padding: 8px 14px;
      background: #090d16;
      border-bottom: 1px solid #1e293b;
    }

    .tab-btn {
      background: #162033;
      color: #cbd5e1;
      border: 1px solid #263554;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11.5px;
      cursor: pointer;
    }

    .tab-btn[data-active='true'] {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
      font-weight: 600;
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
      background: #090d16;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 5px 8px;
      font-size: 12px;
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
  `;

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

  // Spec Builder fields
  @state() private specName = 'Custom 12" 90×50 Top';
  @state() private specManufacturer = 'Custom Spec';
  @state() private specCategory: SpeakerCategory = 'point-source';
  @state() private specHDeg = 90;
  @state() private specVDeg = 50;
  @state() private specLowHz = 55;
  @state() private specHighHz = 19000;
  @state() private specMaxSplDb = 132;
  @state() private specLfPattern: 'omni' | 'cardioid' = 'omni';

  // FRD fallback options
  @state() private frdHDeg = 90;
  @state() private frdVDeg = 60;
  @state() private frdMaxSplDb = 131;

  private close(): void {
    this.statusMessage = '';
    this.dispatchEvent(new CustomEvent('close-modal', { bubbles: true, composed: true }));
  }

  private createFromSpecBuilder(): void {
    const spk = buildSpeakerFromSpec({
      name: this.specName.trim() || 'Custom Spec Loudspeaker',
      manufacturer: this.specManufacturer.trim() || 'Custom Spec',
      category: this.specCategory,
      horizontalDispersionDeg: this.specCategory === 'subwoofer' ? 360 : this.specHDeg,
      verticalDispersionDeg: this.specCategory === 'subwoofer' ? 360 : this.specVDeg,
      low3dBHz: this.specLowHz,
      high3dBHz: this.specHighHz,
      maxContinuousSpl1mDb: this.specMaxSplDb,
      lfPattern: this.specLfPattern,
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
      <div
        class="backdrop"
        data-testid="speaker-library-modal"
        @click=${(ev: MouseEvent) => {
          if (ev.target === ev.currentTarget) this.close();
        }}
      >
        <div class="dialog">
          <div class="head">
            <span class="head-title">Loudspeaker Library, Spec Builder & File Importer</span>
            <button class="btn" data-testid="btn-close-library-modal" @click=${() => this.close()}>
              Close
            </button>
          </div>

          <div class="tabs">
            <button
              class="tab-btn"
              data-testid="tab-catalog"
              data-active=${String(this.activeTab === 'catalog')}
              @click=${() => (this.activeTab = 'catalog')}
            >
              Catalog (${allSpeakers.length})
            </button>
            <button
              class="tab-btn"
              data-testid="tab-spec-builder"
              data-active=${String(this.activeTab === 'spec-builder')}
              @click=${() => (this.activeTab = 'spec-builder')}
            >
              Datasheet Spec Builder
            </button>
            <button
              class="tab-btn"
              data-testid="tab-import-file"
              data-active=${String(this.activeTab === 'import')}
              @click=${() => (this.activeTab = 'import')}
            >
              Import .gll / .clf / .frd / .json
            </button>
          </div>

          <div class="body">
            ${this.activeTab === 'catalog'
              ? html`
                  <div class="spk-list" data-testid="catalog-speaker-list">
                    ${allSpeakers.map(
                      (spk) => html`
                        <div class="spk-card" data-testid="catalog-item-${spk.id}">
                          <div>
                            <div>
                              <strong>${spk.name}</strong>
                              <span style="color:#94a3b8"> — ${spk.manufacturer}</span>
                              <span class="badge">${spk.origin}</span>
                              <span class="badge">${spk.category}</span>
                            </div>
                            <div class="spk-meta">
                              ${spk.nominalDispersionDeg.horizontal}°×${spk.nominalDispersionDeg
                                .vertical}°
                              · ${spk.passbandHz.low3dB}–${spk.passbandHz.high3dB} Hz · Max 1m:
                              ${spk.maxContinuousSpl1mDb} dB SPL
                            </div>
                          </div>
                          <div style="display:flex;gap:6px">
                            <button class="btn" @click=${() => this.exportSpeakerJson(spk)}>
                              JSON
                            </button>
                            ${spk.origin !== 'builtin'
                              ? html`
                                  <button
                                    class="btn btn-danger"
                                    data-testid="btn-delete-speaker-${spk.id}"
                                    @click=${() => {
                                      this.store.removeCustomSpeaker(spk.id);
                                      this.onDeleteCustomSpeaker?.(spk.id);
                                    }}
                                  >
                                    Delete
                                  </button>
                                `
                              : ''}
                          </div>
                        </div>
                      `
                    )}
                  </div>
                `
              : this.activeTab === 'spec-builder'
                ? html`
                    <div class="form-grid" data-testid="spec-builder-form">
                      <div class="field">
                        <label>Model Name</label>
                        <input
                          type="text"
                          data-testid="spec-name-input"
                          .value=${this.specName}
                          @input=${(ev: Event) =>
                            (this.specName = (ev.target as HTMLInputElement).value)}
                        />
                      </div>
                      <div class="field">
                        <label>Manufacturer / Series</label>
                        <input
                          type="text"
                          .value=${this.specManufacturer}
                          @input=${(ev: Event) =>
                            (this.specManufacturer = (ev.target as HTMLInputElement).value)}
                        />
                      </div>
                      <div class="field">
                        <label>Enclosure Category</label>
                        <select
                          data-testid="spec-category-select"
                          .value=${this.specCategory}
                          @change=${(ev: Event) => {
                            const cat = (ev.target as HTMLSelectElement).value as SpeakerCategory;
                            this.specCategory = cat;
                            if (cat === 'subwoofer') {
                              this.specLowHz = 34;
                              this.specHighHz = 110;
                            } else {
                              this.specLowHz = 55;
                              this.specHighHz = 19000;
                            }
                          }}
                        >
                          <option value="point-source">Point-Source Top / Fill</option>
                          <option value="subwoofer">Subwoofer Enclosure</option>
                        </select>
                      </div>
                      <div class="field">
                        <label>LF Enclosure Radiation</label>
                        <select
                          .value=${this.specLfPattern}
                          @change=${(ev: Event) =>
                            (this.specLfPattern = (ev.target as HTMLSelectElement).value as
                              | 'omni'
                              | 'cardioid')}
                        >
                          <option value="omni">Standard Omnidirectional LF</option>
                          <option value="cardioid">Intrinsic Cardioid Enclosure</option>
                        </select>
                      </div>

                      ${this.specCategory === 'point-source'
                        ? html`
                            <div class="field">
                              <label>Horizontal Dispersion -6 dB (°)</label>
                              <input
                                type="number"
                                min="30"
                                max="160"
                                step="5"
                                data-testid="spec-h-deg"
                                .value=${String(this.specHDeg)}
                                @input=${(ev: Event) =>
                                  (this.specHDeg = Number((ev.target as HTMLInputElement).value))}
                              />
                            </div>
                            <div class="field">
                              <label>Vertical Dispersion -6 dB (°)</label>
                              <input
                                type="number"
                                min="20"
                                max="140"
                                step="5"
                                data-testid="spec-v-deg"
                                .value=${String(this.specVDeg)}
                                @input=${(ev: Event) =>
                                  (this.specVDeg = Number((ev.target as HTMLInputElement).value))}
                              />
                            </div>
                          `
                        : ''}

                      <div class="field">
                        <label>Low -3 dB Cutoff (Hz)</label>
                        <input
                          type="number"
                          min="20"
                          max="500"
                          .value=${String(this.specLowHz)}
                          @input=${(ev: Event) =>
                            (this.specLowHz = Number((ev.target as HTMLInputElement).value))}
                        />
                      </div>
                      <div class="field">
                        <label>High -3 dB Cutoff (Hz)</label>
                        <input
                          type="number"
                          min="60"
                          max="22000"
                          .value=${String(this.specHighHz)}
                          @input=${(ev: Event) =>
                            (this.specHighHz = Number((ev.target as HTMLInputElement).value))}
                        />
                      </div>
                      <div class="field">
                        <label>Max Continuous SPL @ 1 m (dB)</label>
                        <input
                          type="number"
                          min="95"
                          max="150"
                          step="0.5"
                          data-testid="spec-max-spl"
                          .value=${String(this.specMaxSplDb)}
                          @input=${(ev: Event) =>
                            (this.specMaxSplDb = Number((ev.target as HTMLInputElement).value))}
                        />
                      </div>
                    </div>

                    <div style="margin-top:14px;display:flex;justify-content:flex-end">
                      <button
                        class="btn btn-primary"
                        data-testid="btn-create-spec-speaker"
                        @click=${() => this.createFromSpecBuilder()}
                      >
                        Synthesize 3D Balloon & Add to Library
                      </button>
                    </div>
                  `
                : html`
                    <div
                      class="dropzone"
                      data-drag=${String(this.dragActive)}
                      @dragover=${(ev: DragEvent) => {
                        ev.preventDefault();
                        this.dragActive = true;
                      }}
                      @dragleave=${() => (this.dragActive = false)}
                      @drop=${(ev: DragEvent) => {
                        ev.preventDefault();
                        this.dragActive = false;
                        void this.handleFiles(ev.dataTransfer?.files ?? null);
                      }}
                      @click=${() => {
                        const input = this.renderRoot.querySelector(
                          '#speaker-file-input'
                        ) as HTMLInputElement | null;
                        input?.click();
                      }}
                    >
                      <div style="font-weight:600;font-size:13px;margin-bottom:4px">
                        Drop loudspeaker files here or click to browse
                      </div>
                      <div style="color:#94a3b8;font-size:11px">
                        Supports binary <code>.gll</code> (e.g. manufacturer GLL files), polar text
                        <code>.clf</code>, measured curves <code>.frd</code> / <code>.csv</code>,
                        and <code>.json</code> speaker definitions.
                      </div>
                      <input
                        id="speaker-file-input"
                        data-testid="speaker-file-input"
                        type="file"
                        multiple
                        accept=".gll,.clf,.tab,.frd,.csv,.txt,.json"
                        style="display:none"
                        @change=${(ev: Event) => {
                          const input = ev.target as HTMLInputElement;
                          void this.handleFiles(input.files);
                          input.value = '';
                        }}
                      />
                    </div>

                    <div class="form-grid">
                      <div class="field">
                        <label>.frd/.csv Nominal Horizontal (°)</label>
                        <input
                          type="number"
                          .value=${String(this.frdHDeg)}
                          @input=${(ev: Event) =>
                            (this.frdHDeg = Number((ev.target as HTMLInputElement).value))}
                        />
                      </div>
                      <div class="field">
                        <label>.frd/.csv Nominal Vertical (°)</label>
                        <input
                          type="number"
                          .value=${String(this.frdVDeg)}
                          @input=${(ev: Event) =>
                            (this.frdVDeg = Number((ev.target as HTMLInputElement).value))}
                        />
                      </div>
                    </div>
                  `}

            ${this.statusMessage ? html`<div class="status">${this.statusMessage}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-speaker-library-modal': WssSpeakerLibraryModal;
  }
}
