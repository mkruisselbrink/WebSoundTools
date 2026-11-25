// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `<wss-topbar>` custom element encapsulating the single-row 3-zone toolbar,
 * `@container topbar` responsive geometry, and `#wss-scene-popover` /
 * `#wss-heatmap-popover` native popovers within a dedicated Shadow Root.
 */

import {
  StoreSubscriptionController,
  fohControlsCss,
  fohPanelsCss,
  fohTokensCss,
  fohTopbarCss,
  toggleAnchoredPopover,
} from '@foh/ui';
import { LitElement, css, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ProjectStore } from '../../model/project-store.js';
import type { ViewportLayoutMode } from '../../model/url-state.js';
import type { SimulationSnapshot } from '../../physics/sim-controller.js';
import { renderTopbar } from './topbar-view.js';

@customElement('wss-topbar')
export class WssTopbar extends LitElement {
  static styles = [
    fohTokensCss,
    fohControlsCss,
    fohPanelsCss,
    fohTopbarCss,
    css`
      :host {
        display: block;
        flex-shrink: 0;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .wss-scene-pill {
        max-inline-size: 196px;
      }

      .wss-band-select {
        inline-size: 164px;
      }

      .wss-bounce-btn {
        inline-size: 68px;
      }

      .wss-heatmap-btn {
        inline-size: 112px;
      }

      .wss-palette-swatch {
        inline-size: 11px;
        block-size: 11px;
        border-radius: 2.5px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        flex-shrink: 0;
      }

      .wss-popover-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-top: 6px;
        border-top: 1px solid var(--_foh-border-subtle, #1e293b);
      }

      .wss-sim-time {
        font-family: var(--_foh-font-mono, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 10.5px;
        color: var(--_foh-text-muted, #94a3b8);
      }

      @container topbar (max-width: 1079px) {
        .wss-scene-pill {
          max-inline-size: 148px;
        }
        .wss-band-select {
          inline-size: 132px;
        }
      }

      @container topbar (max-width: 819px) {
        .wss-scene-pill {
          max-inline-size: 112px;
        }
        .wss-band-select {
          inline-size: 112px;
        }
        .wss-bounce-btn {
          inline-size: 30px;
        }
        .wss-heatmap-btn {
          inline-size: 40px;
        }
      }
    `,
  ];

  @property({ attribute: false }) public store!: ProjectStore;
  @property({ attribute: false }) public snapshot: SimulationSnapshot | null = null;
  @property({ type: String }) public activePresetId = 'club-cardioid-pa';
  @property({ type: String }) public layoutMode: ViewportLayoutMode = 'split';
  @property({ type: Boolean }) public chartDrawerExpanded = true;
  @property({ type: Boolean }) public wcoVisible = false;
  @property({ type: Boolean }) public isSceneModified = false;

  @property({ attribute: false }) public onSelectPreset: (presetId: string) => void = () => {};
  @property({ attribute: false }) public onOpenProjectsModal: () => void = () => {};
  @property({ attribute: false }) public onSaveSnapshot?: () => void;
  @property({ attribute: false }) public onExportProjectJson: () => void = () => {};
  @property({ attribute: false }) public onTriggerImportProjectJson: () => void = () => {};
  @property({ attribute: false }) public onOpenSpeakerLibrary: () => void = () => {};
  @property({ attribute: false }) public onSetLayoutMode: (mode: ViewportLayoutMode) => void =
    () => {};
  @property({ attribute: false }) public onToggleChartDrawer: () => void = () => {};
  @property({ attribute: false }) public onOpenHelp: () => void = () => {};

  protected readonly storeSub = new StoreSubscriptionController(this, null);

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('store')) {
      this.storeSub.setSource(this.store ?? null);
    }
  }

  /**
   * Programmatically opens `#wss-heatmap-popover` anchored to its trigger button
   * (invoked when the user clicks the SPL legend bar on `<wss-viewport-panel>`).
   */
  public openHeatmapPopover(): void {
    const trigger = this.renderRoot.querySelector(
      '[data-popover-trigger="wss-heatmap-popover"]'
    ) as HTMLElement | null;
    const pop = this.renderRoot.querySelector('#wss-heatmap-popover') as HTMLElement | null;
    toggleAnchoredPopover(trigger, pop, true);
  }

  protected render() {
    if (!this.store) return nothing;
    return renderTopbar(
      this.store,
      this.snapshot,
      this.activePresetId,
      this.layoutMode,
      this.chartDrawerExpanded,
      {
        wcoVisible: this.wcoVisible,
        isSceneModified: this.isSceneModified,
        popoverRoot: this.renderRoot,
        onSelectPreset: this.onSelectPreset,
        onOpenProjectsModal: this.onOpenProjectsModal,
        onSaveSnapshot: this.onSaveSnapshot,
        onExportProjectJson: this.onExportProjectJson,
        onTriggerImportProjectJson: this.onTriggerImportProjectJson,
        onOpenSpeakerLibrary: this.onOpenSpeakerLibrary,
        onSetLayoutMode: this.onSetLayoutMode,
        onToggleChartDrawer: this.onToggleChartDrawer,
        onOpenHelp: this.onOpenHelp,
      }
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wss-topbar': WssTopbar;
  }
}
