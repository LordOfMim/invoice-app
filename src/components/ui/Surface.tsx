import type { ReactNode, HTMLAttributes } from "react";

type SurfaceVariant = "glass" | "solid" | "soft" | "outline";

type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  variant?: SurfaceVariant;
  padding?: "none" | "sm" | "md" | "lg";
  radius?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
};

const variants: Record<SurfaceVariant, string> = {
  glass:
    "bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] shadow-[var(--glass-shadow-sm)]",
  solid:
    "bg-[var(--glass-bg-solid)] backdrop-blur-sm border border-[var(--glass-border)] shadow-[var(--glass-shadow)]",
  soft:
    "bg-[var(--color-sand-100)]/70",
  outline:
    "border border-[var(--glass-border)]",
};

const paddings = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

const radiuses = {
  sm: "rounded-lg",
  md: "rounded-xl",
  lg: "rounded-2xl",
  xl: "rounded-3xl",
};

export function Surface({
  variant = "glass",
  padding = "md",
  radius = "lg",
  className = "",
  children,
  ...props
}: SurfaceProps) {
  return (
    <div
      className={`${variants[variant]} ${paddings[padding]} ${radiuses[radius]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

// Panel is an alias for Surface with solid variant
export function Panel({
  padding = "md",
  radius = "lg",
  className = "",
  children,
  ...props
}: Omit<SurfaceProps, "variant">) {
  return (
    <Surface variant="solid" padding={padding} radius={radius} className={className} {...props}>
      {children}
    </Surface>
  );
}

// Section component for grouping content with a title
type SectionProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, description, action, children, className = "" }: SectionProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            {title && (
              <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
            )}
            {description && (
              <p className="text-sm text-[var(--color-ink-subtle)]">{description}</p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// PageHeader component for consistent page titles
type PageHeaderProps = {
  title: string;
  subtitle?: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
};

export function PageHeader({ title, subtitle, description, actions, breadcrumb }: PageHeaderProps) {
  const descText = subtitle || description;
  return (
    <div className="space-y-3">
      {breadcrumb && <div className="text-sm text-[var(--color-ink-subtle)]">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{title}</h1>
          {descText && (
            <p className="text-sm text-[var(--color-ink-muted)]">{descText}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// Grid component for consistent layouts
type GridProps = {
  cols?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
  children: ReactNode;
  className?: string;
};

const gridCols = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

const gridGaps = {
  sm: "gap-3",
  md: "gap-4",
  lg: "gap-6",
};

export function Grid({ cols = 2, gap = "md", children, className = "" }: GridProps) {
  return (
    <div className={`grid ${gridCols[cols]} ${gridGaps[gap]} ${className}`}>
      {children}
    </div>
  );
}

// Stack component for vertical spacing
type StackProps = {
  gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
  children: ReactNode;
  className?: string;
};

const stackGaps = {
  none: "",
  xs: "space-y-1",
  sm: "space-y-2",
  md: "space-y-4",
  lg: "space-y-6",
  xl: "space-y-8",
};

export function Stack({ gap = "md", children, className = "" }: StackProps) {
  return <div className={`${stackGaps[gap]} ${className}`}>{children}</div>;
}

// Divider component
export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px bg-[var(--glass-border)] ${className}`} />;
}
