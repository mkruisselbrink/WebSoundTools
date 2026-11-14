// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@foh/ui',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
