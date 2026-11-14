// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * WebGL2 shader compilation, program linking, and texture parameter helpers.
 */

export function compileGlShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader?.(shader);
    return null;
  }
  return shader;
}

export function createGlProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram | null {
  const vs = compileGlShader(gl, gl.VERTEX_SHADER, vertexSource);
  if (!vs) return null;
  const fs = compileGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!fs) {
    gl.deleteShader?.(vs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader?.(vs);
    gl.deleteShader?.(fs);
    return null;
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader?.(vs);
  gl.deleteShader?.(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram?.(program);
    return null;
  }

  return program;
}

export function createClampedTexture2D(
  gl: WebGL2RenderingContext,
  filter: number
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
