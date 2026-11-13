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
 * WebGL2 Trace Renderer (`src/charts/gl-trace-renderer.ts`) with phase-wrap discontinuity handling.
 */

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
  if (v_alpha <= 0.001) discard;
  outColor = vec4(u_color.rgb, u_color.a * v_alpha);
}
`;

export function parseCssHexColor(hex: string): [number, number, number, number] {
  const clean = hex.trim().replace('#', '');
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
      1.0,
    ];
  }
  return [0.22, 0.74, 0.97, 1.0];
}

export class GlTraceRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private uColorLoc: WebGLUniformLocation | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      const gl = canvas.getContext('webgl2', {
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

  public get isAvailable(): boolean {
    return this.gl !== null;
  }

  private initGl(gl: WebGL2RenderingContext): void {
    const vs = this.compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this.compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

    this.gl = gl;
    this.program = prog;
    this.uColorLoc = gl.getUniformLocation(prog, 'u_color');
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
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

  public clear(scissorLeftPx?: number, scissorBottomPx?: number, wPx?: number, hPx?: number): void {
    const gl = this.gl;
    if (!gl) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (
      scissorLeftPx !== undefined &&
      scissorBottomPx !== undefined &&
      wPx !== undefined &&
      hPx !== undefined
    ) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(scissorLeftPx, scissorBottomPx, Math.max(1, wPx), Math.max(1, hPx));
    }
  }

  /** Draws packed `[ndcX, ndcY, alpha]` vertices as a thick screen-space line strip. */
  public drawTraceVertices(vertices: Float32Array, vertexCount: number, hexColor: string): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.vbo || vertexCount < 2) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, vertexCount * 3), gl.STREAM_DRAW);

    const [r, g, b, a] = parseCssHexColor(hexColor);
    gl.uniform4f(this.uColorLoc, r, g, b, a);
    gl.drawArrays(gl.LINE_STRIP, 0, vertexCount);
  }

  public dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}

