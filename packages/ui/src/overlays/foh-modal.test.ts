// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { FohModal } from './foh-modal.js';
import { FohToast } from './foh-toast.js';

describe('foh-modal & foh-toast', () => {
  it('defines FohModal and FohToast with dark color-scheme and native <dialog> / popover styles', () => {
    const modalCss = FohModal.styles.map((s) => s.toString()).join('\n');
    expect(modalCss).toContain('color-scheme: dark');
    expect(modalCss).toContain('dialog[open]');
    expect(modalCss).toContain('overscroll-behavior: contain');
    expect(modalCss).toContain('dialog::backdrop');

    const toastCss = FohToast.styles.map((s) => s.toString()).join('\n');
    expect(toastCss).toContain(':popover-open');
    expect(toastCss).toContain('focus-visible');
  });
});

