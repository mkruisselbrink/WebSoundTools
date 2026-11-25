// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  FOH_GITHUB_ISSUES_URL,
  FOH_GITHUB_REPO_URL,
  FOH_GITHUB_TUTORIALS_URL,
  type HelpResourceLink,
  type HelpShortcutItem,
} from '@foh/ui';

export const WSM_USER_GUIDE_URL = `${FOH_GITHUB_REPO_URL}/blob/main/apps/WebSoundMeter/docs/user-guide.md`;

export const WSM_HELP_SUMMARY =
  'Multi-channel dual-FFT acoustic analyzer for transfer function, phase, coherence, impulse response, virtual crossover & parametric EQ modeling, and Live Show SPL compliance + feedback watch.';

export const WSM_HELP_ATTRIBUTION =
  'Inspired by Open Sound Meter (OSM) by Pavel Smokotnin.';

export const WSM_HELP_RESOURCES: readonly HelpResourceLink[] = [
  {
    title: 'User & Controls Guide',
    description:
      'Complete reference for topbar routing, plot modes, virtual EQ, math operations, and Show SPL compliance.',
    href: WSM_USER_GUIDE_URL,
  },
  {
    title: 'Step-by-Step FOH Tutorials',
    description:
      'Illustrated walkthroughs for audio interface cabling, mic calibration, PA time alignment, and feedback ring-out.',
    href: FOH_GITHUB_TUTORIALS_URL,
  },
  {
    title: 'Report a Bug / Request Feature',
    description:
      'File an issue, report audio hardware or browser quirks, or request features on GitHub Issues.',
    href: FOH_GITHUB_ISSUES_URL,
    testId: 'help-link-issues',
  },
  {
    title: 'GitHub Source Repository',
    description:
      'Browse, fork, or self-host the WebSoundTools TypeScript monorepo (GPL-3.0-or-later).',
    href: FOH_GITHUB_REPO_URL,
    testId: 'help-link-source',
  },
];

export const WSM_HELP_SHORTCUTS: readonly HelpShortcutItem[] = [
  { keys: 'Space', action: 'Pause / Resume live measurement and signal generator' },
  {
    keys: 'Shift + Space',
    action: 'Disconnect hardware audio & release OS microphone (keeps routing)',
  },
  { keys: 'C', action: 'Capture current active trace to Stored Traces' },
  { keys: 'D', action: 'Find & Apply estimated propagation delay on active measurement' },
  { keys: 'M', action: 'Add a new simultaneous Live Measurement slot (+ Meas)' },
  { keys: 'E', action: 'Create a Virtual Parametric EQ source (+ EQ, Tuning mode)' },
  { keys: 'U', action: 'Create a Math / Union source (+ Math, Tuning mode)' },
  { keys: 'R', action: 'Reset averaging buffers and peak-hold accumulators' },
  { keys: '1 / 2 / 3', action: 'Switch between 1, 2, or 3 stacked chart panels' },
  { keys: 'Cmd / Ctrl + Z', action: 'Undo last Stored Trace, Virtual EQ, or Math Union edit' },
  { keys: 'Cmd / Ctrl + Shift + Z', action: 'Redo authored edit' },
  { keys: '?', action: 'Open or close this Help & Shortcuts dialog' },
  { keys: 'Escape', action: 'Close dialog, collapse Advanced Settings, or focus active slot' },
];

