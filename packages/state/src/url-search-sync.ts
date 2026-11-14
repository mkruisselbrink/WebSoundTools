// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export function parseSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function formatQueryString(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function syncBrowserQueryString(
  queryString: string,
  mode: 'push' | 'replace' = 'replace'
): void {
  if (typeof window === 'undefined' || !window.history || !window.location) {
    return;
  }
  const normalized =
    queryString.length > 0 && !queryString.startsWith('?')
      ? `?${queryString}`
      : queryString;
  const currentSearch = window.location.search || '';
  if (normalized === currentSearch) {
    return;
  }
  const nextUrl = `${window.location.pathname}${normalized}${window.location.hash || ''}`;
  if (mode === 'push') {
    window.history.pushState(null, '', nextUrl);
  } else {
    window.history.replaceState(null, '', nextUrl);
  }
}
