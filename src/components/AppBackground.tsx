"use client";

import FloatingLines from "@/components/FloatingLines";
import Threads from "@/components/Threads";

export function AppBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none select-none">
      <div className="h-full w-full opacity-100">
        <Threads
            color={[0.32,0.15,1]}
            amplitude={0.6}
            distance={1.2}
            enableMouseInteraction={false}
        />
      </div>
    </div>
  );
}
