// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

export type UndoStoreListener<T> = (state: T, isInteractive: boolean) => void;

export interface ReactiveUndoStoreOptions {
  readonly maxHistory?: number;
  readonly coalesceWindowMs?: number;
  readonly now?: () => number;
}

/**
 * Headless immutable-state container with 60-deep transaction-coalesced Undo/Redo history.
 *
 * Consecutive `update(..., txKey)` calls sharing a non-empty `txKey` within `coalesceWindowMs`
 * (default 800 ms) coalesce into a single Undo snapshot while firing live interactive updates.
 */
export class ReactiveUndoStore<T> {
  private currentState: T;
  private readonly undoStack: T[] = [];
  private readonly redoStack: T[] = [];
  private readonly maxHistory: number;
  private readonly coalesceWindowMs: number;
  private readonly now: () => number;

  private activeTransactionKey: string | null = null;
  private lastTransactionTimeMs = 0;
  private readonly listeners = new Set<UndoStoreListener<T>>();

  constructor(initialState: T, options: ReactiveUndoStoreOptions = {}) {
    this.currentState = initialState;
    this.maxHistory = options.maxHistory ?? 60;
    this.coalesceWindowMs = options.coalesceWindowMs ?? 800;
    this.now = options.now ?? (() => performance.now());
  }

  public get state(): T {
    return this.currentState;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public subscribe(listener: UndoStoreListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public endTransaction(): void {
    this.activeTransactionKey = null;
  }

  public update(updater: (prev: T) => T, transactionKey?: string): boolean {
    const next = updater(this.currentState);
    if (next === this.currentState) return false;

    const nowMs = this.now();
    const isCoalesced =
      Boolean(transactionKey) &&
      transactionKey === this.activeTransactionKey &&
      nowMs - this.lastTransactionTimeMs < this.coalesceWindowMs;

    if (!isCoalesced) {
      this.undoStack.push(this.currentState);
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      this.redoStack.length = 0;
      this.activeTransactionKey = transactionKey ?? null;
    }

    if (transactionKey) {
      this.lastTransactionTimeMs = nowMs;
    }

    this.currentState = next;
    this.emit(Boolean(transactionKey));
    return true;
  }

  public replace(nextState: T, recordUndo: boolean = false): void {
    if (recordUndo) {
      this.undoStack.push(this.currentState);
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
    } else {
      this.undoStack.length = 0;
    }
    this.redoStack.length = 0;
    this.activeTransactionKey = null;
    this.currentState = nextState;
    this.emit(false);
  }

  public undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.currentState);
    this.activeTransactionKey = null;
    this.currentState = prev;
    this.emit(false);
    return true;
  }

  public redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.currentState);
    this.activeTransactionKey = null;
    this.currentState = next;
    this.emit(false);
    return true;
  }

  private emit(isInteractive: boolean): void {
    for (const fn of this.listeners) {
      fn(this.currentState, isInteractive);
    }
  }
}
