// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * CSS color parsing and colormap LUT interpolation utilities for WebGL2 and 2D Canvas renderers.
 */

export type RgbaFloatTuple = [number, number, number, number];

export interface ColorStopRgb {
  readonly t: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const DEFAULT_FALLBACK_RGBA: RgbaFloatTuple = [0.22, 0.74, 0.97, 1.0];

/**
 * Parses hex (`#rgb`, `#rrggbb`, `#rrggbbaa`) or `rgb()` / `rgba()` strings into normalized `[0..1]` RGBA floats.
 */
export function parseCssColorToRgba(
  cssColor: string,
  fallback: RgbaFloatTuple = DEFAULT_FALLBACK_RGBA
): RgbaFloatTuple {
  const trimmed = cssColor.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return [r / 255, g / 255, b / 255, 1.0];
      }
    } else if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1.0;
      if (
        !Number.isNaN(r) &&
        !Number.isNaN(g) &&
        !Number.isNaN(b) &&
        !Number.isNaN(a)
      ) {
        return [r / 255, g / 255, b / 255, Math.max(0, Math.min(1, a))];
      }
    }
    return [...fallback];
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(
    trimmed
  );
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1]))) / 255;
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2]))) / 255;
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3]))) / 255;
    const a =
      rgbMatch[4] !== undefined
        ? Math.max(0, Math.min(1, Number(rgbMatch[4])))
        : 1.0;
    return [r, g, b, a];
  }

  return [...fallback];
}

/**
 * Evaluates 8-bit `[R, G, B]` at normalized position `t` in `[0, 1]` along piecewise-linear stops.
 */
export function evaluateColorStopsRgb(
  stops: readonly ColorStopRgb[],
  t: number
): [number, number, number] {
  if (stops.length === 0) return [56, 189, 248];
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= stops[0].t) {
    return [stops[0].r, stops[0].g, stops[0].b];
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped <= b.t) {
      const frac = (clamped - a.t) / Math.max(1e-6, b.t - a.t);
      return [
        Math.round(a.r + (b.r - a.r) * frac),
        Math.round(a.g + (b.g - a.g) * frac),
        Math.round(a.b + (b.b - a.b) * frac),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

/**
 * Packs a 1D RGBA8 lookup table (`size * 4` bytes) from piecewise-linear RGB stops.
 */
export function buildRgbaLutBytes(
  stops: readonly ColorStopRgb[],
  size: number = 256
): Uint8Array {
  const count = Math.max(2, Math.floor(size));
  const bytes = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = evaluateColorStopsRgb(stops, i / (count - 1));
    bytes[i * 4] = r;
    bytes[i * 4 + 1] = g;
    bytes[i * 4 + 2] = b;
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}
