// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  renderAudioInterfaceIconSvg,
  renderChevronDownSvg,
  renderGroundBounceIconSvg,
  renderHelpQuestionSvg,
  renderMeterWaveIconSvg,
  renderPauseIconSvg,
  renderPlayIconSvg,
  renderRedoIconSvg,
  renderSineWaveIconSvg,
  renderSlidersIconSvg,
  renderSpeakerCabinetIconSvg,
  renderUndoIconSvg,
  renderWsmAppMarkSvg,
  renderWssAppMarkSvg,
} from './foh-icons.js';

describe('foh-icons SVG templates', () => {
  it('marks all decorative icons aria-hidden="true" and avoids circular brand dots', () => {
    const all = [
      renderWsmAppMarkSvg(),
      renderWssAppMarkSvg(),
      renderChevronDownSvg(),
      renderUndoIconSvg(),
      renderRedoIconSvg(),
      renderPlayIconSvg(),
      renderPauseIconSvg(),
      renderSlidersIconSvg(),
      renderMeterWaveIconSvg(),
      renderAudioInterfaceIconSvg(),
      renderSineWaveIconSvg(),
      renderSpeakerCabinetIconSvg(),
      renderGroundBounceIconSvg(),
      renderHelpQuestionSvg(),
    ];

    for (const tpl of all) {
      const joined = tpl.strings.join('');
      expect(joined).toContain('aria-hidden="true"');
      expect(joined).toContain('<svg');
    }

    // Both app marks use rounded-square <rect rx="5"> frames rather than circular dots
    expect(renderWsmAppMarkSvg().strings.join('')).toContain('rx="5"');
    expect(renderWssAppMarkSvg().strings.join('')).toContain('rx="5"');
  });
});
