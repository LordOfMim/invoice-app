import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-sm hover:shadow",
  secondary:
    "bg-white/70 text-[var(--color-ink)] border border-[var(--glass-border)] hover:bg-white/90 hover:border-[var(--color-sand-300)] backdrop-blur-sm",
  danger:
    "bg-white/70 text-[var(--color-danger)] border border-[var(--glass-border)] hover:bg-[var(--color-danger)]/10 hover:border-[var(--color-danger)]/30",
  ghost:
    "text-[var(--color-ink-muted)] hover:bg-white/50 hover:text-[var(--color-ink)]",
};

const sizes: Record<Size, string> = {
  sm: "rounded-lg px-2.5 py-1.5 text-xs gap-1.5",
  md: "rounded-xl px-3.5 py-2 text-sm gap-2",
  lg: "rounded-xl px-5 py-2.5 text-sm gap-2.5",
};

export function Button({ variant = "secondary", size = "md", className = "", ...props }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
