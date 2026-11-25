// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared Playwright Retina browser context factories and Markdown scene-spec
 * dispatcher for `npm run docs:screenshots` (imported safely without side effects).
 */

import type { Browser, BrowserContext, Page } from '@playwright/test';
import { captureDocScreenshot } from './annotation-overlay.ts';
import type { MarkdownScreenshotSpec } from './screenshot-spec.ts';

export interface RetinaSession {
  readonly context: BrowserContext;
  readonly page: Page;
}

export interface SceneCapturer {
  capture(sceneId: string, page: Page): Promise<void>;
  assertAllCaptured(): void;
}

export async function createRetinaPage(
  browser: Browser,
  width: number = 1440,
  height: number = 900
): Promise<RetinaSession> {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  return { context, page };
}

export async function createTouchRetinaPage(
  browser: Browser,
  width: number,
  height: number
): Promise<RetinaSession> {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: width < 680,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => ({
          released: false,
          release: async () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      },
    });
  });
  return { context, page };
}

export function createSceneCapturer(
  specs: readonly MarkdownScreenshotSpec[]
): SceneCapturer {
  const byScene = new Map<string, MarkdownScreenshotSpec>();
  for (const spec of specs) {
    if (byScene.has(spec.scene)) {
      throw new Error(`Duplicate scene id "${spec.scene}" in Markdown screenshot specs`);
    }
    byScene.set(spec.scene, spec);
  }
  const captured = new Set<string>();

  return {
    async capture(sceneId: string, page: Page): Promise<void> {
      const spec = byScene.get(sceneId);
      if (!spec) {
        throw new Error(
          `Scene "${sceneId}" has no matching <!-- screenshot --> YAML block in any Markdown file`
        );
      }
      const vp = page.viewportSize();
      if (vp && (vp.width !== spec.viewport.width || vp.height !== spec.viewport.height)) {
        throw new Error(
          `Scene "${sceneId}" expected viewport ${spec.viewport.width}x${spec.viewport.height}, got ${vp.width}x${vp.height}`
        );
      }
      await captureDocScreenshot(page, spec);
      captured.add(sceneId);
    },

    assertAllCaptured(): void {
      const missing: string[] = [];
      for (const sceneId of byScene.keys()) {
        if (!captured.has(sceneId)) {
          missing.push(sceneId);
        }
      }
      if (missing.length > 0) {
        throw new Error(
          `Uncaptured Markdown screenshot scenes (${missing.length}): ${missing.join(', ')}`
        );
      }
    },
  };
}
