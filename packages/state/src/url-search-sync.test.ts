// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { formatQueryString, parseSearchParams } from './url-search-sync.js';

describe('url-search-sync', () => {
  it('parses leading-? search strings and formats clean query strings', () => {
    const params = parseSearchParams('?layout=tf-dual&mode=hardware');
    expect(params.get('layout')).toBe('tf-dual');
    expect(params.get('mode')).toBe('hardware');
    expect(formatQueryString(params)).toBe('?layout=tf-dual&mode=hardware');
    expect(formatQueryString(new URLSearchParams())).toBe('');
  });
});
