import type { InputHTMLAttributes } from "react";
import { Input as PlatformInput } from "@/components/platform/input";
import { SearchField } from "@/components/platform/search-field";
import { cn } from "@/components/platform/lib/cn";

/**
 * Palermo control at its large size: 38px high, white with the control shadow as its edge, 14px text; 44px with 16px text on touch screens so iOS does not zoom (Overwatch `touch:` rule).
 */
export const controlSize = "h-9.5 text-lg touch:h-11 touch:text-2xl";

/**
 * Invalid fields carry a red ring. With keyboard focus the ring stays red and the focus colour moves to an outline
 * around it, so both states remain visible.
 */
const invalidClasses =
  "aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger aria-[invalid=true]:focus-visible:ring-danger aria-[invalid=true]:focus-visible:outline-solid aria-[invalid=true]:focus-visible:outline-2 aria-[invalid=true]:focus-visible:outline-offset-2 aria-[invalid=true]:focus-visible:outline-ring";

/** Shared control recipe for the native textarea and select. */
export const controlClasses =
  "block w-full min-w-0 rounded-md border-0 bg-surface px-2.5 font-sans text-ink shadow-control outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-ink-faint hover:bg-surface-muted focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 " + invalidClasses;

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export function Input({ className, type, ...props }: InputProps) {
  const numeric = ["number", "date", "month", "tel"].includes(type ?? "");
  const file = type === "file";
  return (
    <PlatformInput
      type={type}
      className={cn(
        controlSize,
        invalidClasses,
        "read-only:bg-surface-subtle read-only:text-ink-secondary",
        numeric && "tabular-nums",
        file && "h-auto py-2 text-base file:mr-3 file:h-8 file:cursor-pointer file:rounded-sm file:border-0 file:bg-surface-muted file:px-3 file:font-sans file:text-base file:font-medium file:text-ink-secondary hover:file:bg-surface-pressed",
        className,
      )}
      {...props}
    />
  );
}

/** Platform `SearchField` at the control size; a live filter without submit. */
export function SearchInput({ className, ...props }: Omit<InputProps, "type">) {
  return <SearchField size="md" className={cn("h-9.5 touch:h-11 [&_input]:text-lg touch:[&_input]:text-2xl", className)} {...props} />;
}
