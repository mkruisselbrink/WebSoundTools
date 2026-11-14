# `@foh/canvas`

Dual-layer HiDPI WebGL2 + 2D Canvas lifecycle controller, shader compilation helpers, and colormap LUT utilities for Lit 3 components.

## Modules

- **`dual-canvas-controller.ts`**: `DualCanvasController` (`ReactiveController`) managing a stacked WebGL2 underlay + 2D overlay canvas stage with `ResizeObserver` sizing, DPR capping (`maxDevicePixelRatio`), `requestAnimationFrame` repaint coalescing, and `webglcontextlost` / `webglcontextrestored` recovery.
- **`gl-shader-utils.ts`**: `compileGlShader`, `createGlProgram`, and `createClampedTexture2D` helpers with automatic shader handle cleanup.
- **`color-rgba.ts`**: `parseCssColorToRgba`, `evaluateColorStopsRgb`, and `buildRgbaLutBytes` for WebGL uniform colors and 1D RGBA8 colormap lookup textures.
