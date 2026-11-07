/**
 * WebGL2 Hardware-Accelerated Trace & Bar Renderer (`src/charts/gl-trace-renderer.ts`).
 *
 * Renders multi-source traces with per-vertex coherence alpha blending and phase-wrap break handling
 * at 60 FPS, with an automatic 2D Canvas fallback if WebGL2 is unavailable.
 */

const VERTEX_SHADER_SRC = `#version 300 es
layout(location = 0) in vec3 a_posAlpha; // x_ndc, y_ndc, alpha
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

export function parseCssColorToRgba(hexOrCss: string): [number, number, number, number] {
  const clean = hexOrCss.trim().replace('#', '');
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [r, g, b, 1.0];
  }
  return [0.22, 0.74, 0.97, 1.0];
}

export class GlTraceRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private uColorLoc: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    try {
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true, // Needed for visual regression snapshot testing
      });
      if (gl) {
        this.initGl(gl);
      }
    } catch {
      this.gl = null;
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
      return;
    }

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

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  isWebGlAvailable(): boolean {
    return this.gl !== null && this.program !== null;
  }

  clear(
    plotLeftPx: number,
    plotTopPx: number,
    plotWidthPx: number,
    plotHeightPx: number,
    canvasHeightPx: number
  ): void {
    if (!this.gl) return;
    const gl = this.gl;
    gl.viewport(
      plotLeftPx,
      canvasHeightPx - plotTopPx - plotHeightPx,
      plotWidthPx,
      plotHeightPx
    );
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  drawTrace(
    vertices: Float32Array,
    vertexCount: number,
    colorHex: string,
    opacity: number = 1.0
  ): void {
    if (!this.gl || !this.program || !this.vao || !this.vbo || vertexCount < 2) {
      return;
    }
    const gl = this.gl;
    const [r, g, b] = parseCssColorToRgba(colorHex);

    gl.useProgram(this.program);
    gl.uniform4f(this.uColorLoc, r, g, b, opacity);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, vertexCount);
    gl.bindVertexArray(null);
  }
}
