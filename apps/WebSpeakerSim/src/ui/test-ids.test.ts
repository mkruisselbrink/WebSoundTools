// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_VENUE_PRESETS, PRESET_ENTITY_IDS } from '../library/demo-presets.js';
import { WSS_TEST_IDS } from './test-ids.js';

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

describe('WSS_TEST_IDS and PRESET_ENTITY_IDS sync with UI & presets', () => {
  it('ensures every static WSS_TEST_IDS constant exists in WebSpeakerSim src templates', () => {
    const srcRoot = path.resolve(import.meta.dirname, '..');
    const allCode = collectTsFiles(srcRoot)
      .filter((f) => path.basename(f) !== 'test-ids.ts')
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');

    const missing = Object.entries(WSS_TEST_IDS)
      .filter(([, id]) => !allCode.includes(id))
      .map(([key, id]) => `${key}: "${id}"`);

    expect(missing).toEqual([]);
  });

  it('ensures PRESET_ENTITY_IDS matches all entity IDs across DEMO_VENUE_PRESETS', () => {
    const scenes = DEMO_VENUE_PRESETS.map((p) => p.createScene());
    const uniq = (vals: string[]) => Array.from(new Set(vals)).sort();

    expect(uniq([...PRESET_ENTITY_IDS.pointSources])).toEqual(
      uniq(scenes.flatMap((s) => s.pointSources.map((x) => x.id)))
    );
    expect(uniq([...PRESET_ENTITY_IDS.subArrays])).toEqual(
      uniq(scenes.flatMap((s) => s.subArrays.map((x) => x.id)))
    );
    expect(uniq([...PRESET_ENTITY_IDS.dspGroups])).toEqual(
      uniq(scenes.flatMap((s) => s.dspGroups.map((x) => x.id)))
    );
    expect(uniq([...PRESET_ENTITY_IDS.surfaces])).toEqual(
      uniq(scenes.flatMap((s) => s.surfaces.map((x) => x.id)))
    );
    expect(uniq([...PRESET_ENTITY_IDS.virtualMics])).toEqual(
      uniq(scenes.flatMap((s) => s.virtualMics.map((x) => x.id)))
    );
  });
});

