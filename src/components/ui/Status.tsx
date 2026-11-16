import type { HTMLAttributes } from "react";
import { Badge } from "@/components/platform/badge";
import { StatusPill as PlatformStatusPill } from "@/components/platform/status-pill";
import { cn } from "@/components/platform/lib/cn";

/*
 * Status vocabulary after humaify-overwatch `src/components/ui/status.tsx`: always a word plus a tone dot
 * (Platform outline `StatusPill`), dashed badges for provisional states. Pills are 24px high with a 12px label.
 */
export type Tone = "success" | "attention" | "error" | "info" | "muted";
const pillTone = { success: "success", attention: "progress", error: "danger", info: "info", muted: "muted" } as const satisfies Record<Tone, "success" | "progress" | "info" | "muted" | "danger">;

export function StatusPill({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone: Tone }) {
  return <PlatformStatusPill variant="outline" tone={pillTone[tone]} className={cn("h-6 gap-1.5 px-2 text-sm/4 whitespace-nowrap", className)} {...props} />;
}

/** Dashed stage badge for provisional or mode states, e.g. Standard. */
export function DashedBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <Badge variant="stage" className={cn("whitespace-nowrap", className)} {...props} />;
}

/** Quiet role badge (Platform `Badge` role) for fixed kinds, e.g. Storno, Gutschrift. */
export function KindBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <Badge variant="role" className={cn("whitespace-nowrap", className)} {...props} />;
}
