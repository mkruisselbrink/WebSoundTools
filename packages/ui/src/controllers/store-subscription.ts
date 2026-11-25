// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Minimal subscribable contract satisfied by `SourceStore`, `ProjectStore`,
 * `SimulationController`, `AudioSessionController`, and `MixerWatchController`.
 */
export interface SubscribableSource<TArgs extends readonly unknown[] = readonly unknown[]> {
  subscribe(listener: (...args: TArgs) => void): () => void;
}

export interface StoreSubscriptionOptions<
  TSnapshot,
  TArgs extends readonly unknown[] = readonly unknown[],
> {
  /**
   * Optional selector returning the slice of state relevant to this component.
   * When omitted, every notification triggers `host.requestUpdate()`.
   */
  readonly select?: () => TSnapshot;
  /**
   * Optional filter on notification arguments (e.g. skipping `'live'` 25 Hz ticks
   * when a component only cares about `'authored'` or `'selection'` changes, or when
   * a modal is closed). Return `false` to ignore the notification completely.
   */
  readonly shouldProcess?: (...args: TArgs) => boolean;
  /**
   * Custom equality comparator for selected snapshots (defaults to `shallowEqual`).
   */
  readonly equals?: (a: TSnapshot, b: TSnapshot) => boolean;
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(recB, key)) return false;
    if (!Object.is(recA[key], recB[key])) return false;
  }
  return true;
}

/**
 * Lit `ReactiveController` that subscribes a custom element to a `SubscribableSource`
 * on connect, unsubscribes on disconnect, and optionally filters notifications by event
 * arguments or shallow-compared state slices to avoid redundant `25 Hz` re-renders.
 */
export class StoreSubscriptionController<
  TSnapshot = unknown,
  TArgs extends readonly unknown[] = readonly unknown[],
> implements ReactiveController
{
  private readonly host: ReactiveControllerHost;
  private source: SubscribableSource<TArgs> | null;
  private readonly options: StoreSubscriptionOptions<TSnapshot, TArgs>;
  private unsubscribe: (() => void) | null = null;
  private hasLastSnapshot = false;
  private lastSnapshot!: TSnapshot;
  private connected = false;

  constructor(
    host: ReactiveControllerHost,
    source: SubscribableSource<TArgs> | null,
    options: StoreSubscriptionOptions<TSnapshot, TArgs> = {}
  ) {
    this.host = host;
    this.source = source;
    this.options = options;
    host.addController(this);
  }

  public setSource(nextSource: SubscribableSource<TArgs> | null): void {
    if (this.source === nextSource) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.source = nextSource;
    this.hasLastSnapshot = false;
    if (this.connected && this.source) {
      this.attach();
    }
  }

  public hostConnected(): void {
    this.connected = true;
    if (this.source) {
      this.attach();
    }
  }

  public hostDisconnected(): void {
    this.connected = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.hasLastSnapshot = false;
  }

  private attach(): void {
    this.unsubscribe?.();
    if (this.options.select) {
      this.lastSnapshot = this.options.select();
      this.hasLastSnapshot = true;
    }
    this.unsubscribe =
      this.source?.subscribe((...args: TArgs) => {
        if (this.options.shouldProcess && !this.options.shouldProcess(...args)) {
          return;
        }
        if (this.options.select) {
          const next = this.options.select();
          const eq = this.options.equals ?? shallowEqual;
          if (this.hasLastSnapshot && eq(this.lastSnapshot, next)) {
            return;
          }
          this.lastSnapshot = next;
          this.hasLastSnapshot = true;
        }
        this.host.requestUpdate();
      }) ?? null;
  }
}
