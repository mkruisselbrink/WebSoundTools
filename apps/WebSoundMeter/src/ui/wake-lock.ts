// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Automatic Screen Wake Lock controller for Live Show Mode so handheld phones and
 * propped FOH tablets do not dim or lock mid-set. Re-acquires automatically when
 * returning to the foreground tab (`visibilitychange`).
 */

export interface WakeLockSentinelLike {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
  removeEventListener?(type: 'release', listener: () => void): void;
}

export interface WakeLockApiLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface VisibilityDocumentLike {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface ScreenWakeLockOptions {
  readonly wakeLock?: WakeLockApiLike | null;
  readonly doc?: VisibilityDocumentLike | null;
  readonly onChange?: (active: boolean) => void;
}

function defaultWakeLockApi(): WakeLockApiLike | null {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return null;
  }
  return (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock ?? null;
}

function defaultVisibilityDoc(): VisibilityDocumentLike | null {
  return typeof document !== 'undefined' ? document : null;
}

export class ScreenWakeLockController {
  private readonly wakeLock: WakeLockApiLike | null;
  private readonly doc: VisibilityDocumentLike | null;
  private readonly onChange?: (active: boolean) => void;

  private desired = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private pendingRequest: Promise<void> | null = null;
  private listeningVisibility = false;

  constructor(options: ScreenWakeLockOptions = {}) {
    this.wakeLock =
      options.wakeLock !== undefined ? options.wakeLock : defaultWakeLockApi();
    this.doc = options.doc !== undefined ? options.doc : defaultVisibilityDoc();
    this.onChange = options.onChange;
  }

  get isSupported(): boolean {
    return this.wakeLock !== null;
  }

  get isActive(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.desired && this.doc?.visibilityState === 'visible') {
      void this.acquireIfNeeded();
    }
  };

  private readonly handleSentinelRelease = (): void => {
    this.sentinel = null;
    this.onChange?.(false);
  };

  async setDesired(nextDesired: boolean): Promise<void> {
    this.desired = nextDesired;
    if (nextDesired) {
      this.attachVisibilityListener();
      await this.acquireIfNeeded();
      return;
    }
    this.detachVisibilityListener();
    await this.releaseCurrent();
  }

  dispose(): void {
    this.desired = false;
    this.detachVisibilityListener();
    void this.releaseCurrent();
  }

  private attachVisibilityListener(): void {
    if (this.listeningVisibility || !this.doc) return;
    this.doc.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.listeningVisibility = true;
  }

  private detachVisibilityListener(): void {
    if (!this.listeningVisibility || !this.doc) return;
    this.doc.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.listeningVisibility = false;
  }

  private async acquireIfNeeded(): Promise<void> {
    if (!this.desired || !this.wakeLock) return;
    if (this.doc && this.doc.visibilityState !== 'visible') return;
    if (this.isActive) return;
    if (this.pendingRequest) {
      await this.pendingRequest;
      return;
    }

    const req = (async () => {
      try {
        const acquired = await this.wakeLock!.request('screen');
        if (!this.desired) {
          await acquired.release().catch(() => {});
          return;
        }
        acquired.addEventListener?.('release', this.handleSentinelRelease);
        this.sentinel = acquired;
        this.onChange?.(true);
      } catch {
        // Silently ignore rejections (e.g. OS Low Power Mode or backgrounded tab)
        this.sentinel = null;
        this.onChange?.(false);
      } finally {
        this.pendingRequest = null;
      }
    })();

    this.pendingRequest = req;
    await req;
  }

  private async releaseCurrent(): Promise<void> {
    const current = this.sentinel;
    this.sentinel = null;
    if (!current) return;
    current.removeEventListener?.('release', this.handleSentinelRelease);
    try {
      await current.release();
    } catch {
      // Ignore already-released errors
    }
    this.onChange?.(false);
  }
}
