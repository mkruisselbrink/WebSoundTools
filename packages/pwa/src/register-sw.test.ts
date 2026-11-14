// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { registerOfflineServiceWorker } from './register-sw.js';

describe('registerOfflineServiceWorker', () => {
  it('registers the Service Worker safely and handles unsupported or failing environments', async () => {
    const registerSpy = vi.fn().mockResolvedValue({});
    expect(await registerOfflineServiceWorker({ register: registerSpy }, '/sw.js')).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    expect(await registerOfflineServiceWorker(undefined)).toBe(false);
    const failingSpy = vi.fn().mockRejectedValue(new Error('SW blocked'));
    expect(await registerOfflineServiceWorker({ register: failingSpy })).toBe(false);
  });
});
