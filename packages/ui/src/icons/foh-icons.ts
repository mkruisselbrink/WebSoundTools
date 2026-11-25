// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared decorative SVG iconography (`aria-hidden="true"`, `currentColor` strokes) and
 * rounded-square browser app marks for `@foh/ui` application headers and toolbars.
 */

import { svg, type SVGTemplateResult } from 'lit';

export function renderWsmAppMarkSvg(): SVGTemplateResult {
  return svg`<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="22" height="22" rx="5" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
    <path
      d="M3.5 13.2 C 6 13.2, 7.4 7.6, 10 9.1 C 12.6 10.6, 14 15.6, 16.6 12 C 18.6 9.2, 20 10.6, 20.5 11.6"
      fill="none"
      stroke="#38bdf8"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="10" cy="9.1" r="1.6" fill="#060911" stroke="#38bdf8" stroke-width="1.2" />
    <circle cx="16.6" cy="12" r="1.6" fill="#060911" stroke="#10b981" stroke-width="1.2" />
  </svg>`;
}

export function renderWssAppMarkSvg(): SVGTemplateResult {
  return svg`<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="22" height="22" rx="5" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
    <polygon
      points="4.2,9.5 6.8,9.5 9.4,7.4 9.4,16.6 6.8,14.5 4.2,14.5"
      fill="#1e293b"
      stroke="#38bdf8"
      stroke-width="1.3"
      stroke-linejoin="round"
    />
    <path d="M12.4 8.6 A 5 5 0 0 1 12.4 15.4" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" />
    <path d="M15.7 6.6 A 8 8 0 0 1 15.7 17.4" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" />
    <path d="M19 4.8 A 11 11 0 0 1 19 19.2" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" />
  </svg>`;
}

export function renderChevronDownSvg(): SVGTemplateResult {
  return svg`<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true" focusable="false">
    <path d="M1.5 1.25L5 4.75L8.5 1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function renderUndoIconSvg(): SVGTemplateResult {
  return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M6 3.5L2.5 7L6 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M3 7H10C12.2 7 13.75 8.55 13.75 10.6C13.75 12.1 12.8 13.2 11.4 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>`;
}

export function renderRedoIconSvg(): SVGTemplateResult {
  return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M10 3.5L13.5 7L10 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M13 7H6C3.8 7 2.25 8.55 2.25 10.6C2.25 12.1 3.2 13.2 4.6 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>`;
}

export function renderPlayIconSvg(): SVGTemplateResult {
  return svg`<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M2.5 1.8L10 6L2.5 10.2V1.8Z" />
  </svg>`;
}

export function renderPauseIconSvg(): SVGTemplateResult {
  return svg`<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="2.2" y="2" width="2.7" height="8" rx="0.7" />
    <rect x="7.1" y="2" width="2.7" height="8" rx="0.7" />
  </svg>`;
}

export function renderStopSquareIconSvg(): SVGTemplateResult {
  return svg`<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.2" />
  </svg>`;
}

export function renderSlidersIconSvg(): SVGTemplateResult {
  return svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <circle cx="6" cy="4" r="1.8" fill="currentColor" />
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <circle cx="11" cy="8" r="1.8" fill="currentColor" />
    <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <circle cx="7.5" cy="12" r="1.8" fill="currentColor" />
  </svg>`;
}

export function renderMeterWaveIconSvg(): SVGTemplateResult {
  return svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M1.5 9.5H4L5.8 4L8.2 12.5L10.4 6.5L12 9.5H14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function renderAudioInterfaceIconSvg(): SVGTemplateResult {
  return svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <rect x="1.5" y="4" width="13" height="8" rx="1.8" stroke="currentColor" stroke-width="1.4" />
    <circle cx="5" cy="8" r="1.3" fill="currentColor" />
    <circle cx="8.5" cy="8" r="1.3" fill="currentColor" />
    <line x1="11.5" y1="6.8" x2="12.8" y2="6.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <line x1="11.5" y1="9.2" x2="12.8" y2="9.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  </svg>`;
}

export function renderSineWaveIconSvg(): SVGTemplateResult {
  return svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M1.5 8C3.2 3, 5.8 3, 8 8C10.2 13, 12.8 13, 14.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>`;
}

export function renderSpeakerCabinetIconSvg(): SVGTemplateResult {
  return svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <rect x="3" y="1.5" width="10" height="13" rx="1.6" stroke="currentColor" stroke-width="1.4" />
    <circle cx="8" cy="5.2" r="1.2" fill="currentColor" />
    <circle cx="8" cy="10.3" r="2.3" stroke="currentColor" stroke-width="1.3" />
  </svg>`;
}

export function renderGroundBounceIconSvg(): SVGTemplateResult {
  return svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <line x1="1.5" y1="13" x2="14.5" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <path d="M2.5 4.5L8 11.5L13.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    <polyline points="10.8,4.5 13.5,4.5 13.5,7.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function renderHelpQuestionSvg(): SVGTemplateResult {
  return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4" />
    <path d="M6.3 6.2C6.5 5.1 7.4 4.6 8.3 4.7C9.2 4.8 9.9 5.5 9.8 6.4C9.7 7.3 8.6 7.6 8.1 8.3C7.95 8.5 7.9 8.8 7.9 9.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <circle cx="8" cy="11.5" r="0.85" fill="currentColor" />
  </svg>`;
}
