// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Normalizes a user-authored trace or project title into a clean kebab-case file slug.
 */
export function slugifyFilename(name: string, fallback: string = 'export'): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

/**
 * Triggers a client-side browser download for a UTF-8 text payload (`.frd`, `.csv`, `.json`)
 * and revokes the temporary object URL cleanly.
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain;charset=utf-8'
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  if (typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body?.appendChild(a);
  a.click();
  document.body?.removeChild(a);
  URL.revokeObjectURL(url);
}
