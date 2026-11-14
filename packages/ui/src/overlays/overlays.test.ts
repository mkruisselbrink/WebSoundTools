// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { FohModal } from './foh-modal.js';
import { FohToast } from './foh-toast.js';

describe('foh-modal and foh-toast', () => {
  it('defines FohModal and FohToast Lit custom elements with expected defaults', () => {
    expect(typeof FohModal).toBe('function');
    expect(typeof FohToast).toBe('function');
    const modal = new FohModal();
    expect(modal.open).toBe(false);
    expect(modal.maxWidth).toBe('580px');

    const toast = new FohToast();
    expect(toast.message).toBe('');
  });
});
