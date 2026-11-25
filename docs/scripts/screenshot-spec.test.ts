// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkdownScreenshotSpecsInFile } from './screenshot-spec.js';

describe('parseMarkdownScreenshotSpecsInFile', () => {
  it('parses YAML screenshot specs, pairs following images, and supports explicit table image bindings', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-spec-test-'));
    const mdPath = path.join(tmpDir, 'sample.md');

    try {
      fs.writeFileSync(
        mdPath,
        [
          '# Sample Tutorial',
          '',
          '<!-- screenshot',
          'app: wsm',
          'scene: sample-scene-one',
          'description: Hardware audio interface routing with pink noise generator active.',
          'regions: [topbar, charts-column]',
          'padding: { top: 0, bottom: 16 }',
          'annotations:',
          '  - badge: 1',
          '    target: "[data-testid=\'btn-io-popover\']"',
          '    label: "USB Loopback"',
          '    placement: bottom',
          '    tone: accent',
          '-->',
          '![Hardware Setup](./images/01-setup.png)',
          '',
          '<!-- screenshot',
          'image: ./images/02-left.png',
          'app: wsm',
          'scene: sample-table-left',
          'viewport: { width: 390, height: 844, touch: true }',
          'description: Handheld phone SPL trend view with active ring banner.',
          '-->',
          '<!-- screenshot',
          'image: ./images/03-right.png',
          'app: wss',
          'scene: sample-table-right',
          'description: Sub-array cardioid null highlighted on Plan View.',
          'annotations:',
          '  - badge: A',
          '    target: "[data-testid=\'viewport-plan\']"',
          '    subbox: [0.1, 0.25, 0.2, 0.4]',
          '    label: "Stage Null"',
          '    tone: warn',
          '-->',
          '',
          '| Left | Right |',
          '| :---: | :---: |',
          '| ![Left](./images/02-left.png) | ![Right](./images/03-right.png) |',
        ].join('\n'),
        'utf8'
      );

      const specs = parseMarkdownScreenshotSpecsInFile(mdPath);
      expect(specs).toHaveLength(3);

      expect(specs[0].scene).toBe('sample-scene-one');
      expect(specs[0].regions).toEqual(['topbar', 'charts-column']);
      expect(specs[0].outputAbsPath).toBe(path.join(tmpDir, 'images/01-setup.png'));
      expect(specs[0].annotations).toHaveLength(1);
      expect(specs[0].annotations[0].badge).toBe(1);
      expect(specs[0].annotations[0].label).toBe('USB Loopback');

      expect(specs[1].scene).toBe('sample-table-left');
      expect(specs[1].viewport).toEqual({ width: 390, height: 844, touch: true });
      expect(specs[1].outputAbsPath).toBe(path.join(tmpDir, 'images/02-left.png'));

      expect(specs[2].scene).toBe('sample-table-right');
      expect(specs[2].annotations[0].subbox).toEqual([0.1, 0.25, 0.2, 0.4]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed YAML or missing paired images with line-numbered context', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-spec-err-'));
    const mdPath = path.join(tmpDir, 'broken.md');

    try {
      fs.writeFileSync(
        mdPath,
        [
          '<!-- screenshot',
          'app: wsm',
          'scene: orphan-block',
          'description: Valid description without any image below it.',
          '-->',
          'No image here.',
        ].join('\n'),
        'utf8'
      );

      expect(() => parseMarkdownScreenshotSpecsInFile(mdPath)).toThrow(
        /no !\[alt\]\(path\) image found/
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
