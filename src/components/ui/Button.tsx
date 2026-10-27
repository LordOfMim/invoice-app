import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { Button as PlatformButton, buttonVariants } from "@/components/platform/button";
import { IconButton as PlatformIconButton, iconButtonVariants } from "@/components/platform/icon-button";
import { cn } from "@/components/platform/lib/cn";

/**
 * Facade over the Platform `Button` (Overwatch `ui/button.tsx` recipe). `primary` (accent blue) is reserved for the
 * one executing action per view. Sizes follow the Helferlein readability profile (docs/design-reference.md,
 * deviation 2): `md` is the sanctioned 36px Platform `lg`, `sm` a 32px row action. Touch screens get 44px targets.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet" | "danger" | "dark";
export type ButtonSize = "sm" | "md";

const touchWrap = "touch:h-auto touch:py-1.5 touch:text-center touch:whitespace-normal";
const sizeClasses: Record<ButtonSize, string> = {
  sm: `h-8 px-3 text-base ${touchWrap} touch:min-h-10`,
  md: `${touchWrap} touch:min-h-11`,
};
const platformSize: Record<ButtonSize, "md" | "lg"> = { sm: "md", md: "lg" };

/**
 * Accessibility deviation (docs/design-reference.md, deviation 3): white text on accent-blue #5CABFF reaches only
 * about 2.4:1. The one blue action keeps the source hue but carries ink #1C1D1F (about 6.9:1).
 */
const primaryText = "text-ink";

export function buttonClasses({ variant = "secondary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(buttonVariants({ variant, size: platformSize[size] }), sizeClasses[size], variant === "primary" && primaryText, className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export function Button({ type = "button", variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return <PlatformButton type={type} variant={variant} size={platformSize[size]} className={cn(sizeClasses[size], variant === "primary" && primaryText, className)} {...props} />;
}

export type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; variant?: ButtonVariant; size?: ButtonSize };

/** Navigation that reads as an action ("Rechnung öffnen"). Plain navigation uses TextLink. */
export function LinkButton({ href, variant = "secondary", size = "md", className, ...props }: LinkButtonProps) {
  return <Link href={href} data-slot="button" className={buttonClasses({ variant, size, className })} {...props} />;
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; variant?: "outline" | "ghost" | "solid" };

/** Platform `IconButton` lg (38px); the visible content must be a glyph that the label names. */
export function iconButtonClasses({ variant = "outline", className }: { variant?: "outline" | "ghost" | "solid"; className?: string } = {}) {
  return cn(iconButtonVariants({ variant, size: "lg" }), "size-9 touch:size-11", className);
}

export function IconButton({ label, type = "button", variant = "outline", className, ...props }: IconButtonProps) {
  return <PlatformIconButton type={type} aria-label={label} title={label} variant={variant} size="lg" className={cn("size-9 touch:size-11", className)} {...props} />;
}
