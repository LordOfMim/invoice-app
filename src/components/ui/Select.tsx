import type { SelectHTMLAttributes } from "react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/platform/icon";
import { cn } from "@/components/platform/lib/cn";
import { controlClasses, controlSize } from "./Input";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Platform `NativeSelect` recipe (Overwatch `ui/forms.tsx`): the Input surface with a trailing chevron. The chevron
 * is the Hugeicons ArrowDown01Icon through the Platform wrapper.
 */
export function Select({ className, ...props }: Props) {
  return (
    <span className={cn("relative block min-w-0", className)}>
      <select className={cn(controlClasses, controlSize, "appearance-none pr-9")} {...props} />
      <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-soft" />
    </span>
  );
}
