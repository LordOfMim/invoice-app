import type { InputHTMLAttributes } from "react";
import { Input as PlatformInput } from "@/components/platform/input";
import { SearchField } from "@/components/platform/search-field";
import { cn } from "@/components/platform/lib/cn";

/**
 * Platform `Input` recipe at the Helferlein readability size (docs/design-reference.md, deviation 2): 40px high,
 * 14.5px text; 44px with 16px text on touch screens so iOS does not zoom (Overwatch `touch:` rule).
 */
export const controlSize = "h-10 text-lg touch:h-11 touch:text-2xl";

/** Shared Platform control recipe for the native textarea and select. */
export const controlClasses =
  "block w-full min-w-0 rounded-md border border-line-input bg-surface px-3 font-sans font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-disabled focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-[invalid=true]:border-danger";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export function Input({ className, type, ...props }: InputProps) {
  const numeric = ["number", "date", "month", "tel"].includes(type ?? "");
  const file = type === "file";
  return (
    <PlatformInput
      type={type}
      className={cn(
        controlSize,
        "aria-[invalid=true]:border-danger read-only:bg-surface-subtle read-only:text-ink-secondary",
        numeric && "tabular-nums",
        file && "h-auto py-2 text-base file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-line-control file:bg-surface file:px-3 file:font-sans file:text-base file:font-medium file:text-ink-secondary hover:file:bg-surface-subtle",
        className,
      )}
      {...props}
    />
  );
}

/** Platform `SearchField` at the control size; a live filter without submit. */
export function SearchInput({ className, ...props }: Omit<InputProps, "type">) {
  return <SearchField size="md" className={cn("h-10 touch:h-11 [&_input]:text-lg touch:[&_input]:text-2xl", className)} {...props} />;
}
