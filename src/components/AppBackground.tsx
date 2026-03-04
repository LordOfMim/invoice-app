"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Threads from "@/components/Threads";

type BackgroundProfile = "off" | "low" | "balanced";

export function AppBackground() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<BackgroundProfile>("balanced");

  const isEditorRoute = useMemo(
    () => /^\/(?:invoices|credit-notes|recurring|templates|products|customers)\/[^/]+/.test(pathname),
    [pathname]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resolveProfile = () => {
      const electronPlatform = (
        window as Window & { electronAPI?: { platform?: string } }
      ).electronAPI?.platform;
      const isMac = electronPlatform === "darwin" || /mac/i.test(navigator.platform);
      const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;

      if (motionQuery.matches) {
        setProfile("off");
        return;
      }

      if (isMac || lowCpu || isEditorRoute) {
        setProfile("low");
        return;
      }

      setProfile("balanced");
    };

    resolveProfile();

    const onMotionChange = () => resolveProfile();
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", onMotionChange);
    } else {
      motionQuery.addListener(onMotionChange);
    }

    return () => {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", onMotionChange);
      } else {
        motionQuery.removeListener(onMotionChange);
      }
    };
  }, [isEditorRoute]);

  if (profile === "off") {
    return null;
  }

  const threadProps =
    profile === "low"
      ? {
          amplitude: 0.38,
          distance: 0.9,
          lineCount: 16,
          fps: 24,
          pixelRatioCap: 1,
        }
      : {
          amplitude: 0.5,
          distance: 1.1,
          lineCount: 24,
          fps: 30,
          pixelRatioCap: 1.25,
        };

  return (
    <div className="fixed inset-0 z-0 pointer-events-none select-none">
      <div className="h-full w-full opacity-95">
        <Threads
          color={[0.32, 0.15, 1]}
          enableMouseInteraction={false}
          pauseWhenHidden
          {...threadProps}
        />
      </div>
    </div>
  );
}
