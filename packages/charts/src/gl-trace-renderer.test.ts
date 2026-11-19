// Copyright (C) 2026 WebSoundTools Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { GlTraceRenderer } from './gl-trace-renderer.js';

describe('GlTraceRenderer', () => {
  it('handles unavailable WebGL2 contexts cleanly', () => {
    const nullCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    const renderer = new GlTraceRenderer(nullCanvas);
    expect(renderer.isWebGlAvailable()).toBe(false);
    renderer.clear(0, 0, 100, 100, 100);
    renderer.drawTrace(new Float32Array([0, 0, 1, 1, 1, 1]), 2, '#10b981');
    renderer.dispose();
  });

  it('scissors to plot region, extrudes screen-space quad strips, and disposes resources', () => {
    const mockGl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      FLOAT: 5126,
      BLEND: 3042,
      SCISSOR_TEST: 3089,
      SRC_ALPHA: 770,
      ONE_MINUS_SRC_ALPHA: 771,
      COLOR_BUFFER_BIT: 16384,
      STREAM_DRAW: 35040,
      TRIANGLES: 4,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      deleteProgram: vi.fn(),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      getUniformLocation: vi.fn(() => ({})),
      createVertexArray: vi.fn(() => ({})),
      deleteVertexArray: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      deleteBuffer: vi.fn(),
      bindVertexArray: vi.fn(),
      bindBuffer: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      blendFunc: vi.fn(),
      viewport: vi.fn(),
      scissor: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      useProgram: vi.fn(),
      uniform4f: vi.fn(),
      bufferData: vi.fn(),
      drawArrays: vi.fn(),
    };
    const glCanvas = {
      width: 500,
      height: 300,
      getContext: () => mockGl,
    } as unknown as HTMLCanvasElement;

    const renderer = new GlTraceRenderer(glCanvas);
    expect(renderer.isWebGlAvailable()).toBe(true);

    renderer.clear(52, 12, 400, 200, 300);
    expect(mockGl.viewport).toHaveBeenLastCalledWith(52, 88, 400, 200);
    expect(mockGl.scissor).toHaveBeenCalledWith(52, 88, 400, 200);

    // Two valid segments separated by a zero-alpha phase-wrap break -> 2 quads = 12 triangle vertices
    const verts = new Float32Array([
      -1, 0, 1,
      0, 0.2, 1,
      0, 0.2, 0,
      0.1, -0.2, 0,
      0.1, -0.2, 1,
      1, 0, 1,
    ]);
    renderer.drawTrace(verts, 6, '#10b981', 0.9, 4.0);
    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.TRIANGLES, 0, 12);

    renderer.dispose();
    expect(mockGl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(renderer.isWebGlAvailable()).toBe(false);
  });
});
