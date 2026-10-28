import * as React from "react";
import {
  HugeiconsIcon as HugeiconsIconBase,
  type HugeiconsIconProps,
  type IconSvgElement,
} from "@hugeicons/react";

/*
 * Preconfigured Hugeicons wrapper — use exactly like the upstream component:
 *
 *   <HugeiconsIcon icon={Settings02Icon} />
 *
 * Stroke weights match the Paper design ("Hugeicons Stroke Rounded"):
 * at ≥15px Paper renders the family's native 1.5 stroke; below 15px it
 * thickens glyphs with a +0.4px text-stroke for legibility. Converted to
 * the 24-grid SVG that is strokeWidth = 1.5 + 0.4 · 24/size. The wrapper
 * derives this automatically from `size` — only set `size`, never
 * `strokeWidth`.
 */
function paperStrokeWidth(size: number | string): number {
  const n = typeof size === "number" ? size : Number.parseFloat(size);
  if (!Number.isFinite(n) || n >= 15) return 1.5;
  return +(1.5 + 9.6 / n).toFixed(2);
}

export function Icon({
  size = 16,
  strokeWidth,
  ...props
}: HugeiconsIconProps) {
  return (
    <HugeiconsIconBase
      size={size}
      strokeWidth={strokeWidth ?? paperStrokeWidth(size)}
      {...props}
    />
  );
}

export { Icon as HugeiconsIcon };
export type { HugeiconsIconProps, IconSvgElement };
