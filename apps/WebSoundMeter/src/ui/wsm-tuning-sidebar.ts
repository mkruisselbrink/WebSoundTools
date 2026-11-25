// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  StoreSubscriptionController,
  fohControlsCss,
  fohPanelsCss,
  fohPopoverCss,
  fohTokensCss,
} from '@foh/ui';
import { LitElement, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { isLiveSourceId, type SourceChangeKind, type SourceStore } from '../sources/source-store.js';
import type { AudioSessionController } from './controllers/audio-session-controller.js';
import type { MixerWatchController } from './controllers/mixer-watch-controller.js';
import { renderSourceInspector } from './inspectors/index.js';
import { renderSidebar } from './sidebar-view.js';
import { wsmShowAndRingLogCss } from './styles/show-cards.css.js';
import type { WorkspaceLayoutController } from './workspace-store.js';

@customElement('wsm-tuning-sidebar')
export class WsmTuningSidebar extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    fohPanelsCss,
    fohPopoverCss,
    wsmShowAndRingLogCss,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        min-height: 0;
        box-sizing: border-box;
      }

      * {
        box-sizing: border-box;
      }

      .sidebar {
        width: 340px;
        flex: 1;
        min-height: 0;
        background: var(--_foh-bg-header, #0f172a);
        border-left: 1px solid var(--_foh-border-subtle, #1e293b);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 10px;
      }

      @media (max-width: 980px) {
        .sidebar {
          width: 280px;
        }
      }

      .dbfs-meter-strip {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 5px;
        font-family: var(--_foh-font-mono, monospace);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }

      .dbfs-meter-row {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 58px 34px;
        align-items: center;
        gap: 6px;
      }

      .dbfs-meter-label {
        color: #94a3b8;
        font-weight: 600;
      }

      .dbfs-meter-track {
        position: relative;
        height: 6px;
        background: #1e293b;
        border-radius: 3px;
        overflow: hidden;
      }

      .dbfs-meter-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.08s linear;
      }

      .dbfs-meter-peak {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: #f8fafc;
        opacity: 0.85;
      }

      .dbfs-meter-val {
        text-align: right;
        color: #cbd5e1;
      }

      .dbfs-clip-badge {
        text-align: center;
        padding: 0 3px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 700;
        background: #1e293b;
        color: #475569;
      }

      .dbfs-clip-badge.clip {
        background: rgba(239, 68, 68, 0.25);
        border: 1px solid #ef4444;
        color: #f87171;
      }

      .union-source-checklist {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 160px;
        overflow-y: auto;
        padding: 4px 6px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 4px;
      }

      .union-check-row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #e2e8f0;
        cursor: pointer;
        min-width: 0;
      }
    `,
  ];

  @property({ attribute: false })
  public audio: AudioSessionController | null = null;

  @property({ attribute: false })
  public workspace: WorkspaceLayoutController | null = null;

  @property({ attribute: false })
  public sources: SourceStore | null = null;

  @property({ attribute: false })
  public mixerWatch: MixerWatchController | null = null;

  @state()
  private showAdvanced = false;

  private readonly audioSub = new StoreSubscriptionController(this, null);
  private readonly workspaceSub = new StoreSubscriptionController(this, null);
  private readonly mixerSub = new StoreSubscriptionController(this, null);
  private readonly sourcesSub = new StoreSubscriptionController<
    unknown,
    [SourceChangeKind]
  >(this, null, {
    // Skip 25 Hz 'live' frame re-renders when inspecting a static Stored/EQ/Union source
    // and Mixer Watch ring log is inactive!
    shouldProcess: (kind) => {
      if (kind !== 'live') return true;
      const sel = this.sources?.getSelectedSourceId() ?? 'live-measurement';
      return (
        isLiveSourceId(sel) ||
        Boolean(this.mixerWatch?.config.enabled) ||
        (this.sources?.getFeedbackRingLog().length ?? 0) > 0
      );
    },
  });

  /** Collapses Advanced Measurement Settings on Escape; returns `true` if it was open. */
  public collapseAdvancedIfOpen(): boolean {
    if (!this.showAdvanced) return false;
    this.showAdvanced = false;
    return true;
  }

  protected willUpdate(): void {
    this.audioSub.setSource(this.audio);
    this.workspaceSub.setSource(this.workspace);
    this.mixerSub.setSource(this.mixerWatch);
    this.sourcesSub.setSource(this.sources);
  }

  protected render() {
    if (!this.audio || !this.workspace || !this.sources || !this.mixerWatch || !this.audio.engine) {
      return nothing;
    }

    const allSources = this.sources.getAllSources();
    const inspectorContent = renderSourceInspector({
      allSources,
      sources: this.sources,
      audio: this.audio,
      workspace: this.workspace,
      mixerWatch: this.mixerWatch,
      popoverRoot: this.renderRoot,
      showAdvanced: this.showAdvanced,
      onToggleAdvanced: () => {
        this.showAdvanced = !this.showAdvanced;
      },
    });

    return renderSidebar({
      allSources,
      selectedSourceId: this.sources.getSelectedSourceId(),
      inspectorContent,
      feedbackRingLog: this.sources.getFeedbackRingLog(),
      showTuningRingLog: this.mixerWatch.config.enabled,
      onApplyFeedbackNotch: (track) => {
        this.sources?.applyFeedbackNotchToEq(track);
        this.audio?.persistState('none');
      },
      onClearFeedbackRingLog: () => {
        this.sources?.clearFeedbackRingLog();
      },
      onAddLiveSource: this.audio.addLiveSlot,
      onAddEqSource: () => {
        this.sources?.addVirtualEqSource();
        this.audio?.persistState('replace');
      },
      onAddUnionSource: () => {
        this.sources?.addUnionSource();
        this.audio?.persistState('replace');
      },
      onImportFrdFile: (file: File) => {
        void file.text().then((text) => {
          try {
            this.sources?.importFrdStoredSource(text, file.name);
            this.audio?.persistState('replace');
          } catch {
            // Ignore malformed .frd uploads
          }
        });
      },
      onSelectSource: (id) => {
        this.sources?.setSelectedSourceId(id);
        this.audio?.persistState('replace');
      },
      onToggleSourceVisibility: (id, vis) => {
        this.audio?.toggleSourceVisibility(id, vis);
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wsm-tuning-sidebar': WsmTuningSidebar;
  }
}
