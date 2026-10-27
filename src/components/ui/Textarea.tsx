import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className = "", ...props }: Props) {
  return (
    <textarea
      className={`min-h-11 w-full rounded-lg bg-[var(--glass-bg)] px-3.5 py-2.5 text-base text-[var(--color-ink)] border border-[var(--glass-border)] placeholder:text-[var(--color-ink-subtle)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-colors duration-150 resize-y ${className}`}
      {...props}
    />
  );
}
