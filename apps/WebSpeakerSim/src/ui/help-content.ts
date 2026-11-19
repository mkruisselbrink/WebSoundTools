// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  FOH_GITHUB_ISSUES_URL,
  FOH_GITHUB_REPO_URL,
  FOH_GITHUB_TUTORIALS_URL,
  type HelpResourceLink,
  type HelpShortcutItem,
} from '@foh/ui';

export const WSS_USER_GUIDE_URL = `${FOH_GITHUB_REPO_URL}/blob/main/apps/WebSpeakerSim/docs/user-guide.md`;

export const WSS_HELP_SUMMARY =
  'Synchronized 2D Plan & Side Section venue simulator over a 3D direct-field + ground-reflection acoustic solver, point-source & cardioid/end-fire/arc subwoofer modeling, .gll/.clf/.frd importers, and Virtual Mic .frd target export.';

export const WSS_HELP_ATTRIBUTION =
  'GLL binary container importer adapted from gll-tools (MIT) by Christian-W. Budde.';

export const WSS_HELP_RESOURCES: readonly HelpResourceLink[] = [
  {
    title: 'User & Inspector Guide',
    description:
      'Complete reference for 3D venue coordinates, colormaps, CAD gestures, sub-array modes, and loudspeaker importers.',
    href: WSS_USER_GUIDE_URL,
  },
  {
    title: 'Step-by-Step FOH Tutorials',
    description:
      'Illustrated walkthroughs for club/balcony/festival prediction, cardioid & end-fire sub arrays, and Predict-to-Measure.',
    href: FOH_GITHUB_TUTORIALS_URL,
  },
  {
    title: 'Report a Bug / Request Feature',
    description:
      'File an issue, report loudspeaker file import quirks, or suggest features on GitHub Issues.',
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

export const WSS_HELP_SHORTCUTS: readonly HelpShortcutItem[] = [
  { keys: 'P', action: 'Add Point-Source Loudspeaker (+ Top)' },
  { keys: 'S', action: 'Add Subwoofer Array (+ Sub)' },
  { keys: 'M', action: 'Add Virtual Measurement Microphone (+ Mic)' },
  { keys: 'G', action: 'Toggle 1st-Order Ground Reflection' },
  { keys: 'L', action: 'Open Loudspeaker Library, Spec Builder & Importer' },
  { keys: '1 / 2 / 3', action: 'Switch Viewport Layout (Split / Plan / Section)' },
  { keys: 'Cmd / Ctrl + Z', action: 'Undo last scene or colormap edit' },
  { keys: 'Cmd / Ctrl + Shift + Z', action: 'Redo scene or colormap edit' },
  { keys: '?', action: 'Open or close this Help & Shortcuts dialog' },
  { keys: 'Escape', action: 'Close open modal or clear active selection' },
];

