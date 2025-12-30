import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className = "", ...props }: Props) {
  return (
    <input
      className={`w-full rounded-xl bg-[var(--glass-bg)] backdrop-blur-sm px-3.5 py-2.5 text-sm text-[var(--color-ink)] border border-[var(--glass-border)] placeholder:text-[var(--color-ink-subtle)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all duration-200 ${className}`}
      {...props}
    />
  );
}
