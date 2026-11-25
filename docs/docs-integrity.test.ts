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
import { ALL_REGISTERED_SCENE_IDS } from './scripts/generate-screenshots.js';
import { parseAllMarkdownScreenshotSpecs } from './scripts/screenshot-spec.js';

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
  // Strip fenced code blocks, HTML comments, and inline code spans
  const withoutFenced = markdown.replace(
    /^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})\s*$/gm,
    ''
  );
  const withoutComments = withoutFenced.replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments.replace(/`[^`\n]+`/g, '');
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

  it('pairs every documentation PNG 1-to-1 with a valid Markdown <!-- screenshot --> YAML spec and registered scene', () => {
    const specs = parseAllMarkdownScreenshotSpecs(REPO_ROOT);
    expect(specs.length).toBe(ALL_REGISTERED_SCENE_IDS.size);

    const specOutputPaths = new Set<string>();
    const specScenes = new Set<string>();
    const issues: string[] = [];

    for (const spec of specs) {
      specOutputPaths.add(spec.outputAbsPath);
      specScenes.add(spec.scene);
      if (!ALL_REGISTERED_SCENE_IDS.has(spec.scene)) {
        issues.push(
          `${path.relative(REPO_ROOT, spec.sourceMarkdownPath)}: unknown scene "${spec.scene}"`
        );
      }
    }

    for (const registeredScene of ALL_REGISTERED_SCENE_IDS) {
      if (!specScenes.has(registeredScene)) {
        issues.push(`Registered scene "${registeredScene}" is unused in Markdown specs`);
      }
    }

    const docPngs = docRoots.flatMap((root) => collectFiles(root, '.png', IGNORE_DIRS));
    for (const pngPath of docPngs) {
      if (!specOutputPaths.has(pngPath)) {
        issues.push(
          `${path.relative(REPO_ROOT, pngPath)}: missing <!-- screenshot --> YAML spec in Markdown`
        );
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

  it('keeps runtime third-party dependencies strictly limited to lit', () => {
    const pkgFiles = [
      path.join(REPO_ROOT, 'package.json'),
      ...collectFiles(path.join(REPO_ROOT, 'packages'), 'package.json', IGNORE_DIRS),
      ...collectFiles(path.join(REPO_ROOT, 'apps'), 'package.json', IGNORE_DIRS),
    ];

    const disallowed: string[] = [];
    for (const pf of pkgFiles) {
      const parsed = JSON.parse(fs.readFileSync(pf, 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      for (const dep of Object.keys(parsed.dependencies ?? {})) {
        if (dep !== 'lit' && !dep.startsWith('@foh/')) {
          disallowed.push(`${path.relative(REPO_ROOT, pf)} -> unexpected dependency "${dep}"`);
        }
      }
    }
    expect(disallowed).toEqual([]);
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
        display_override?: string[];
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

      if (!manifest.display_override?.includes('window-controls-overlay')) {
        issues.push(`${app}: manifest.webmanifest missing "window-controls-overlay" in display_override`);
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
        if (shot.form_factor !== 'wide' && shot.form_factor !== 'narrow') {
          issues.push(
            `${app}: screenshot "${shot.src}" missing form_factor="wide"|"narrow"`
          );
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

  it('enforces GitHub-safe GFM table pipes, Mermaid blocks, balanced backticks/math, and alert headers', () => {
    const syntaxIssues: string[] = [];

    for (const mdFile of allMarkdownFiles) {
      const relSource = path.relative(REPO_ROOT, mdFile);
      const lines = fs.readFileSync(mdFile, 'utf8').split('\n');
      let inFence = false;
      let fenceLang = '';
      let inHtmlComment = false;
      let expectedTableCols = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        if (inHtmlComment) {
          if (line.includes('-->')) {
            inHtmlComment = false;
          }
          continue;
        }

        const fenceMatch = /^(?:`{3,}|~{3,})(.*)$/.exec(line.trim());

        if (fenceMatch) {
          if (!inFence) {
            inFence = true;
            fenceLang = fenceMatch[1].trim();
          } else {
            inFence = false;
            fenceLang = '';
          }
          expectedTableCols = -1;
          continue;
        }

        if (!inFence && line.trimStart().startsWith('<!--')) {
          if (!line.includes('-->')) {
            inHtmlComment = true;
          }
          continue;
        }

        if (inFence) {
          if (fenceLang === 'mermaid') {
            if (line.includes('\\"')) {
              syntaxIssues.push(
                `${relSource}:${lineNo}: Mermaid block contains backslash-escaped quote (\\") which fails GitHub Mermaid parsing`
              );
            }
            if (line.includes('\\n')) {
              syntaxIssues.push(
                `${relSource}:${lineNo}: Mermaid block contains literal \\n in label`
              );
            }
            if (/<\s*br\s*\/?\s*>/i.test(line)) {
              syntaxIssues.push(
                `${relSource}:${lineNo}: Mermaid block contains HTML <br> tag in label`
              );
            }
          }
          continue;
        }

        // GitHub alerts require the [!TYPE] tag alone on its first blockquote line
        const alertMatch = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)$/.exec(line);
        if (alertMatch && alertMatch[2].trim().length > 0) {
          syntaxIssues.push(
            `${relSource}:${lineNo}: GitHub alert [!] must be followed by a newline, not inline text`
          );
        }

        // GFM splits table cells on unescaped '|' BEFORE inline code spans or $math$
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          const cols = trimmed.replace(/\\\|/g, '').split('|').length - 2;
          if (expectedTableCols === -1) {
            expectedTableCols = cols;
          } else if (cols !== expectedTableCols) {
            syntaxIssues.push(
              `${relSource}:${lineNo}: GFM table column mismatch (expected ${expectedTableCols}, got ${cols} — escape '|' as '\\|' or '\\lvert' inside table cells)`
            );
          }
        } else {
          expectedTableCols = -1;
        }

        const backtickCount = (line.match(/`/g) ?? []).length;
        if (backtickCount % 2 !== 0) {
          syntaxIssues.push(`${relSource}:${lineNo}: unbalanced inline backticks`);
        }

        // Strip inline code spans and escaped \$ before checking $...$ math pairs & flanking
        const withoutCode = line.replace(/`[^`]*`/g, '').replace(/\\\$/g, '');
        const dollarCount = (withoutCode.match(/\$/g) ?? []).length;
        if (dollarCount % 2 !== 0) {
          syntaxIssues.push(`${relSource}:${lineNo}: unbalanced '$' inline math delimiters`);
        }
        if (/\$\s*\\(?:rightarrow|leftarrow|leftrightarrow)\s*\$/.test(withoutCode)) {
          syntaxIssues.push(
            `${relSource}:${lineNo}: use Unicode arrows (→, ←, ↔) in prose instead of standalone LaTeX arrow spans`
          );
        }

        const mathRegex = /\$\$[^$]+\$\$|\$[^$]+\$/g;
        let mm: RegExpExecArray | null;
        while ((mm = mathRegex.exec(withoutCode)) !== null) {
          if (mm[0].startsWith('$$')) continue;
          const inner = mm[0].slice(1, -1);
          const before = mm.index > 0 ? withoutCode[mm.index - 1] : '';
          const after =
            mm.index + mm[0].length < withoutCode.length
              ? withoutCode[mm.index + mm[0].length]
              : '';
          if (inner.startsWith(' ') || inner.endsWith(' ')) {
            syntaxIssues.push(
              `${relSource}:${lineNo}: inline math "${mm[0]}" has leading/trailing space inside '$'`
            );
          }
          if (/[A-Za-z0-9-]/.test(before)) {
            syntaxIssues.push(
              `${relSource}:${lineNo}: opening '$' preceded by '${before}' in "${before}${mm[0]}" breaks GitHub MathJax`
            );
          }
          if (/[A-Za-z0-9]/.test(after)) {
            syntaxIssues.push(
              `${relSource}:${lineNo}: closing '$' followed by '${after}' in "${mm[0]}${after}" breaks GitHub MathJax`
            );
          }
        }
      }

      if (inFence) {
        syntaxIssues.push(`${relSource}: unclosed fenced code block at EOF`);
      }
    }

    expect(syntaxIssues).toEqual([]);
  });
});
