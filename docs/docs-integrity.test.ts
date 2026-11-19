// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Automated documentation & screenshot integrity suite (`npm test`).
 *
 * Verifies:
 * 1. Every relative link and image path across all repository Markdown files resolves on disk.
 * 2. Every `#heading` anchor fragment matches an actual GitHub-slugified heading in its target `.md` file.
 * 3. Every documentation `.png` file has a valid PNG `IHDR` header and is referenced (zero orphaned images).
 * 4. Individual numbered tutorial files (`docs/tutorials/0*.md`) stay standalone without brittle sibling links.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function collectFiles(dir: string, ext: string, ignoreDirs: ReadonlySet<string>): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, ext, ignoreDirs));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results.sort();
}

function stripCodeBlocksAndSpans(markdown: string): string {
  // Strip fenced code blocks (3+ backticks or tildes) and inline code spans
  const withoutFenced = markdown.replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})\s*$/gm, '');
  return withoutFenced.replace(/`[^`\n]+`/g, '');
}

function githubSlugifyHeading(rawHeading: string): string {
  const plain = rawHeading
    .trim()
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .toLowerCase();
  // GitHub removes punctuation except hyphens and spaces, then converts each space to a hyphen
  return plain
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

function extractHeadingSlugs(mdPath: string, cache: Map<string, Set<string>>): Set<string> {
  const existing = cache.get(mdPath);
  if (existing) return existing;

  const slugs = new Set<string>();
  const counts = new Map<string, number>();
  const text = fs.readFileSync(mdPath, 'utf8');
  const withoutFences = text.replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})\s*$/gm, '');

  for (const line of withoutFences.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const base = githubSlugifyHeading(match[2]);
    if (!base) continue;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  }

  cache.set(mdPath, slugs);
  return slugs;
}

interface ParsedMarkdownLink {
  readonly sourceFile: string;
  readonly rawTarget: string;
  readonly isImage: boolean;
}

function extractMarkdownLinks(mdFile: string): ParsedMarkdownLink[] {
  const raw = fs.readFileSync(mdFile, 'utf8');
  const cleaned = stripCodeBlocksAndSpans(raw);
  const links: ParsedMarkdownLink[] = [];
  const linkRegex = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(cleaned)) !== null) {
    links.push({
      sourceFile: mdFile,
      rawTarget: m[2].trim(),
      isImage: m[1] === '!',
    });
  }
  return links;
}

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'test-results',
  'playwright-report',
  '.vite',
]);

describe('Documentation, Relative Links, Heading Anchors & Screenshot Integrity', () => {
  const allMarkdownFiles = collectFiles(REPO_ROOT, '.md', IGNORE_DIRS);
  const docRoots = [
    path.join(REPO_ROOT, 'docs'),
    path.join(REPO_ROOT, 'apps/WebSoundMeter/docs'),
    path.join(REPO_ROOT, 'apps/WebSpeakerSim/docs'),
  ];
  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'] as const;

  it('resolves every relative Markdown link, image embed, and #heading anchor across the monorepo', () => {
    expect(allMarkdownFiles.length).toBeGreaterThan(15);
    const headingCache = new Map<string, Set<string>>();
    const broken: string[] = [];

    for (const mdFile of allMarkdownFiles) {
      const relSource = path.relative(REPO_ROOT, mdFile);
      for (const link of extractMarkdownLinks(mdFile)) {
        const { rawTarget } = link;
        if (
          rawTarget.startsWith('http://') ||
          rawTarget.startsWith('https://') ||
          rawTarget.startsWith('mailto:') ||
          rawTarget.startsWith('file://') ||
          rawTarget.startsWith('conversation://')
        ) {
          continue;
        }

        const hashIdx = rawTarget.indexOf('#');
        const pathPart = hashIdx >= 0 ? rawTarget.slice(0, hashIdx) : rawTarget;
        const fragment = hashIdx >= 0 ? decodeURIComponent(rawTarget.slice(hashIdx + 1)) : '';

        const resolvedFile =
          pathPart.length === 0 ? mdFile : path.resolve(path.dirname(mdFile), pathPart);

        if (!fs.existsSync(resolvedFile)) {
          broken.push(`${relSource} -> missing target "${rawTarget}"`);
          continue;
        }
        const stat = fs.statSync(resolvedFile);
        if (link.isImage && !stat.isFile()) {
          broken.push(`${relSource} -> image target is not a file "${rawTarget}"`);
          continue;
        }

        if (fragment.length > 0 && stat.isFile() && resolvedFile.endsWith('.md')) {
          const slugs = extractHeadingSlugs(resolvedFile, headingCache);
          if (!slugs.has(fragment.toLowerCase())) {
            broken.push(
              `${relSource} -> missing #${fragment} in ${path.relative(REPO_ROOT, resolvedFile)}`
            );
          }
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('validates PNG headers/dimensions and ensures zero orphaned documentation images', () => {
    const isImagePath = (p: string) =>
      IMAGE_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext));

    const referencedImages = new Set<string>();
    for (const mdFile of allMarkdownFiles) {
      for (const link of extractMarkdownLinks(mdFile)) {
        const cleanTarget = link.rawTarget.split('#')[0];
        if (!isImagePath(cleanTarget)) continue;
        if (/^[a-z]+:\/\//i.test(cleanTarget)) continue;
        referencedImages.add(path.resolve(path.dirname(mdFile), cleanTarget));
      }
    }

    const docImages = docRoots.flatMap((root) =>
      IMAGE_EXTENSIONS.flatMap((ext) => collectFiles(root, ext, IGNORE_DIRS))
    );
    expect(docImages.length).toBeGreaterThanOrEqual(22);

    const issues: string[] = [];
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    for (const imgPath of docImages) {
      const relImg = path.relative(REPO_ROOT, imgPath);
      if (imgPath.toLowerCase().endsWith('.png')) {
        const buf = fs.readFileSync(imgPath);
        if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
          issues.push(`${relImg}: invalid PNG signature`);
          continue;
        }
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (width < 200 || height < 150) {
          issues.push(`${relImg}: implausibly small PNG (${width}x${height})`);
        }
      }
      if (!referencedImages.has(imgPath)) {
        issues.push(`${relImg}: orphaned image (not referenced in any .md file)`);
      }
    }

    expect(issues).toEqual([]);
  });

  it('keeps numbered tutorial files standalone without hand-maintained sibling tutorial links', () => {
    const tutorialsDir = path.join(REPO_ROOT, 'docs/tutorials');
    const tutorialFiles = fs
      .readdirSync(tutorialsDir)
      .filter((f) => /^\d{2}-.*\.md$/.test(f))
      .map((f) => path.join(tutorialsDir, f));

    const siblingViolations: string[] = [];
    for (const tutFile of tutorialFiles) {
      const relTut = path.relative(REPO_ROOT, tutFile);
      for (const link of extractMarkdownLinks(tutFile)) {
        const cleanTarget = link.rawTarget.split('#')[0];
        if (!cleanTarget || /^[a-z]+:\/\//i.test(cleanTarget)) continue;
        const resolved = path.resolve(path.dirname(tutFile), cleanTarget);
        if (
          path.dirname(resolved) === tutorialsDir &&
          /^\d{2}-.*\.md$/.test(path.basename(resolved)) &&
          resolved !== tutFile
        ) {
          siblingViolations.push(`${relTut} links to sibling tutorial "${link.rawTarget}"`);
        }
      }
    }

    expect(siblingViolations).toEqual([]);
  });

  it('keeps PWA manifests, index.html descriptions, public icons/screenshots, and vite precache lists synchronized', () => {
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const apps = ['WebSoundMeter', 'WebSpeakerSim'] as const;
    const issues: string[] = [];

    for (const app of apps) {
      const appDir = path.join(REPO_ROOT, 'apps', app);
      const publicDir = path.join(appDir, 'public');
      const manifestPath = path.join(publicDir, 'manifest.webmanifest');
      const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
      const viteConfig = fs.readFileSync(path.join(appDir, 'vite.config.ts'), 'utf8');

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        id?: string;
        name?: string;
        description?: string;
        icons?: { src: string; sizes: string; type: string }[];
        screenshots?: {
          src: string;
          sizes: string;
          type: string;
          form_factor?: string;
          label?: string;
        }[];
      };

      if (!manifest.id) {
        issues.push(`${app}: manifest.webmanifest missing explicit "id"`);
      }

      const metaMatch = /<meta\s+name="description"\s+content="([^"]+)"/s.exec(indexHtml);
      if (!metaMatch || metaMatch[1] !== manifest.description) {
        issues.push(`${app}: index.html <meta name="description"> does not match manifest.webmanifest`);
      }

      const titleMatch = /<title>([^<]+)<\/title>/.exec(indexHtml);
      if (!titleMatch || titleMatch[1] !== manifest.name) {
        issues.push(`${app}: index.html <title> does not match manifest.webmanifest "name"`);
      }

      const referencedPublicAssets = new Set<string>([manifestPath]);
      const checkAsset = (
        entry: { src: string; sizes: string; type: string },
        kind: 'icon' | 'screenshot'
      ) => {
        const absPath = path.resolve(publicDir, entry.src);
        referencedPublicAssets.add(absPath);
        if (!fs.existsSync(absPath)) {
          issues.push(`${app}: missing ${kind} file "${entry.src}"`);
          return;
        }
        const webPath = '/' + path.relative(publicDir, absPath).split(path.sep).join('/');
        if (!viteConfig.includes(`'${webPath}'`)) {
          issues.push(`${app}: vite.config.ts staticPaths missing '${webPath}'`);
        }
        if (absPath.endsWith('.png')) {
          const buf = fs.readFileSync(absPath);
          if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
            issues.push(`${app}: invalid PNG signature in "${entry.src}"`);
            return;
          }
          const actualSizes = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
          if (entry.sizes !== actualSizes) {
            issues.push(
              `${app}: "${entry.src}" declared sizes "${entry.sizes}" != actual "${actualSizes}"`
            );
          }
        }
      };

      for (const icon of manifest.icons ?? []) {
        checkAsset(icon, 'icon');
      }

      const screenshots = manifest.screenshots ?? [];
      if (screenshots.length < 2) {
        issues.push(`${app}: expected at least 2 manifest screenshots, found ${screenshots.length}`);
      }
      for (const shot of screenshots) {
        checkAsset(shot, 'screenshot');
        if (shot.form_factor !== 'wide') {
          issues.push(`${app}: screenshot "${shot.src}" missing form_factor="wide"`);
        }
        if (!shot.label || shot.label.trim().length < 10) {
          issues.push(`${app}: screenshot "${shot.src}" missing descriptive label`);
        }
      }

      const allPublicFiles = IMAGE_EXTENSIONS.flatMap((ext) =>
        collectFiles(publicDir, ext, IGNORE_DIRS)
      );
      for (const pubImg of allPublicFiles) {
        if (!referencedPublicAssets.has(pubImg)) {
          issues.push(
            `${app}: orphaned public image "${path.relative(REPO_ROOT, pubImg)}" not referenced in manifest.webmanifest`
          );
        }
      }
    }

    expect(issues).toEqual([]);
  });
});
