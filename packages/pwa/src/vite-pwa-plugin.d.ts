// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Plugin } from 'vite';

export declare const CROSS_ORIGIN_ISOLATION_HEADERS: Readonly<Record<string, string>>;

export interface FohPwaPluginOptions {
  readonly cachePrefix: string;
  readonly cacheVersion?: string;
  readonly staticPaths?: readonly string[];
}

export declare function computeShortHash(items: readonly string[]): string;

export declare function buildServiceWorkerScript(
  cachePrefix: string,
  cacheName: string,
  precacheUrls: readonly string[]
): string;

export declare function fohPwaPlugin(options: FohPwaPluginOptions): Plugin;
