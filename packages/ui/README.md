# `@foh/ui`

Shared Lit 3 dark FOH design tokens, controls, DSP chain editor, entity/source tree, accessible modal & toast overlays, and keyboard shortcut router.

## Modules

- **`styles/tokens.css.ts`**, **`styles/controls.css.ts`**, **`styles/panels.css.ts`**: `--foh-*` Slate-950 design tokens, buttons, badges, swatches, coordinate grids, inspector sections, and entity-tree styles.
- **`inspector/field-primitives.ts`**: `numVal`, `clampNum`, and `renderCoordinateGrid` for 2-column and 3-column numeric inspector fields.
- **`inspector/dsp-chain-editor.ts`**: `renderDspChainEditor` & `<foh-dsp-chain-editor>` providing Gain, Delay, Polarity, Mute, Butterworth/Linkwitz-Riley 12–48 dB/oct HPF/LPF crossovers, and multi-band Parametric EQ cards.
- **`tree/entity-tree.ts`**: `renderEntityTreeSection` & `<foh-entity-tree>` for grouped source/entity lists with visibility checkboxes or mute buttons, color swatches, and badges.
- **`overlays/foh-modal.ts`** & **`overlays/foh-toast.ts`**: `<foh-modal>` dialog and `<foh-toast>` status notification banner.
- **`keyboard/shortcut-router.ts`**: `dispatchKeyboardShortcut` and `isEditableShortcutTarget` with `composedPath()` Shadow DOM input safety and `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` undo/redo handling.
