import type { HTMLAttributes } from "react";
import { Badge } from "@/components/platform/badge";
import { StatusPill as PlatformStatusPill } from "@/components/platform/status-pill";
import { cn } from "@/components/platform/lib/cn";

/*
 * Status vocabulary after humaify-overwatch `src/components/ui/status.tsx`: always a word plus a tone dot
 * (Platform outline `StatusPill`), dashed mono badges for provisional states. Readability profile: 26px pill with
 * 13px label instead of 22px/11px (docs/design-reference.md, deviation 2).
 */
export type Tone = "success" | "attention" | "error" | "info" | "muted";
const pillTone = { success: "success", attention: "progress", error: "danger", info: "info", muted: "muted" } as const satisfies Record<Tone, "success" | "progress" | "info" | "muted" | "danger">;

export function StatusPill({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone: Tone }) {
  return <PlatformStatusPill variant="outline" tone={pillTone[tone]} className={cn("h-6.5 gap-2 px-2.5 text-base/4 whitespace-nowrap", className)} {...props} />;
}

/** Platform dashed stage badge (DRAFT recipe) for provisional or mode states, e.g. STANDARD. */
export function DashedBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <Badge variant="stage" className={cn("h-6.5 px-2 text-2xs", className)} {...props} />;
}

/** Quiet mono role badge (Platform `Badge` role) for fixed kinds, e.g. STORNO, GUTSCHRIFT. */
export function KindBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <Badge variant="role" className={cn("h-6.5 px-2 text-2xs", className)} {...props} />;
}
