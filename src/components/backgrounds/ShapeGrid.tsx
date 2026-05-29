"use client";

import { memo } from "react";
import type { CSSProperties } from "react";

type ShapeGridProps = {
  squareSize?: number;
  speed?: number;
  borderColor?: string;
  hoverFillColor?: string;
  direction?: "diagonal" | "up" | "right" | "down" | "left";
};

function ShapeGrid({
  squareSize = 56,
  speed = 0.45,
  borderColor = "rgba(59, 130, 246, 0.18)",
  hoverFillColor = "rgba(59, 130, 246, 0.08)",
  direction = "diagonal",
}: ShapeGridProps) {
  const angle =
    direction === "up"
      ? "0deg"
      : direction === "right"
        ? "90deg"
        : direction === "down"
          ? "180deg"
          : direction === "left"
            ? "270deg"
            : "135deg";

  return (
    <div
      className="shape-grid-bg h-full w-full"
      style={
        {
          "--shape-grid-size": `${squareSize}px`,
          "--shape-grid-speed": `${Math.max(0.1, speed) * 28}s`,
          "--shape-grid-border": borderColor,
          "--shape-grid-hover": hoverFillColor,
          "--shape-grid-angle": angle,
        } as CSSProperties
      }
    />
  );
}

export default memo(ShapeGrid);
