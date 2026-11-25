// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { downloadTextFile, slugifyFilename } from './download-file.js';

describe('download-file utilities', () => {
  it('slugifyFilename produces clean kebab-case filenames and falls back when empty', () => {
    expect(slugifyFilename('FOH Main PA (Cap #1)')).toBe('foh-main-pa-cap-1');
    expect(slugifyFilename('   ---   ', 'trace')).toBe('trace');
    // No-op safely in Node when document/createObjectURL are absent
    expect(() => downloadTextFile('test', 'out.txt')).not.toThrow();
  });
});
