"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { AppBackgroundChoice } from "@/lib/domain";
import { usePersistedSettings } from "@/lib/storage/useStore";

type BackgroundProfile = "off" | "low" | "balanced";
type EffectiveBackground = Exclude<AppBackgroundChoice, "auto">;

const ThreadsBackground = dynamic(() => import("@/components/Threads"), { ssr: false });
const LightRaysBackground = dynamic(() => import("@/components/backgrounds/LightRays"), { ssr: false });
const ShapeGridBackground = dynamic(() => import("@/components/backgrounds/ShapeGrid"), { ssr: false });
const BeamsBackground = dynamic(() => import("@/components/backgrounds/Beams"), { ssr: false });

const EDITOR_ROUTE_PATTERN = /^\/(?:invoices|credit-notes|recurring|templates|products|customers)\/[^/]+/;

const THREADS_LOW_PROPS = {
  color: [0.32, 0.15, 1] as [number, number, number],
  enableMouseInteraction: false,
  pauseWhenHidden: true,
  amplitude: 0.34,
  distance: 0.85,
  lineCount: 14,
  fps: 20,
  pixelRatioCap: 1,
};

const THREADS_BALANCED_PROPS = {
  color: [0.32, 0.15, 1] as [number, number, number],
  enableMouseInteraction: false,
  pauseWhenHidden: true,
  amplitude: 0.5,
  distance: 1.1,
  lineCount: 24,
  fps: 30,
  pixelRatioCap: 1.25,
};

const LIGHT_RAYS_LOW_PROPS = {
  raysColor: "#3b82f6",
  raysSpeed: 0.24,
  lightSpread: 0.45,
  rayLength: 1.1,
  fadeDistance: 0.85,
  saturation: 0.85,
  noiseAmount: 0,
  fps: 20,
  pixelRatioCap: 1,
};

const LIGHT_RAYS_BALANCED_PROPS = {
  raysColor: "#3b82f6",
  raysSpeed: 0.36,
  lightSpread: 0.58,
  rayLength: 1.35,
  fadeDistance: 0.9,
  saturation: 0.95,
  noiseAmount: 0.04,
  fps: 24,
  pixelRatioCap: 1,
};

const SHAPE_GRID_PROPS = {
  squareSize: 58,
  speed: 0.55,
  borderColor: "rgba(59, 130, 246, 0.16)",
  hoverFillColor: "rgba(59, 130, 246, 0.07)",
  direction: "diagonal" as const,
};

const BEAMS_LOW_PROPS = {
  beamNumber: 8,
  beamWidth: 0.14,
  beamHeight: 4.8,
  speed: 0.18,
  lightColor: "#3b82f6",
  rotation: -18,
};

const BEAMS_BALANCED_PROPS = {
  beamNumber: 12,
  beamWidth: 0.18,
  beamHeight: 5.6,
  speed: 0.28,
  lightColor: "#3b82f6",
  rotation: -18,
};

function supportsWebGL(): boolean {
  if (typeof document === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function getDeviceProfile(isEditorRoute: boolean, prefersReducedMotion: boolean): BackgroundProfile {
  if (prefersReducedMotion) return "off";
  if (typeof window === "undefined") return "low";

  const electronPlatform = (
    window as Window & { electronAPI?: { platform?: string } }
  ).electronAPI?.platform;
  const isMac = electronPlatform === "darwin" || /mac/i.test(navigator.platform);
  const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowMemory = typeof deviceMemory === "number" && deviceMemory <= 4;

  if (isMac || lowCpu || lowMemory || isEditorRoute) return "low";
  return "balanced";
}

function resolveBackground(
  choice: AppBackgroundChoice,
  profile: BackgroundProfile,
  webGLAvailable: boolean
): EffectiveBackground {
  if (choice === "off" || profile === "off" || !webGLAvailable) return "off";
  if (choice !== "auto") return choice;
  return "threads";
}

export function AppBackground() {
  const pathname = usePathname();
  const { settings } = usePersistedSettings();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [webGLAvailable, setWebGLAvailable] = useState(true);

  const isEditorRoute = useMemo(() => EDITOR_ROUTE_PATTERN.test(pathname), [pathname]);
  const choice = settings?.backgroundChoice ?? "auto";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => setPrefersReducedMotion(motionQuery.matches);
    const initialSync = window.setTimeout(() => {
      setWebGLAvailable(supportsWebGL());
      syncMotionPreference();
    }, 0);

    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", syncMotionPreference);
    } else {
      motionQuery.addListener(syncMotionPreference);
    }

    return () => {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", syncMotionPreference);
      } else {
        motionQuery.removeListener(syncMotionPreference);
      }
      window.clearTimeout(initialSync);
    };
  }, []);

  const profile = useMemo(
    () => getDeviceProfile(isEditorRoute, prefersReducedMotion),
    [isEditorRoute, prefersReducedMotion]
  );

  const effectiveBackground = useMemo(
    () => resolveBackground(choice, profile, webGLAvailable),
    [choice, profile, webGLAvailable]
  );

  useEffect(() => {
    document.documentElement.dataset.background = effectiveBackground;
  }, [effectiveBackground]);

  const handleRenderError = useCallback(() => {
    setWebGLAvailable(false);
  }, []);

  if (effectiveBackground === "off") {
    return null;
  }

  const lowProfile = profile === "low";

  return (
    <div className="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden">
      <div className="h-full w-full opacity-95">
        {effectiveBackground === "threads" && (
          <ThreadsBackground
            {...(lowProfile ? THREADS_LOW_PROPS : THREADS_BALANCED_PROPS)}
            onRenderError={handleRenderError}
          />
        )}
        {effectiveBackground === "light-rays" && (
          <LightRaysBackground
            {...(lowProfile ? LIGHT_RAYS_LOW_PROPS : LIGHT_RAYS_BALANCED_PROPS)}
            onRenderError={handleRenderError}
          />
        )}
        {effectiveBackground === "shape-grid" && <ShapeGridBackground {...SHAPE_GRID_PROPS} />}
        {effectiveBackground === "beams" && (
          <BeamsBackground
            {...(lowProfile ? BEAMS_LOW_PROPS : BEAMS_BALANCED_PROPS)}
            onRenderError={handleRenderError}
          />
        )}
      </div>
    </div>
  );
}
