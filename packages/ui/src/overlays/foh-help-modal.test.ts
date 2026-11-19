// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  FOH_GITHUB_ISSUES_URL,
  FOH_GITHUB_REPO_URL,
  FOH_GITHUB_TUTORIALS_URL,
  FohHelpModal,
  renderGithubMarkSvg,
  resolveHelpCommitLink,
} from './foh-help-modal.js';

describe('foh-help-modal', () => {
  it('exposes canonical GitHub repository, issues, and tutorials URLs and registers FohHelpModal', () => {
    expect(FOH_GITHUB_REPO_URL).toBe('https://github.com/mkruisselbrink/WebSoundTools');
    expect(FOH_GITHUB_ISSUES_URL).toBe(
      'https://github.com/mkruisselbrink/WebSoundTools/issues'
    );
    expect(FOH_GITHUB_TUTORIALS_URL).toContain('/docs/tutorials/README.md');

    const modal = new FohHelpModal();
    expect(modal.open).toBe(false);
    expect(modal.dialogTestId).toBe('help-modal');

    const stylesText = FohHelpModal.styles.map((s) => s.toString()).join('\n');
    expect(stylesText).toContain('.resource-card');
    expect(stylesText).toContain('.shortcut-table');
    expect(stylesText).toContain('.commit-link');
    expect(stylesText).toContain('focus-visible');

    const svgTpl = renderGithubMarkSvg();
    expect(svgTpl.strings.join('')).toContain('aria-hidden="true"');
  });

  it('resolves deployed hexadecimal git commit SHAs to GitHub commit links and omits empty/invalid values', () => {
    expect(resolveHelpCommitLink(undefined)).toBeNull();
    expect(resolveHelpCommitLink('')).toBeNull();
    expect(resolveHelpCommitLink('   ')).toBeNull();
    expect(resolveHelpCommitLink('not-a-sha!')).toBeNull();
    expect(resolveHelpCommitLink('123456')).toBeNull();

    const fullSha = 'DF48C8B1A2B3C4D5E6F708192A3B4C5D6E7F8091';
    const resolved = resolveHelpCommitLink(fullSha);
    expect(resolved).toEqual({
      sha: fullSha.toLowerCase(),
      shortSha: 'df48c8b1',
      href: `https://github.com/mkruisselbrink/WebSoundTools/commit/${fullSha.toLowerCase()}`,
    });
  });
});

