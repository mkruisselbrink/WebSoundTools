// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Semantic `[data-doc-region]` bounding-box cropper and Top-Layer (`popover="manual"`)
 * SVG + pill callout annotation renderer for Retina documentation screenshots.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type {
  AnnotationPlacement,
  AnnotationTone,
  MarkdownScreenshotSpec,
  ScreenshotPadding,
} from './screenshot-spec.ts';

interface RectBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ResolvedPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface ResolvedAnnotationPayload {
  readonly badge?: string;
  readonly label?: string;
  readonly placement: AnnotationPlacement;
  readonly tone: AnnotationTone;
  readonly box: RectBox;
}

const OVERLAY_ID = '__wst-doc-annotations';

function normalizePadding(padding: ScreenshotPadding | undefined): ResolvedPadding {
  if (padding === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: padding.top ?? 0,
    right: padding.right ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
  };
}

async function resolveRegionsClip(
  page: Page,
  spec: MarkdownScreenshotSpec,
  viewport: { readonly width: number; readonly height: number }
): Promise<RectBox | null> {
  if (!spec.regions || spec.regions.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const region of spec.regions) {
    const loc = page.locator(`[data-doc-region="${region}"]`).first();
    let box = await loc.boundingBox();
    if (
      !box ||
      box.y < 0 ||
      box.y + box.height > viewport.height + 2 ||
      box.x < 0 ||
      box.x + box.width > viewport.width + 2
    ) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      box = await loc.boundingBox();
    }
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(
        `Screenshot "${path.basename(spec.outputAbsPath)}" (scene "${spec.scene}"): [data-doc-region="${region}"] is not visible`
      );
    }
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  const pad = normalizePadding(spec.padding);
  const x0 = Math.max(0, Math.floor(minX - pad.left));
  const y0 = Math.max(0, Math.floor(minY - pad.top));
  const x1 = Math.min(viewport.width, Math.ceil(maxX + pad.right));
  const y1 = Math.min(viewport.height, Math.ceil(maxY + pad.bottom));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);

  if (x0 === 0 && y0 === 0 && width === viewport.width && height === viewport.height) {
    return null;
  }

  return { x: x0, y: y0, width, height };
}

async function resolveAnnotations(
  page: Page,
  spec: MarkdownScreenshotSpec,
  bounds: RectBox
): Promise<ResolvedAnnotationPayload[]> {
  const out: ResolvedAnnotationPayload[] = [];

  for (const ann of spec.annotations) {
    const loc = page.locator(ann.target).nth(ann.nth ?? 0);
    let rawBox = await loc.boundingBox();
    if (!rawBox) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      rawBox = await loc.boundingBox();
    }
    if (!rawBox || rawBox.width <= 0 || rawBox.height <= 0) {
      throw new Error(
        `Screenshot "${path.basename(spec.outputAbsPath)}" (scene "${spec.scene}"): annotation target "${ann.target}" is not visible`
      );
    }

    let baseBox = rawBox;
    if (ann.subbox) {
      const [nx, ny, nw, nh] = ann.subbox;
      baseBox = {
        x: rawBox.x + rawBox.width * nx,
        y: rawBox.y + rawBox.height * ny,
        width: rawBox.width * nw,
        height: rawBox.height * nh,
      };
    }

    const hp = ann.highlightPadding ?? 3;
    const x0 = Math.max(bounds.x + 2, baseBox.x - hp);
    const y0 = Math.max(bounds.y + 2, baseBox.y - hp);
    const x1 = Math.min(bounds.x + bounds.width - 2, baseBox.x + baseBox.width + hp);
    const y1 = Math.min(bounds.y + bounds.height - 2, baseBox.y + baseBox.height + hp);

    out.push({
      badge: ann.badge !== undefined ? String(ann.badge) : undefined,
      label: ann.label,
      placement: ann.placement ?? 'bottom',
      tone: ann.tone ?? 'accent',
      box: {
        x: x0,
        y: y0,
        width: Math.max(6, x1 - x0),
        height: Math.max(6, y1 - y0),
      },
    });
  }

  return out;
}

async function mountTopLayerAnnotations(
  page: Page,
  annotations: readonly ResolvedAnnotationPayload[],
  bounds: RectBox,
  viewport: { readonly width: number; readonly height: number }
): Promise<void> {
  await page.evaluate(
    async ({ overlayId, items, crop, vp }) => {
      document.getElementById(overlayId)?.remove();

      const palette: Record<
        string,
        { stroke: string; glow: string; badgeBg: string; badgeBorder: string }
      > = {
        accent: {
          stroke: '#38bdf8',
          glow: 'rgba(56, 189, 248, 0.11)',
          badgeBg: '#0284c7',
          badgeBorder: '#bae6fd',
        },
        warn: {
          stroke: '#f59e0b',
          glow: 'rgba(245, 158, 11, 0.13)',
          badgeBg: '#d97706',
          badgeBorder: '#fef3c7',
        },
        danger: {
          stroke: '#f43f5e',
          glow: 'rgba(244, 63, 94, 0.13)',
          badgeBg: '#e11d48',
          badgeBorder: '#ffe4e6',
        },
      };

      const host = document.createElement('div');
      host.id = overlayId;
      host.setAttribute('popover', 'manual');
      Object.assign(host.style, {
        position: 'fixed',
        inset: '0',
        width: `${vp.width}px`,
        height: `${vp.height}px`,
        margin: '0',
        padding: '0',
        border: 'none',
        background: 'transparent',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: '2147483647',
        fontFamily:
          'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      });

      const svgNs = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNs, 'svg');
      svg.setAttribute('width', String(vp.width));
      svg.setAttribute('height', String(vp.height));
      svg.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
      Object.assign(svg.style, {
        position: 'absolute',
        inset: '0',
        overflow: 'visible',
      });
      host.appendChild(svg);

      document.body.appendChild(host);
      if (typeof host.showPopover === 'function') {
        host.showPopover();
      }

      const placedPills: { el: HTMLDivElement; rect: DOMRect }[] = [];

      for (const item of items) {
        const theme = palette[item.tone] ?? palette.accent;
        const { x, y, width, height } = item.box;

        // Outer dark halo for crisp contrast over bright heatmap cells or active buttons
        const halo = document.createElementNS(svgNs, 'rect');
        halo.setAttribute('x', x.toFixed(1));
        halo.setAttribute('y', y.toFixed(1));
        halo.setAttribute('width', width.toFixed(1));
        halo.setAttribute('height', height.toFixed(1));
        halo.setAttribute('rx', '6');
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', 'rgba(2, 6, 23, 0.9)');
        halo.setAttribute('stroke-width', '4');
        svg.appendChild(halo);

        const rect = document.createElementNS(svgNs, 'rect');
        rect.setAttribute('x', x.toFixed(1));
        rect.setAttribute('y', y.toFixed(1));
        rect.setAttribute('width', width.toFixed(1));
        rect.setAttribute('height', height.toFixed(1));
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', theme.glow);
        rect.setAttribute('stroke', theme.stroke);
        rect.setAttribute('stroke-width', '2');
        svg.appendChild(rect);

        if (item.badge === undefined && !item.label) {
          continue;
        }

        const pill = document.createElement('div');
        Object.assign(pill.style, {
          position: 'absolute',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: item.label
            ? item.badge !== undefined
              ? '3px 9px 3px 4px'
              : '3px 9px'
            : '2px',
          borderRadius: '999px',
          background: 'rgba(7, 11, 20, 0.94)',
          border: `1.5px solid ${theme.stroke}`,
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.72)',
          color: '#f8fafc',
          fontSize: '11.5px',
          fontWeight: '650',
          lineHeight: '1.2',
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
        });

        if (item.badge !== undefined) {
          const badgeEl = document.createElement('span');
          badgeEl.textContent = item.badge;
          Object.assign(badgeEl.style, {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '18px',
            height: '18px',
            padding: '0 4px',
            borderRadius: '999px',
            background: theme.badgeBg,
            border: `1px solid ${theme.badgeBorder}`,
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: '800',
          });
          pill.appendChild(badgeEl);
        }

        if (item.label) {
          const textEl = document.createElement('span');
          textEl.textContent = item.label;
          pill.appendChild(textEl);
        }

        host.appendChild(pill);
        const m = pill.getBoundingClientRect();
        const gap = 11;

        let px = x + width / 2 - m.width / 2;
        let py = y + height + gap;
        if (item.placement === 'top') {
          py = y - m.height - gap;
        } else if (item.placement === 'left') {
          px = x - m.width - gap;
          py = y + height / 2 - m.height / 2;
        } else if (item.placement === 'right') {
          px = x + width + gap;
          py = y + height / 2 - m.height / 2;
        }

        // Clamp inside the screenshot crop frame so callouts are never sliced off
        const padEdge = 6;
        px = Math.max(
          crop.x + padEdge,
          Math.min(crop.x + crop.width - m.width - padEdge, px)
        );
        py = Math.max(
          crop.y + padEdge,
          Math.min(crop.y + crop.height - m.height - padEdge, py)
        );

        // Nudge vertically if overlapping an already-placed callout pill
        for (const prev of placedPills) {
          const overlapX = px < prev.rect.right + 6 && px + m.width > prev.rect.left - 6;
          const overlapY = py < prev.rect.bottom + 4 && py + m.height > prev.rect.top - 4;
          if (overlapX && overlapY) {
            const candidateDown = prev.rect.bottom + 6;
            if (candidateDown + m.height <= crop.y + crop.height - padEdge) {
              py = candidateDown;
            } else {
              py = Math.max(crop.y + padEdge, prev.rect.top - m.height - 6);
            }
          }
        }

        pill.style.left = `${px.toFixed(1)}px`;
        pill.style.top = `${py.toFixed(1)}px`;
        const finalRect = pill.getBoundingClientRect();
        placedPills.push({ el: pill, rect: finalRect });

        // Draw crisp leader line from nearest point on highlight box to pill center
        const pillCx = finalRect.left + finalRect.width / 2;
        const pillCy = finalRect.top + finalRect.height / 2;
        const anchorX = Math.max(x, Math.min(x + width, pillCx));
        const anchorY = Math.max(y, Math.min(y + height, pillCy));
        const dist = Math.hypot(pillCx - anchorX, pillCy - anchorY);

        if (dist > 6) {
          const leaderHalo = document.createElementNS(svgNs, 'line');
          leaderHalo.setAttribute('x1', anchorX.toFixed(1));
          leaderHalo.setAttribute('y1', anchorY.toFixed(1));
          leaderHalo.setAttribute('x2', pillCx.toFixed(1));
          leaderHalo.setAttribute('y2', pillCy.toFixed(1));
          leaderHalo.setAttribute('stroke', 'rgba(2, 6, 23, 0.85)');
          leaderHalo.setAttribute('stroke-width', '4');
          svg.appendChild(leaderHalo);

          const leader = document.createElementNS(svgNs, 'line');
          leader.setAttribute('x1', anchorX.toFixed(1));
          leader.setAttribute('y1', anchorY.toFixed(1));
          leader.setAttribute('x2', pillCx.toFixed(1));
          leader.setAttribute('y2', pillCy.toFixed(1));
          leader.setAttribute('stroke', theme.stroke);
          leader.setAttribute('stroke-width', '1.8');
          svg.appendChild(leader);
        }
      }

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    },
    { overlayId: OVERLAY_ID, items: annotations, crop: bounds, vp: viewport }
  );
}

async function removeTopLayerAnnotations(page: Page): Promise<void> {
  await page
    .evaluate((overlayId) => {
      document.getElementById(overlayId)?.remove();
    }, OVERLAY_ID)
    .catch(() => {});
}

export async function captureDocScreenshot(
  page: Page,
  spec: MarkdownScreenshotSpec
): Promise<void> {
  fs.mkdirSync(path.dirname(spec.outputAbsPath), { recursive: true });
  const viewport = page.viewportSize() ?? spec.viewport;
  const clip = await resolveRegionsClip(page, spec, viewport);
  const bounds: RectBox = clip ?? {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  };

  const hasAnnotations = spec.annotations.length > 0;
  if (hasAnnotations) {
    const resolved = await resolveAnnotations(page, spec, bounds);
    await mountTopLayerAnnotations(page, resolved, bounds, viewport);
  }

  try {
    await page.screenshot({
      path: spec.outputAbsPath,
      ...(clip ? { clip } : {}),
    });
  } finally {
    if (hasAnnotations) {
      await removeTopLayerAnnotations(page);
    }
  }
}
