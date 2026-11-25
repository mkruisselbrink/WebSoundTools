// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Parses and validates `<!-- screenshot ... -->` YAML metadata blocks embedded
 * directly above `![alt](relPath)` images in documentation Markdown files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export type ScreenshotAppId = 'wsm' | 'wss';
export type AnnotationTone = 'accent' | 'warn' | 'danger';
export type AnnotationPlacement = 'top' | 'bottom' | 'left' | 'right';

export type ScreenshotPadding =
  | number
  | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };

export interface ScreenshotAnnotationSpec {
  readonly badge?: number | string;
  readonly target: string;
  readonly nth?: number;
  /** Optional normalized `[x, y, width, height]` (`0..1`) sub-region inside `target` (e.g. a canvas feature). */
  readonly subbox?: readonly [number, number, number, number];
  readonly label?: string;
  readonly placement?: AnnotationPlacement;
  readonly tone?: AnnotationTone;
  readonly highlightPadding?: number;
}

export interface ScreenshotViewportSpec {
  readonly width: number;
  readonly height: number;
  readonly touch?: boolean;
}

export interface MarkdownScreenshotSpec {
  readonly app: ScreenshotAppId;
  readonly scene: string;
  readonly description: string;
  readonly imageRelPath: string;
  readonly outputAbsPath: string;
  readonly sourceMarkdownPath: string;
  readonly viewport: ScreenshotViewportSpec;
  readonly regions?: readonly string[];
  readonly padding?: ScreenshotPadding;
  readonly annotations: readonly ScreenshotAnnotationSpec[];
}

const VALID_APPS = new Set<string>(['wsm', 'wss']);
const VALID_TONES = new Set<string>(['accent', 'warn', 'danger']);
const VALID_PLACEMENTS = new Set<string>(['top', 'bottom', 'left', 'right']);

const DEFAULT_VIEWPORT: ScreenshotViewportSpec = {
  width: 1440,
  height: 900,
  touch: false,
};

function maskFencedCodeBlocks(markdown: string): string {
  const withoutFenced = markdown.replace(
    /^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})\s*$/gm,
    (block) => block.replace(/[^\n]/g, ' ')
  );
  return withoutFenced.replace(/`[^`\n]+`/g, (span) => ' '.repeat(span.length));
}

function validatePadding(raw: unknown, ctx: string): ScreenshotPadding | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (!['top', 'right', 'bottom', 'left'].includes(key)) {
        throw new Error(`${ctx}: invalid padding key "${key}"`);
      }
      const v = obj[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        throw new Error(`${ctx}: padding.${key} must be a non-negative number`);
      }
    }
    return obj as ScreenshotPadding;
  }
  throw new Error(`${ctx}: padding must be a non-negative number or {top,right,bottom,left}`);
}

function validateAnnotations(
  raw: unknown,
  ctx: string
): readonly ScreenshotAnnotationSpec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${ctx}: "annotations" must be an array`);
  }
  return raw.map((entry, idx) => {
    const itemCtx = `${ctx} annotations[${idx}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${itemCtx}: expected an object`);
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.target !== 'string' || obj.target.trim().length === 0) {
      throw new Error(`${itemCtx}: "target" must be a non-empty selector string`);
    }
    if (
      obj.badge !== undefined &&
      typeof obj.badge !== 'number' &&
      typeof obj.badge !== 'string'
    ) {
      throw new Error(`${itemCtx}: "badge" must be a number or string`);
    }
    if (obj.nth !== undefined && (!Number.isInteger(obj.nth) || Number(obj.nth) < 0)) {
      throw new Error(`${itemCtx}: "nth" must be a non-negative integer`);
    }
    let subbox: readonly [number, number, number, number] | undefined;
    if (obj.subbox !== undefined) {
      if (
        !Array.isArray(obj.subbox) ||
        obj.subbox.length !== 4 ||
        !obj.subbox.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
      ) {
        throw new Error(`${itemCtx}: "subbox" must be [x, y, width, height] in 0..1`);
      }
      subbox = [obj.subbox[0], obj.subbox[1], obj.subbox[2], obj.subbox[3]];
    }
    if (obj.label !== undefined && (typeof obj.label !== 'string' || !obj.label.trim())) {
      throw new Error(`${itemCtx}: "label" must be a non-empty string when provided`);
    }
    if (obj.placement !== undefined && !VALID_PLACEMENTS.has(String(obj.placement))) {
      throw new Error(`${itemCtx}: invalid placement "${String(obj.placement)}"`);
    }
    if (obj.tone !== undefined && !VALID_TONES.has(String(obj.tone))) {
      throw new Error(`${itemCtx}: invalid tone "${String(obj.tone)}"`);
    }
    if (
      obj.highlightPadding !== undefined &&
      (typeof obj.highlightPadding !== 'number' || !Number.isFinite(obj.highlightPadding))
    ) {
      throw new Error(`${itemCtx}: "highlightPadding" must be a finite number`);
    }

    return {
      badge: obj.badge as number | string | undefined,
      target: obj.target.trim(),
      nth: obj.nth as number | undefined,
      subbox,
      label: typeof obj.label === 'string' ? obj.label.trim() : undefined,
      placement: obj.placement as AnnotationPlacement | undefined,
      tone: obj.tone as AnnotationTone | undefined,
      highlightPadding: obj.highlightPadding as number | undefined,
    };
  });
}

export function parseMarkdownScreenshotSpecsInFile(
  mdPath: string
): MarkdownScreenshotSpec[] {
  const absMdPath = path.resolve(mdPath);
  const rawMarkdown = fs.readFileSync(absMdPath, 'utf8');
  const masked = maskFencedCodeBlocks(rawMarkdown);

  const commentRe = /<!--\s*screenshot\b([\s\S]*?)-->/g;
  const matches: { readonly body: string; readonly start: number; readonly end: number }[] =
    [];
  let cm: RegExpExecArray | null;
  while ((cm = commentRe.exec(masked)) !== null) {
    matches.push({
      body: rawMarkdown.slice(
        cm.index + cm[0].indexOf(cm[1]),
        cm.index + cm[0].length - 3
      ),
      start: cm.index,
      end: cm.index + cm[0].length,
    });
  }

  const specs: MarkdownScreenshotSpec[] = [];
  const imageRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const lineNo = rawMarkdown.slice(0, current.start).split('\n').length;
    const ctx = `${absMdPath}:${lineNo}`;

    let parsed: unknown;
    try {
      parsed = parseYaml(current.body);
    } catch (err) {
      throw new Error(
        `${ctx}: invalid YAML in <!-- screenshot --> block: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${ctx}: <!-- screenshot --> block must parse to a YAML mapping`);
    }
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.app !== 'string' || !VALID_APPS.has(obj.app)) {
      throw new Error(`${ctx}: "app" must be "wsm" or "wss"`);
    }
    if (typeof obj.scene !== 'string' || obj.scene.trim().length === 0) {
      throw new Error(`${ctx}: "scene" must be a non-empty scene identifier`);
    }
    if (typeof obj.description !== 'string' || obj.description.trim().length < 12) {
      throw new Error(
        `${ctx}: "description" must be a descriptive summary (>= 12 chars)`
      );
    }

    let imageRelPath: string | undefined;
    if (obj.image !== undefined) {
      if (typeof obj.image !== 'string' || !obj.image.trim()) {
        throw new Error(`${ctx}: "image" must be a non-empty relative path when provided`);
      }
      imageRelPath = obj.image.trim();
      // Verify the image is referenced in the Markdown file after this block
      const tail = masked.slice(current.end);
      if (!tail.includes(`(${imageRelPath})`) && !tail.includes(`(${imageRelPath} `)) {
        throw new Error(
          `${ctx}: declared image "${imageRelPath}" was not found in Markdown below block`
        );
      }
    } else {
      const nextCommentStart =
        i + 1 < matches.length ? matches[i + 1].start : masked.length;
      const between = masked.slice(current.end, nextCommentStart);
      imageRe.lastIndex = 0;
      const imgMatch = imageRe.exec(between);
      if (!imgMatch) {
        throw new Error(
          `${ctx}: no ![alt](path) image found after <!-- screenshot --> block (specify "image:" if multiple blocks precede a table)`
        );
      }
      imageRelPath = imgMatch[1].trim();
    }

    let regions: readonly string[] | undefined;
    if (obj.regions !== undefined) {
      const rawList = typeof obj.regions === 'string' ? [obj.regions] : obj.regions;
      if (
        !Array.isArray(rawList) ||
        rawList.length === 0 ||
        !rawList.every((r) => typeof r === 'string' && r.trim().length > 0)
      ) {
        throw new Error(`${ctx}: "regions" must be a non-empty string or string[]`);
      }
      regions = rawList.map((r) => String(r).trim());
    }

    let viewport = DEFAULT_VIEWPORT;
    if (obj.viewport !== undefined) {
      if (!obj.viewport || typeof obj.viewport !== 'object' || Array.isArray(obj.viewport)) {
        throw new Error(`${ctx}: "viewport" must be { width, height, touch? }`);
      }
      const vp = obj.viewport as Record<string, unknown>;
      if (
        typeof vp.width !== 'number' ||
        vp.width < 240 ||
        typeof vp.height !== 'number' ||
        vp.height < 240
      ) {
        throw new Error(`${ctx}: viewport width/height must be numbers >= 240`);
      }
      viewport = {
        width: vp.width,
        height: vp.height,
        touch: Boolean(vp.touch),
      };
    }

    const cleanImageRel = imageRelPath.split('#')[0];
    const outputAbsPath = path.resolve(path.dirname(absMdPath), cleanImageRel);

    specs.push({
      app: obj.app as ScreenshotAppId,
      scene: obj.scene.trim(),
      description: obj.description.trim(),
      imageRelPath: cleanImageRel,
      outputAbsPath,
      sourceMarkdownPath: absMdPath,
      viewport,
      regions,
      padding: validatePadding(obj.padding, ctx),
      annotations: validateAnnotations(obj.annotations, ctx),
    });
  }

  return specs;
}

function collectMarkdownFiles(dir: string, ignoreDirs: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(full, ignoreDirs));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out.sort();
}

export function parseAllMarkdownScreenshotSpecs(
  repoRoot: string
): MarkdownScreenshotSpec[] {
  const ignoreDirs = new Set([
    'node_modules',
    'dist',
    '.git',
    'test-results',
    'playwright-report',
    '.vite',
  ]);
  const mdFiles = collectMarkdownFiles(repoRoot, ignoreDirs);
  const allSpecs: MarkdownScreenshotSpec[] = [];
  const seenOutputs = new Map<string, string>();

  for (const mdFile of mdFiles) {
    for (const spec of parseMarkdownScreenshotSpecsInFile(mdFile)) {
      const prevSource = seenOutputs.get(spec.outputAbsPath);
      if (prevSource) {
        throw new Error(
          `Duplicate <!-- screenshot --> output "${path.relative(
            repoRoot,
            spec.outputAbsPath
          )}" in both ${path.relative(repoRoot, prevSource)} and ${path.relative(
            repoRoot,
            mdFile
          )}`
        );
      }
      seenOutputs.set(spec.outputAbsPath, mdFile);
      allSpecs.push(spec);
    }
  }

  return allSpecs;
}
