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

import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('web-speaker-sim-app')
export class WebSpeakerSimApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      background: #060911;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      overflow: hidden;
      box-sizing: border-box;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
    }

    .brand {
      font-weight: 700;
      font-size: 14px;
      color: #38bdf8;
      letter-spacing: 0.02em;
    }

    .workspace {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 13px;
    }
  `;

  render() {
    return html`
      <header class="topbar">
        <div class="brand">WebSpeakerSim</div>
      </header>
      <main class="workspace">
        Acoustic simulation engine initialized.
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'web-speaker-sim-app': WebSpeakerSimApp;
  }
}
