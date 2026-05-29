"use client";

import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle, Color } from "ogl";

type LightRaysProps = {
  raysColor?: string;
  raysSpeed?: number;
  lightSpread?: number;
  rayLength?: number;
  fadeDistance?: number;
  saturation?: number;
  noiseAmount?: number;
  pixelRatioCap?: number;
  fps?: number;
  onRenderError?: () => void;
};

const vertex = `
attribute vec2 position;
varying vec2 vUv;

void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColor;
uniform float uSpread;
uniform float uLength;
uniform float uFade;
uniform float uSaturation;
uniform float uNoise;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float beam(vec2 uv, float angle, float width, float phase) {
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 origin = vec2(0.5, 1.05);
  vec2 rel = uv - origin;
  float along = max(dot(rel, dir), 0.0);
  float across = abs(rel.x * dir.y - rel.y * dir.x);
  float shape = smoothstep(width, 0.0, across);
  float reach = smoothstep(0.0, 0.18, along) * smoothstep(uLength, 0.0, along);
  float ripple = 0.78 + 0.22 * sin(along * 24.0 - phase);
  return shape * reach * ripple;
}

void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);
  uv.x -= (uResolution.x / max(uResolution.y, 1.0) - 1.0) * 0.5;

  float t = uTime;
  float spread = max(uSpread, 0.12);
  float rays = 0.0;
  rays += beam(uv, 1.36 - spread * 0.35, 0.030, t * 1.2);
  rays += beam(uv, 1.57, 0.045, t * 1.0 + 1.7);
  rays += beam(uv, 1.78 + spread * 0.35, 0.028, t * 1.4 + 2.4);
  rays += beam(uv, 1.15 - spread * 0.15, 0.020, t * 0.9 + 4.0) * 0.6;
  rays += beam(uv, 1.98 + spread * 0.15, 0.020, t * 1.1 + 5.0) * 0.6;

  float verticalFade = smoothstep(1.0, 1.0 - uFade, vUv.y);
  float n = hash(floor(gl_FragCoord.xy * 0.5) + floor(t * 12.0));
  float intensity = rays * verticalFade + (n - 0.5) * uNoise * 0.08;
  vec3 color = mix(vec3(dot(uColor, vec3(0.299, 0.587, 0.114))), uColor, uSaturation);
  gl_FragColor = vec4(color * intensity, clamp(intensity, 0.0, 0.55));
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "").trim();
  const normalized = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value.padEnd(6, "f").slice(0, 6);
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

export default function LightRays({
  raysColor = "#3b82f6",
  raysSpeed = 0.35,
  lightSpread = 0.55,
  rayLength = 1.35,
  fadeDistance = 0.9,
  saturation = 0.95,
  noiseAmount = 0.05,
  pixelRatioCap = 1,
  fps = 24,
  onRenderError,
}: LightRaysProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    let renderer: Renderer | null = null;
    let resizeObserver: ResizeObserver | null = null;

    try {
      renderer = new Renderer({
        alpha: true,
        dpr: Math.min(window.devicePixelRatio || 1, Math.max(1, pixelRatioCap)),
      });
    } catch {
      onRenderError?.();
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    container.appendChild(gl.canvas);

    const color = hexToRgb(raysColor);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Float32Array([1, 1]) },
        uColor: { value: new Color(...color) },
        uSpread: { value: lightSpread },
        uLength: { value: rayLength },
        uFade: { value: fadeDistance },
        uSaturation: { value: saturation },
        uNoise: { value: noiseAmount },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      if (!renderer) return;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value[0] = width;
      program.uniforms.uResolution.value[1] = height;
    };

    resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    else window.addEventListener("resize", resize);
    resize();

    const frameDelay = Math.max(16, 1000 / Math.max(1, fps));
    const render = (time: number) => {
      program.uniforms.uTime.value = time * 0.001 * raysSpeed;
      renderer?.render({ scene: mesh });
      timeoutRef.current = window.setTimeout(() => {
        frameRef.current = requestAnimationFrame(render);
      }, frameDelay);
    };

    const start = () => {
      if (frameRef.current !== null || document.hidden) return;
      frameRef.current = requestAnimationFrame(render);
    };

    const stop = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      frameRef.current = null;
      timeoutRef.current = null;
    };

    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", stop);
    window.addEventListener("focus", start);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", start);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", resize);
      if (container.contains(gl.canvas)) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [
    fadeDistance,
    fps,
    lightSpread,
    noiseAmount,
    onRenderError,
    pixelRatioCap,
    rayLength,
    raysColor,
    raysSpeed,
    saturation,
  ]);

  return <div ref={containerRef} className="h-full w-full" />;
}
