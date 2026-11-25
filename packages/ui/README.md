# `@foh/ui`

Shared Lit 3 dark FOH design tokens, controls, DSP chain editor, entity/source tree, accessible modal & toast overlays, and keyboard shortcut router.

## Modules

- **`styles/tokens.css.ts`**, **`styles/controls.css.ts`**, **`styles/panels.css.ts`**, **`styles/popover.css.ts`**, **`styles/topbar.css.ts`**: `--foh-*` Slate-950 design tokens, `.foh-btn*` buttons, `.foh-sr-only`, badges, swatches, `.foh-xy-grid` / `.foh-xyz-grid` coordinate grids, `.foh-form-section*` inspector cards, entity-tree styles, standalone `fohPopoverCss` anchored popovers, and the unified single-row WCO application header (`@container topbar` + `.foh-lcd`).
- **`controllers/store-subscription.ts`**, **`controllers/shell-window-controller.ts`**: Lit `ReactiveController` primitives (`StoreSubscriptionController` with `shouldProcess` / `select` slice filtering to skip redundant `25 Hz` renders, and `ShellWindowController` for `keydown`, `popstate`, passive `<input type="number">` wheel-step suppression, `matchMedia`, and PWA Window Controls Overlay).
- **`dom/download-file.ts`**: Shared `downloadTextFile` and `slugifyFilename` helpers for `.frd`, `.csv`, and `.json` exports.
- **`icons/foh-icons.ts`**: Shared rounded-square app marks and `12–16 px` `currentColor` toolbar SVG icons.
- **`overlays/foh-popover.ts`**: Native `popover="auto"` anchored disclosure helper with `@supports (position-area: block-end)` CSS Anchor Positioning, viewport-clamped fixed fallback, and recursive child Shadow Root `hasOpenPopover` detection.
- **`inspector/field-primitives.ts`**: `numVal`, `clampNum`, and `renderCoordinateGrid` for 2-column and 3-column numeric inspector fields.
- **`inspector/dsp-chain-editor.ts`**: `renderDspChainEditor` & `<foh-dsp-chain-editor>` providing Gain, Delay, Polarity, Mute, Butterworth/Linkwitz-Riley 12–48 dB/oct HPF/LPF crossovers, and multi-band Parametric EQ cards.
- **`tree/entity-tree.ts`**: `renderEntityTreeSection` & `<foh-entity-tree>` for grouped source/entity lists with visibility checkboxes or mute buttons, color swatches, and badges.
- **`overlays/foh-modal.ts`**, **`overlays/foh-help-modal.ts`** & **`overlays/foh-toast.ts`**: `<foh-modal>` dialog, `<foh-help-modal>` documentation/shortcuts/GitHub dialog (with optional `VITE_GIT_COMMIT_SHA` deployed-commit link), and `<foh-toast>` status notification banner.
- **`keyboard/shortcut-router.ts`**: `dispatchKeyboardShortcut` and `isEditableShortcutTarget` with `composedPath()` Shadow DOM input safety and `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` undo/redo handling.
