// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { TemplateResult } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import { renderEntityTreeSection } from './entity-tree.js';

describe('entity-tree', () => {
  it('renders keyboard-selectable entity button rows alongside checkbox or button toggles', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();

    const tpl = renderEntityTreeSection({
      title: 'Sources (2)',
      listTestId: 'source-list',
      items: [
        {
          id: 'live-1',
          title: 'FOH Mic',
          selected: true,
          color: '#38bdf8',
          badge: 'measurement',
          testId: 'source-item-live-1',
          toggle: {
            kind: 'checkbox',
            active: true,
            ariaLabel: 'Toggle visibility for FOH Mic',
            onToggle,
          },
          onSelect,
        },
        {
          id: 'ps-1',
          title: 'Main L/R',
          selected: false,
          color: '#22c55e',
          badge: 'L/R',
          testId: 'tree-ps-1',
          toggle: {
            kind: 'button',
            active: false,
            activeLabel: 'On',
            inactiveLabel: 'Muted',
            dangerWhenInactive: true,
            onToggle,
          },
          onSelect,
        },
      ],
    });
    const rowTemplates = tpl.values[2] as TemplateResult[];
    expect(rowTemplates).toHaveLength(2);
    expect(rowTemplates[0].strings.join('')).toContain('foh-tree-row-select');
    expect(rowTemplates[0].strings.join('')).toContain('aria-pressed=');
  });
});
