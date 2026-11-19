// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WSM_TEST_IDS } from './test-ids.js';

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('WSM_TEST_IDS sync with UI templates', () => {
  it('ensures every static WSM_TEST_IDS constant exists in WebSoundMeter src templates', () => {
    const srcRoot = path.resolve(import.meta.dirname, '..');
    const allCode = collectTsFiles(srcRoot)
      .filter((f) => path.basename(f) !== 'test-ids.ts')
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');

    const missing = Object.entries(WSM_TEST_IDS)
      .filter(([, id]) => !allCode.includes(id))
      .map(([key, id]) => `${key}: "${id}"`);

    expect(missing).toEqual([]);
  });
});

