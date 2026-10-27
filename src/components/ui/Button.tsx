import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-sand-50)] disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
  secondary:
    "bg-[var(--glass-bg)] text-[var(--color-ink)] border border-[var(--glass-border)] hover:bg-[var(--glass-bg-solid)] hover:border-[var(--color-sand-400)]",
  danger:
    "bg-[var(--glass-bg)] text-[var(--color-danger)] border border-[var(--glass-border)] hover:bg-[var(--color-danger)]/10 hover:border-[var(--color-danger)]/30",
  ghost:
    "text-[var(--color-ink-muted)] hover:bg-[var(--glass-bg)] hover:text-[var(--color-ink)]",
};

const sizes: Record<Size, string> = {
  sm: "rounded-lg min-h-10 px-3 py-2 text-sm gap-1.5",
  md: "rounded-lg min-h-11 px-4 py-2.5 text-base gap-2",
  lg: "rounded-lg min-h-11 px-5 py-2.5 text-base gap-2.5",
};

export function Button({ variant = "secondary", size = "md", className = "", ...props }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
