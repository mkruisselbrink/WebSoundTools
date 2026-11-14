// Copyright (C) 2026 WebSoundTools Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
  compileGlShader,
  createClampedTexture2D,
  createGlProgram,
} from './gl-shader-utils.js';

function createMockGl(options?: { compileOk?: boolean; linkOk?: boolean }) {
  const compileOk = options?.compileOk ?? true;
  const linkOk = options?.linkOk ?? true;
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    TEXTURE_2D: 3553,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    LINEAR: 9729,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compileOk),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => linkOk),
    deleteProgram: vi.fn(),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}

describe('gl-shader-utils', () => {
  it('compiles shaders and links programs, cleaning up transient shader handles', () => {
    const gl = createMockGl();
    const prog = createGlProgram(gl, 'void main(){}', 'void main(){}');
    expect(prog).not.toBeNull();
    expect(gl.attachShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('cleans up shaders and programs when compilation or linking fails', () => {
    const failCompileGl = createMockGl({ compileOk: false });
    expect(compileGlShader(failCompileGl, failCompileGl.VERTEX_SHADER, 'bad')).toBeNull();
    expect(failCompileGl.deleteShader).toHaveBeenCalledTimes(1);

    const failLinkGl = createMockGl({ compileOk: true, linkOk: false });
    expect(createGlProgram(failLinkGl, 'vs', 'fs')).toBeNull();
    expect(failLinkGl.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it('creates clamped 2D textures with the requested min/mag filter', () => {
    const gl = createMockGl();
    const tex = createClampedTexture2D(gl, gl.LINEAR);
    expect(tex).not.toBeNull();
    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, tex);
    expect(gl.texParameteri).toHaveBeenCalledTimes(4);
  });
});
