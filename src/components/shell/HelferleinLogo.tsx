import Link from "next/link";
import { cn } from "@/components/platform/lib/cn";

/*
 * The user's supplied Helferlein logo, served byte-for-byte from `public/branding/helferlein-logo.png`. The PNG has a
 * wide transparent canvas (1672×941), so each SVG viewport only crops the rendering to the visible artwork: the full
 * wordmark from sm upwards, the H mark alone below sm so the path and save status keep their room at 320px.
 * The link carries the accessible name; the artwork is decorative.
 */

const LOGO_SRC = "/branding/helferlein-logo.png";

function LogoImage({ viewBox, className }: { viewBox: string; className: string }) {
  return (
    <svg viewBox={viewBox} aria-hidden="true" focusable="false" className={cn("block shrink-0", className)}>
      <image href={LOGO_SRC} x={0} y={0} width={1672} height={941} />
    </svg>
  );
}

export function HelferleinLogoLink({ className }: { className?: string }) {
  return (
    <Link
      href="/invoices"
      aria-label="Helferlein"
      className={cn("inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      <LogoImage viewBox="96 288 1498 370" className="h-7.5 w-30 max-sm:hidden" />
      <LogoImage viewBox="96 288 370 370" className="size-7 sm:hidden" />
    </Link>
  );
}
