"use client";

import Link from "next/link";
import { StorageStatus } from "@/components/StorageStatus";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { usePersistedSettings } from "@/lib/storage/useStore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { settings } = usePersistedSettings();
  const language = settings?.language ?? "de";
  const pathname = usePathname();
  const primary = [
    ["/invoices", t(language, "nav.invoices")],
    ["/customers", t(language, "nav.customers")],
    ["/products", t(language, "nav.products")],
  ];
  const secondary = [
    ["/dashboard", t(language, "nav.dashboard")],
    ["/recurring", t(language, "nav.recurring")],
    ["/credit-notes", t(language, "nav.creditNotes")],
    ["/tags", t(language, "nav.tags")],
    ["/templates", t(language, "nav.templates")],
    ["/fachunternehmer", "Fachunternehmer"],
    ["/backup", t(language, "nav.backup")],
    ["/settings", t(language, "nav.settings")],
  ];
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const links = (items: string[][]) => items.map(([href, label]) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive(href) ? "page" : undefined}
      className={`navigation-link ${isActive(href) ? "navigation-link-active" : ""}`}
    >
      {label}
    </Link>
  ));

  return (
    <div className="min-h-dvh">
      <a className="skip-link" href="#app-content">
        {language === "de" ? "Zum Inhalt" : "Skip to content"}
      </a>
      <header className="app-topbar no-print">
        <Link href="/" className="text-lg font-semibold tracking-tight">Helferlein</Link>
        <StorageStatus />
      </header>
      <aside className="app-navigation no-print">
        <nav
          aria-label={language === "de" ? "Hauptnavigation" : "Main navigation"}
          className="space-y-1"
        >
          {links(primary)}
          <details
            key={pathname}
            open={secondary.some(([href]) => isActive(href)) || undefined}
            className="disclosure pt-5"
          >
            <summary className="navigation-link cursor-pointer text-(--color-ink-muted)">
              {language === "de" ? "Weitere Funktionen" : "More features"}
            </summary>
            <div className="mt-2 space-y-1">{links(secondary)}</div>
          </details>
        </nav>
      </aside>
      <div id="app-content" tabIndex={-1} className="app-content">
        {children}
      </div>
    </div>
  );
}
