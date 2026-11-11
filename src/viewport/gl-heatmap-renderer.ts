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

/**
 * WebGL2 Hardware-Accelerated SPL Heatmap & Isoline Renderer (`src/viewport/gl-heatmap-renderer.ts`)
 * with automatic 2D Canvas fallback when WebGL2 is unavailable.
 */

import type { ColormapConfig } from '../model/project-store.js';
import { screenToWorld, type ViewportCamera2D } from './viewport-coords.js';

export interface HeatmapGridInput {
  readonly cols: number;
  readonly rows: number;
  readonly uMin: number;
  readonly uMax: number;
  readonly vMin: number;
  readonly vMax: number;
  readonly splDb: Float32Array;
  readonly surfaceMask?: Uint8Array;
}

interface ColorStop {
  readonly t: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** High-contrast acoustic SPL false-color gradient stops (t in [0, 1]). */
const SPL_COLOR_STOPS: readonly ColorStop[] = [
  { t: 0.0, r: 10, g: 20, b: 48 },     // Deep midnight navy
  { t: 0.18, r: 14, g: 116, b: 144 },  // Teal blue
  { t: 0.36, r: 6, g: 182, b: 212 },   // Cyan
  { t: 0.52, r: 16, g: 185, b: 129 },  // Emerald green
  { t: 0.68, r: 234, g: 179, b: 8 },   // Golden yellow
  { t: 0.84, r: 249, g: 115, b: 22 },  // Bright orange
  { t: 0.95, r: 239, g: 68, b: 68 },   // Crimson red
  { t: 1.0, r: 236, g: 72, b: 153 },   // Peak magenta
];

/** Evaluates RGB [0..255] for normalized SPL t in [0, 1]. */
export function evaluateSplLutRgb(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < SPL_COLOR_STOPS.length - 1; i++) {
    const a = SPL_COLOR_STOPS[i];
    const b = SPL_COLOR_STOPS[i + 1];
    if (clamped <= b.t) {
      const f = (clamped - a.t) / Math.max(1e-6, b.t - a.t);
      return [
        Math.round(a.r + (b.r - a.r) * f),
        Math.round(a.g + (b.g - a.g) * f),
        Math.round(a.b + (b.b - a.b) * f),
      ];
    }
  }
  const last = SPL_COLOR_STOPS[SPL_COLOR_STOPS.length - 1];
  return [last.r, last.g, last.b];
}

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
const vec2 POS[4] = vec2[4](
  vec2(-1.0, -1.0),
  vec2( 1.0, -1.0),
  vec2(-1.0,  1.0),
  vec2( 1.0,  1.0)
);
out vec2 v_ndc;
void main() {
  v_ndc = POS[gl_VertexID];
  gl_Position = vec4(v_ndc, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_ndc;
out vec4 outColor;

uniform sampler2D u_splTex;
uniform sampler2D u_maskTex;
uniform sampler2D u_lutTex;

uniform vec2 u_viewportPx;    // CSS width, height
uniform vec3 u_camera;        // centerX, centerV, pixelsPerMeter
uniform vec4 u_gridBounds;    // uMin, uMax, vMin, vMax
uniform vec2 u_gridDims;      // cols, rows
uniform vec4 u_colorCfg;      // minSplDb, maxSplDb, isolineStepDb, showOutsideSurfaces
uniform float u_hasMask;

float sampleSplBilinear(vec2 uv) {
  vec2 maxIdx = u_gridDims - vec2(1.0);
  vec2 fCoord = clamp(uv, 0.0, 1.0) * maxIdx;
  vec2 i0 = floor(fCoord);
  vec2 i1 = min(i0 + vec2(1.0), maxIdx);
  vec2 t = fCoord - i0;

  ivec2 p00 = ivec2(i0);
  ivec2 p10 = ivec2(i1.x, i0.y);
  ivec2 p01 = ivec2(i0.x, i1.y);
  ivec2 p11 = ivec2(i1);

  float v00 = texelFetch(u_splTex, p00, 0).r;
  float v10 = texelFetch(u_splTex, p10, 0).r;
  float v01 = texelFetch(u_splTex, p01, 0).r;
  float v11 = texelFetch(u_splTex, p11, 0).r;

  float top = mix(v00, v10, t.x);
  float bot = mix(v01, v11, t.x);
  return mix(top, bot, t.y);
}

void main() {
  // Convert NDC [-1, 1] to CSS screen coordinates (px right, py down)
  vec2 screenPx = vec2(
    (v_ndc.x * 0.5 + 0.5) * u_viewportPx.x,
    (0.5 - v_ndc.y * 0.5) * u_viewportPx.y
  );

  vec2 worldUV = vec2(
    u_camera.x + (screenPx.x - u_viewportPx.x * 0.5) / u_camera.z,
    u_camera.y - (screenPx.y - u_viewportPx.y * 0.5) / u_camera.z
  );

  if (worldUV.x < u_gridBounds.x || worldUV.x > u_gridBounds.y ||
      worldUV.y < u_gridBounds.z || worldUV.y > u_gridBounds.w) {
    outColor = vec4(0.024, 0.035, 0.067, 1.0);
    return;
  }

  vec2 gridUv = vec2(
    (worldUV.x - u_gridBounds.x) / max(1e-5, u_gridBounds.y - u_gridBounds.x),
    (worldUV.y - u_gridBounds.z) / max(1e-5, u_gridBounds.w - u_gridBounds.z)
  );

  float spl = sampleSplBilinear(gridUv);
  if (spl <= -110.0) {
    outColor = vec4(0.024, 0.035, 0.067, 1.0);
    return;
  }

  float maskVal = 1.0;
  if (u_hasMask > 0.5) {
    ivec2 mCoord = ivec2(clamp(round(gridUv * (u_gridDims - vec2(1.0))), vec2(0.0), u_gridDims - vec2(1.0)));
    float rawMask = texelFetch(u_maskTex, mCoord, 0).r * 255.0;
    if (rawMask < 0.5) {
      maskVal = u_colorCfg.w > 0.5 ? 0.52 : 0.08;
    } else if (rawMask > 1.5) {
      maskVal = 0.78; // Stage surface
    } else {
      maskVal = 0.94; // Audience surface
    }
  } else {
    maskVal = 0.88;
  }

  float normT = clamp((spl - u_colorCfg.x) / max(1.0, u_colorCfg.y - u_colorCfg.x), 0.0, 1.0);
  vec3 lutRgb = texture(u_lutTex, vec2(normT, 0.5)).rgb;

  // Anti-aliased isoline contours via fwidth
  float isoStep = u_colorCfg.z;
  float contourMix = 0.0;
  if (isoStep > 0.5) {
    float scaled = spl / isoStep;
    float distToLine = abs(fract(scaled + 0.5) - 0.5);
    float fw = max(1e-4, fwidth(scaled));
    contourMix = 1.0 - smoothstep(0.0, fw * 1.35, distToLine);
  }

  vec3 bg = vec3(0.024, 0.035, 0.067);
  vec3 baseColor = mix(bg, lutRgb, maskVal);
  vec3 finalRgb = mix(baseColor, vec3(0.04, 0.06, 0.10), contourMix * 0.55 * maskVal);
  outColor = vec4(finalRgb, 1.0);
}
`;

export class GlHeatmapRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private splTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;

  private uniforms: {
    viewportPx: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    gridBounds: WebGLUniformLocation | null;
    gridDims: WebGLUniformLocation | null;
    colorCfg: WebGLUniformLocation | null;
    hasMask: WebGLUniformLocation | null;
  } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      });
      if (gl) {
        this.initGl(gl);
      }
    } catch {
      this.gl = null;
    }

    if (!this.gl) {
      try {
        this.fallbackCtx = canvas.getContext('2d');
      } catch {
        this.fallbackCtx = null;
      }
    }
  }

  private initGl(gl: WebGL2RenderingContext): void {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return;
    }

    this.gl = gl;
    this.program = prog;
    this.vao = gl.createVertexArray();

    // Build 256x1 RGBA8 LUT texture
    const lutBytes = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = evaluateSplLutRgb(i / 255);
      lutBytes[i * 4] = r;
      lutBytes[i * 4 + 1] = g;
      lutBytes[i * 4 + 2] = b;
      lutBytes[i * 4 + 3] = 255;
    }
    this.lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutBytes);

    this.splTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.splTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_splTex'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_maskTex'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_lutTex'), 2);

    this.uniforms = {
      viewportPx: gl.getUniformLocation(prog, 'u_viewportPx'),
      camera: gl.getUniformLocation(prog, 'u_camera'),
      gridBounds: gl.getUniformLocation(prog, 'u_gridBounds'),
      gridDims: gl.getUniformLocation(prog, 'u_gridDims'),
      colorCfg: gl.getUniformLocation(prog, 'u_colorCfg'),
      hasMask: gl.getUniformLocation(prog, 'u_hasMask'),
    };
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    src: string
  ): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  public render(
    grid: HeatmapGridInput | null,
    camera: ViewportCamera2D,
    colormap: ColormapConfig,
    cssWidth: number,
    cssHeight: number
  ): void {
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const gl = this.gl;
    if (gl && this.program && this.uniforms) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.024, 0.035, 0.067, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (!grid || grid.cols < 2 || grid.rows < 2) {
        return;
      }

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.splTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        grid.cols,
        grid.rows,
        0,
        gl.RED,
        gl.FLOAT,
        grid.splDb
      );

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      if (grid.surfaceMask) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R8,
          grid.cols,
          grid.rows,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          grid.surfaceMask
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R8,
          1,
          1,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          new Uint8Array([1])
        );
      }

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);

      gl.uniform2f(this.uniforms.viewportPx, cssWidth, cssHeight);
      gl.uniform3f(this.uniforms.camera, camera.centerX, camera.centerV, camera.pixelsPerMeter);
      gl.uniform4f(
        this.uniforms.gridBounds,
        grid.uMin,
        grid.uMax,
        grid.vMin,
        grid.vMax
      );
      gl.uniform2f(this.uniforms.gridDims, grid.cols, grid.rows);
      gl.uniform4f(
        this.uniforms.colorCfg,
        colormap.minSplDb,
        colormap.maxSplDb,
        colormap.isolineStepDb,
        colormap.showOutsideSurfaces ? 1.0 : 0.0
      );
      gl.uniform1f(this.uniforms.hasMask, grid.surfaceMask ? 1.0 : 0.0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    // 2D Canvas fallback
    const ctx = this.fallbackCtx;
    if (!ctx) return;
    ctx.fillStyle = '#060911';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!grid || grid.cols < 2 || grid.rows < 2) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const dprX = w / cssWidth;
    const dprY = h / cssHeight;
    const img = ctx.createImageData(w, h);
    const data = img.data;

    for (let py = 0; py < h; py += 2) {
      const cssY = py / dprY;
      for (let px = 0; px < w; px += 2) {
        const cssX = px / dprX;
        const world = screenToWorld(camera, cssWidth, cssHeight, cssX, cssY);
        if (
          world.u < grid.uMin ||
          world.u > grid.uMax ||
          world.v < grid.vMin ||
          world.v > grid.vMax
        ) {
          continue;
        }
        const gx = Math.round(
          ((world.u - grid.uMin) / (grid.uMax - grid.uMin)) * (grid.cols - 1)
        );
        const gy = Math.round(
          ((world.v - grid.vMin) / (grid.vMax - grid.vMin)) * (grid.rows - 1)
        );
        const spl = grid.splDb[gy * grid.cols + gx];
        const t = (spl - colormap.minSplDb) / Math.max(1, colormap.maxSplDb - colormap.minSplDb);
        const [r, g, b] = evaluateSplLutRgb(t);
        for (let dy = 0; dy < 2 && py + dy < h; dy++) {
          for (let dx = 0; dx < 2 && px + dx < w; dx++) {
            const idx = ((py + dy) * w + (px + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 220;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  public dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.splTex) gl.deleteTexture(this.splTex);
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    if (this.lutTex) gl.deleteTexture(this.lutTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}
