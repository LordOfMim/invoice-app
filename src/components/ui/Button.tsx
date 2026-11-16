import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { Button as PlatformButton, buttonVariants } from "@/components/platform/button";
import { IconButton as PlatformIconButton, iconButtonVariants } from "@/components/platform/icon-button";
import { cn } from "@/components/platform/lib/cn";

/**
 * Facade over the button recipe. `primary` (near-black fill) is reserved for the one executing action per view.
 * `md` is Palermo's large control (38px), `sm` its regular one (28px) for row actions. Touch screens get 44px targets.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet" | "danger" | "dark";
export type ButtonSize = "sm" | "md";

const touchWrap = "touch:h-auto touch:py-1.5 touch:text-center touch:whitespace-normal";
const sizeClasses: Record<ButtonSize, string> = {
  sm: `text-base ${touchWrap} touch:min-h-10`,
  md: `${touchWrap} touch:min-h-11`,
};
const platformSize: Record<ButtonSize, "md" | "lg"> = { sm: "md", md: "lg" };


export function buttonClasses({ variant = "secondary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(buttonVariants({ variant, size: platformSize[size] }), sizeClasses[size], className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export function Button({ type = "button", variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return <PlatformButton type={type} variant={variant} size={platformSize[size]} className={cn(sizeClasses[size], className)} {...props} />;
}

export type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; variant?: ButtonVariant; size?: ButtonSize };

/** Navigation that reads as an action ("Rechnung öffnen"). Plain navigation uses TextLink. */
export function LinkButton({ href, variant = "secondary", size = "md", className, ...props }: LinkButtonProps) {
  return <Link href={href} data-slot="button" className={buttonClasses({ variant, size, className })} {...props} />;
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; variant?: "outline" | "ghost" | "solid" };

/** Icon button at the large control size (38px); the visible content must be a glyph that the label names. */
export function iconButtonClasses({ variant = "outline", className }: { variant?: "outline" | "ghost" | "solid"; className?: string } = {}) {
  return cn(iconButtonVariants({ variant, size: "lg" }), "size-9.5 touch:size-11", className);
}

export function IconButton({ label, type = "button", variant = "outline", className, ...props }: IconButtonProps) {
  return <PlatformIconButton type={type} aria-label={label} title={label} variant={variant} size="lg" className={cn("size-9.5 touch:size-11", className)} {...props} />;
}
