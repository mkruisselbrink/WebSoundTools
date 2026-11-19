// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * WebGL2 hardware-accelerated screen-space variable-width ribbon (`TRIANGLES`) trace renderer
 * with per-vertex coherence alpha blending and zero-alpha discontinuity breaks.
 */

import { createGlProgram, parseCssColorToRgba } from '@foh/canvas';

const VERTEX_SHADER_SRC = `#version 300 es
layout(location = 0) in vec3 a_posAlpha;
out float v_alpha;

void main() {
  gl_Position = vec4(a_posAlpha.xy, 0.0, 1.0);
  v_alpha = a_posAlpha.z;
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;
uniform vec4 u_color;
in float v_alpha;
out vec4 outColor;

void main() {
  if (v_alpha <= 0.001) {
    discard;
  }
  outColor = vec4(u_color.rgb, u_color.a * v_alpha);
}
`;

export class GlTraceRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private uColorLoc: WebGLUniformLocation | null = null;
  private viewportWidthPx = 1;
  private viewportHeightPx = 1;
  private quadScratch = new Float32Array(4096 * 18);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.reinitialize();
  }

  public reinitialize(): void {
    this.dispose();
    try {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      if (gl) {
        this.initGl(gl);
      }
    } catch {
      this.gl = null;
    }
  }

  private initGl(gl: WebGL2RenderingContext): void {
    const prog = createGlProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
    if (!prog) return;

    this.gl = gl;
    this.program = prog;
    this.uColorLoc = gl.getUniformLocation(prog, 'u_color');
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 3 * Float32Array.BYTES_PER_ELEMENT, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  public isWebGlAvailable(): boolean {
    return this.gl !== null && this.program !== null;
  }

  /**
   * Clears the full canvas and locks the WebGL viewport and scissor box to the plot region
   * so plot-local NDC `[-1, +1]` vertices map directly onto the plot area.
   */
  public clear(
    plotLeftPx: number,
    plotTopPx: number,
    plotWidthPx: number,
    plotHeightPx: number,
    canvasHeightPx: number
  ): void {
    if (!this.gl) return;
    const gl = this.gl;
    const yBottom = Math.round(canvasHeightPx - plotTopPx - plotHeightPx);
    const left = Math.round(plotLeftPx);
    const w = Math.max(1, Math.round(plotWidthPx));
    const h = Math.max(1, Math.round(plotHeightPx));
    this.viewportWidthPx = w;
    this.viewportHeightPx = h;

    if (typeof gl.disable === 'function') {
      gl.disable(gl.SCISSOR_TEST);
    }
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.viewport(left, yBottom, w, h);
    if (typeof gl.scissor === 'function') {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(left, yBottom, w, h);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  public drawTrace(
    vertices: Float32Array,
    vertexCount: number,
    colorCss: string,
    opacity: number = 1.0,
    lineWidthPx: number = 3.5
  ): void {
    if (!this.gl || !this.program || !this.vao || !this.vbo || vertexCount < 2) {
      return;
    }
    const gl = this.gl;
    const wPx = Math.max(1, this.viewportWidthPx || this.canvas.width || 1);
    const hPx = Math.max(1, this.viewportHeightPx || this.canvas.height || 1);
    const halfWidthPx = Math.max(0.5, lineWidthPx * 0.5);

    const neededFloats = (vertexCount - 1) * 18;
    if (this.quadScratch.length < neededFloats) {
      this.quadScratch = new Float32Array(neededFloats);
    }
    const out = this.quadScratch;
    let ptr = 0;

    for (let i = 0; i < vertexCount - 1; i++) {
      const base0 = i * 3;
      const base1 = base0 + 3;
      const a0 = vertices[base0 + 2];
      const a1 = vertices[base1 + 2];
      if (a0 <= 0.001 || a1 <= 0.001) {
        continue;
      }

      const x0 = vertices[base0];
      const y0 = vertices[base0 + 1];
      const x1 = vertices[base1];
      const y1 = vertices[base1 + 1];

      const dxPx = (x1 - x0) * 0.5 * wPx;
      const dyPx = (y1 - y0) * 0.5 * hPx;
      const lenPx = Math.hypot(dxPx, dyPx);
      if (lenPx < 1e-4) {
        continue;
      }

      const nxPx = (-dyPx / lenPx) * halfWidthPx;
      const nyPx = (dxPx / lenPx) * halfWidthPx;
      const ox = (nxPx * 2.0) / wPx;
      const oy = (nyPx * 2.0) / hPx;

      out[ptr++] = x0 + ox;
      out[ptr++] = y0 + oy;
      out[ptr++] = a0;

      out[ptr++] = x0 - ox;
      out[ptr++] = y0 - oy;
      out[ptr++] = a0;

      out[ptr++] = x1 + ox;
      out[ptr++] = y1 + oy;
      out[ptr++] = a1;

      out[ptr++] = x1 + ox;
      out[ptr++] = y1 + oy;
      out[ptr++] = a1;

      out[ptr++] = x0 - ox;
      out[ptr++] = y0 - oy;
      out[ptr++] = a0;

      out[ptr++] = x1 - ox;
      out[ptr++] = y1 - oy;
      out[ptr++] = a1;
    }

    const triVertCount = ptr / 3;
    if (triVertCount === 0) {
      return;
    }

    const [r, g, b, a] = parseCssColorToRgba(colorCss);

    gl.useProgram(this.program);
    gl.uniform4f(this.uColorLoc, r, g, b, a * opacity);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, ptr), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, triVertCount);
    gl.bindVertexArray(null);
  }

  public dispose(): void {
    if (!this.gl) return;
    const gl = this.gl;
    if (this.vbo) {
      gl.deleteBuffer?.(this.vbo);
      this.vbo = null;
    }
    if (this.vao) {
      gl.deleteVertexArray?.(this.vao);
      this.vao = null;
    }
    if (this.program) {
      gl.deleteProgram?.(this.program);
      this.program = null;
    }
    this.uColorLoc = null;
    this.gl = null;
  }
}
