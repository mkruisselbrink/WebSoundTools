// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Native HTML `popover="auto"` helpers with CSS Anchor Positioning progressive enhancement
 * and a lightweight viewport-clamped `position: fixed` fallback.
 */

export interface PopoverParentRootLike {
  querySelector(selector: string): Element | null;
}

export function hasOpenPopover(root: PopoverParentRootLike | null | undefined): boolean {
  return Boolean(root?.querySelector('[popover][data-open]'));
}

export function closePopoverById(
  root: PopoverParentRootLike | null | undefined,
  popoverId: string
): void {
  const pop = root?.querySelector(`#${popoverId}`) as HTMLElement | null;
  const trigger = root?.querySelector(
    `[data-popover-trigger="${popoverId}"]`
  ) as HTMLElement | null;
  if (pop) {
    toggleAnchoredPopover(trigger, pop, false);
  }
}

/**
 * Opens or toggles a `popover="auto"` element anchored to `triggerEl`.
 * Passes `{ source: triggerEl }` when supported so programmatic opens (e.g. clicking a canvas
 * colormap legend bar) establish an implicit CSS Anchor Positioning association.
 */
export function toggleAnchoredPopover(
  triggerEl: HTMLElement | null,
  popoverEl: HTMLElement | null,
  forceOpen?: boolean
): void {
  if (!popoverEl) return;
  const pop = popoverEl as HTMLElement & {
    matches?: (sel: string) => boolean;
    showPopover?: (opts?: { source?: HTMLElement }) => void;
    hidePopover?: () => void;
  };

  let isOpen = false;
  try {
    isOpen = Boolean(pop.matches?.(':popover-open'));
  } catch {
    isOpen = popoverEl.hasAttribute('data-open');
  }

  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;

  if (typeof pop.showPopover === 'function' && typeof pop.hidePopover === 'function') {
    if (shouldOpen && !isOpen) {
      try {
        if (triggerEl) {
          pop.showPopover({ source: triggerEl });
        } else {
          pop.showPopover();
        }
      } catch {
        pop.showPopover();
      }
      positionPopoverFallback(triggerEl, popoverEl);
    } else if (!shouldOpen && isOpen) {
      pop.hidePopover();
    }
    return;
  }

  // Headless / non-Popover test fallback
  popoverEl.toggleAttribute('data-open', shouldOpen);
  triggerEl?.setAttribute('aria-expanded', String(shouldOpen));
}

/**
 * Positions `popoverEl` below `triggerEl` (clamped to viewport bounds and flipping upward if needed)
 * whenever CSS Anchor Positioning (`position-area: block-end`) is unavailable.
 */
export function positionPopoverFallback(
  triggerEl: HTMLElement | null,
  popoverEl: HTMLElement | null
): void {
  if (!triggerEl || !popoverEl || typeof window === 'undefined') return;
  if (typeof CSS !== 'undefined' && CSS.supports?.('position-area', 'block-end')) {
    return;
  }
  const t = triggerEl.getBoundingClientRect();
  const m = popoverEl.getBoundingClientRect();
  const gap = 5;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const fitsBelow = t.bottom + gap + m.height <= vh - 8;
  const top = fitsBelow ? t.bottom + gap : Math.max(8, t.top - gap - m.height);
  const left = Math.max(8, Math.min(t.left, vw - m.width - 8));
  popoverEl.style.top = `${Math.round(top)}px`;
  popoverEl.style.left = `${Math.round(left)}px`;
}

/**
 * Capturing or element-level `toggle` event handler that keeps `aria-expanded` on the matching
 * `[data-popover-trigger="<id>"]` button synchronized and applies fallback coordinates on open.
 */
export function syncAnchoredPopoverToggle(ev: Event, root: PopoverParentRootLike): void {
  const popoverEl = ev.currentTarget as HTMLElement | null;
  if (!popoverEl || !popoverEl.id) return;

  const newState = (ev as Event & { newState?: string }).newState;
  const isOpen = newState ? newState === 'open' : popoverEl.hasAttribute('data-open');
  popoverEl.toggleAttribute('data-open', isOpen);

  const triggerEl = root.querySelector(
    `[data-popover-trigger="${popoverEl.id}"]`
  ) as HTMLElement | null;
  if (triggerEl) {
    triggerEl.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      positionPopoverFallback(triggerEl, popoverEl);
    }
  }
}
