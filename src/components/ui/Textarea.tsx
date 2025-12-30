import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className = "", ...props }: Props) {
  return (
    <textarea
      className={`w-full rounded-xl bg-white/70 backdrop-blur-sm px-3.5 py-2.5 text-sm text-[var(--color-ink)] border border-[var(--glass-border)] placeholder:text-[var(--color-ink-subtle)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all duration-200 resize-none ${className}`}
      {...props}
    />
  );
}
