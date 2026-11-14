// Copyright (C) 2026 WebSpeakerSim Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * SPL colormap configuration, contour settings, and adaptive audience-anchored range resolver.
 */

export type ColormapPaletteId = 'turbo' | 'inferno' | 'viridis';

export type ColormapRangeMode = 'auto-6' | 'auto-12' | 'auto-21' | 'auto-36' | 'manual';

export type IsolineStepDb = 0 | 1 | 2 | 3 | 6;

export interface ColormapConfig {
  readonly palette: ColormapPaletteId;
  readonly rangeMode: ColormapRangeMode;
  readonly stepped: boolean;
  readonly minSplDb: number;
  readonly maxSplDb: number;
  readonly isolineStepDb: IsolineStepDb;
  readonly showOutsideSurfaces: boolean;
}

export const DEFAULT_COLORMAP_CONFIG: ColormapConfig = {
  palette: 'turbo',
  rangeMode: 'auto-21',
  stepped: false,
  minSplDb: 84,
  maxSplDb: 114,
  isolineStepDb: 3,
  showOutsideSurfaces: true,
};

/**
 * Resolves the effective `[minSplDb, maxSplDb]` display window from `ColormapConfig`
 * and the latest audience coverage statistics.
 */
export function resolveEffectiveSplRange(
  colormap: ColormapConfig,
  stats?: {
    readonly audienceSampleCount: number;
    readonly meanAudienceSplDb: number;
    readonly maxAudienceSplDb: number;
  } | null
): { readonly minSplDb: number; readonly maxSplDb: number } {
  if (
    colormap.rangeMode === 'manual' ||
    !stats ||
    stats.audienceSampleCount <= 0 ||
    !Number.isFinite(stats.meanAudienceSplDb)
  ) {
    const lo = colormap.minSplDb;
    const hi = Math.max(lo + 2, colormap.maxSplDb);
    return { minSplDb: lo, maxSplDb: hi };
  }

  const mean = Math.round(stats.meanAudienceSplDb * 2) / 2;
  const peak = Math.round(stats.maxAudienceSplDb * 2) / 2;

  switch (colormap.rangeMode) {
    case 'auto-6':
      return { minSplDb: mean - 3, maxSplDb: mean + 3 };
    case 'auto-12':
      return { minSplDb: mean - 6, maxSplDb: mean + 6 };
    case 'auto-21': {
      const top = Math.max(mean + 3, peak + 1.5);
      return { minSplDb: top - 21, maxSplDb: top };
    }
    case 'auto-36': {
      const top = Math.max(mean + 3, peak + 1.5);
      return { minSplDb: top - 36, maxSplDb: top };
    }
  }
}
