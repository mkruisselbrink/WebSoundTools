// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * WebGL2 hardware-accelerated continuous `LINE_STRIP` trace renderer with
 * per-vertex coherence alpha blending and zero-alpha discontinuity discard.
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
    opacity: number = 1.0
  ): void {
    if (!this.gl || !this.program || !this.vao || !this.vbo || vertexCount < 2) {
      return;
    }
    const gl = this.gl;
    const [r, g, b, a] = parseCssColorToRgba(colorCss);

    gl.useProgram(this.program);
    gl.uniform4f(this.uColorLoc, r, g, b, a * opacity);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, vertexCount * 3), gl.STREAM_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, vertexCount);
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
