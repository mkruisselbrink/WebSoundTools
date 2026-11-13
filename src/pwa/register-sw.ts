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

export interface ServiceWorkerContainerLike {
  register(
    scriptURL: string,
    options?: { scope?: string; type?: 'classic' | 'module' }
  ): Promise<unknown>;
}

export async function registerOfflineServiceWorker(
  swContainer: ServiceWorkerContainerLike | undefined = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : undefined,
  scriptUrl: string = '/sw.js'
): Promise<boolean> {
  if (!swContainer || typeof swContainer.register !== 'function') {
    return false;
  }
  try {
    await swContainer.register(scriptUrl, { scope: '/' });
    return true;
  } catch {
    return false;
  }
}

