import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
};

const variants: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-sand-200)] text-[var(--color-ink-muted)]",
  success: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/15 text-[#8a7640]",
  danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  info: "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
};

export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

// Stat component for displaying metrics
type StatProps = {
  label: string;
  value: string | number;
  subtitle?: string;
  variant?: "default" | "success" | "warning" | "danger";
  icon?: ReactNode;
  trend?: {
    value: number;
    label?: string;
  };
};

const statVariants = {
  default: "bg-white/60",
  success: "bg-[var(--color-success)]/5 border-[var(--color-success)]/20",
  warning: "bg-[var(--color-warning)]/5 border-[var(--color-warning)]/20",
  danger: "bg-[var(--color-danger)]/5 border-[var(--color-danger)]/20",
};

export function Stat({ label, value, subtitle, variant = "default", icon, trend }: StatProps) {
  return (
    <div
      className={`rounded-2xl border border-[var(--glass-border)] backdrop-blur-sm p-5 ${statVariants[variant]}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-ink-subtle)]">{label}</p>
          <div className="space-y-1">
            <p className="text-2xl font-semibold text-[var(--color-ink)] tracking-tight">{value}</p>
            {subtitle && (
              <p className="text-xs text-[var(--color-ink-subtle)]">{subtitle}</p>
            )}
            {trend && (
              <div className="flex items-center gap-1">
                <span
                  className={`text-xs font-medium ${
                    trend.value >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                  }`}
                >
                  {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%
                </span>
                {trend.label && (
                  <span className="text-xs text-[var(--color-ink-subtle)]">{trend.label}</span>
                )}
              </div>
            )}
          </div>
        </div>
        {icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-sand-100)]">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// EmptyState component
type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-sand-100)]">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-[var(--color-ink)]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-[var(--color-ink-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// List item component for consistent list styling
type ListItemProps = {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
};

export function ListItem({ children, onClick, href, className = "" }: ListItemProps) {
  const baseClass = `flex items-center justify-between gap-4 rounded-xl p-3 transition-colors hover:bg-white/60 ${className}`;

  if (href) {
    return (
      <a href={href} className={baseClass}>
        {children}
      </a>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className={`${baseClass} w-full text-left`}>
        {children}
      </button>
    );
  }

  return <div className={baseClass}>{children}</div>;
}

// Alert banner component
type AlertProps = {
  variant?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
};

const alertVariants = {
  info: "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/20 text-[var(--color-accent)]",
  success: "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/10 border-[var(--color-warning)]/20 text-[#8a7640]",
  danger: "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/20 text-[var(--color-danger)]",
};

const alertIcons = {
  info: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  ),
  success: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
  danger: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  ),
};

export function Alert({ variant = "info", title, children, onDismiss }: AlertProps) {
  return (
    <div className={`rounded-xl border p-4 ${alertVariants[variant]}`}>
      <div className="flex gap-3">
        <div className="flex-shrink-0">{alertIcons[variant]}</div>
        <div className="flex-1 space-y-1">
          {title && <p className="text-sm font-medium">{title}</p>}
          <div className="text-sm opacity-90">{children}</div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
