/**
 * WebSpeakerSim
 * Copyright (C) 2026 WebSpeakerSim Contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Pure Service Worker caching policy & cross-origin isolation header utilities (`src/pwa/sw-core.ts`).
 */

export const CACHE_PREFIX = 'web-speaker-sim-';

export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export function buildCacheName(versionHash: string): string {
  return `${CACHE_PREFIX}${versionHash}`;
}

export function selectObsoleteCaches(
  existingCacheNames: readonly string[],
  activeCacheName: string
): string[] {
  return existingCacheNames.filter(
    (name) => name.startsWith(CACHE_PREFIX) && name !== activeCacheName
  );
}

export function shouldInterceptSameOriginGet(
  method: string,
  requestUrl: string,
  selfOrigin: string
): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  try {
    const parsed = new URL(requestUrl);
    return parsed.origin === selfOrigin;
  } catch {
    return false;
  }
}

export function withCrossOriginIsolationHeaders(response: Response): Response {
  if (response.status === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
