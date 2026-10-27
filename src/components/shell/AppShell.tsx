"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BreadcrumbChevron, BreadcrumbLink } from "@/components/platform/breadcrumb";
import { HugeiconsIcon } from "@/components/platform/icon";
import { cn } from "@/components/platform/lib/cn";
import { TopBar } from "@/components/platform/top-bar";
import { StorageStatus } from "@/components/StorageStatus";
import { usePersistedSettings } from "@/lib/storage/useStore";
import { locate, navGroups, type NavGroup, type NavItem } from "./nav";
import { MobileNav } from "./MobileNav";

/*
 * Helferlein frame (docs/design-reference.md, „Navigations- und Seitenkonzept“): a left sidebar with the grouped
 * navigation from lg upwards, next to it the sticky 52px TopBar (path, save status) and the page. The sidebar uses
 * the page-list recipe of Platform `line-shell-frame.tsx` (15px Hugeicons glyph + word label, active row on
 * surface-muted, semibold ink) at the readability size, on the rail surface with a hairline. It is as tall as the
 * window and scrolls by itself, so every entry stays reachable on short windows. Below lg the sidebar gives way to
 * the labelled menu row with a sheet (MobileNav). No emblem, account menu or environment badge.
 */

const CrumbContext = createContext<(label: string | null) => void>(() => {});

/** Lets an object page name itself as the last breadcrumb segment (e.g. the invoice number). */
export function usePageCrumb(label: string | null) {
  const setLabel = useContext(CrumbContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}

function SidebarLink({ item, current, exact }: { item: NavItem; current: boolean; exact: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.hint}
      // Detail pages keep their list entry marked: „page“ on the list itself, „true“ below it.
      aria-current={current ? (exact ? "page" : "true") : undefined}
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-2 font-sans text-lg/5 tracking-snug outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        current ? "bg-surface-muted font-semibold text-ink" : "font-medium text-ink-secondary hover:bg-surface-muted hover:text-ink",
      )}
    >
      <HugeiconsIcon icon={item.icon} size={16} className={cn("shrink-0", current ? "text-ink" : "text-ink-body")} />
      <span className="min-w-0 hyphens-auto wrap-anywhere">{item.label}</span>
    </Link>
  );
}

function Sidebar({ groups, active, pathname, label }: { groups: readonly NavGroup[]; active?: NavItem; pathname: string; label: string }) {
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface-rail lg:flex">
      <div className="flex h-13 shrink-0 items-center border-b border-line px-5">
        <Link href="/invoices" className="rounded-sm font-sans text-lg font-semibold tracking-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          Helferlein
        </Link>
      </div>
      <nav aria-label={label} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            {group.label && <p id={`sidebar-group-${group.key}`} className="px-2.5 pb-1 font-sans text-base font-medium tracking-snug text-ink-body">{group.label}</p>}
            <ul aria-labelledby={group.label ? `sidebar-group-${group.key}` : undefined} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <SidebarLink item={item} current={active?.key === item.key} exact={pathname === item.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { settings } = usePersistedSettings();
  const language = settings?.language ?? "de";
  const pathname = usePathname() ?? "";
  const [objectLabel, setObjectLabel] = useState<string | null>(null);
  const groups = useMemo(() => navGroups(language), [language]);
  const { group, item } = locate(groups, pathname);
  const atItem = item ? pathname === item.href : false;

  const crumbs: { label: string; href?: string }[] = [];
  if (item) crumbs.push({ label: item.label, href: item.href });
  if (objectLabel && !atItem) crumbs.push({ label: objectLabel });

  const de = language === "de";
  return (
    <CrumbContext.Provider value={setObjectLabel}>
      <div className="app-frame flex min-h-dvh bg-surface">
        <a
          href="#inhalt"
          className="no-print sr-only rounded-md bg-surface px-3 py-2 font-sans text-base font-medium text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-line-strong"
        >
          {de ? "Zum Inhalt springen" : "Skip to content"}
        </a>
        <Sidebar groups={groups} active={item} pathname={pathname} label={de ? "Hauptnavigation" : "Main navigation"} />
        <div className="app-main-column flex min-w-0 flex-1 flex-col">
          <TopBar className="no-print h-13 px-4 sm:px-6" contentClassName="max-w-[1600px] gap-3" actions={<StorageStatus language={language} />}>
            <nav aria-label={de ? "Pfad" : "Breadcrumb"} className="flex min-w-0 items-center gap-2.5">
              {/* The product name lives in the sidebar from lg upwards. */}
              <Link href="/invoices" className="shrink-0 rounded-sm font-sans text-lg font-semibold tracking-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:hidden">
                Helferlein
              </Link>
              {crumbs.length > 0 && (
                <ol className="flex min-w-0 items-center gap-2.5">
                  {crumbs.map((crumb, index) => {
                    const current = index === crumbs.length - 1;
                    return (
                      <li key={`${crumb.label}-${index}`} className={cn("flex min-w-0 items-center gap-2.5", !current && "shrink-[2]")}>
                        <BreadcrumbChevron className={index === 0 ? "lg:hidden" : undefined} />
                        {crumb.href && !current
                          ? <BreadcrumbLink asChild className="max-w-60 text-lg/5"><Link href={crumb.href} title={crumb.label}>{crumb.label}</Link></BreadcrumbLink>
                          : <BreadcrumbLink asChild current className="cursor-default text-lg/5 hover:bg-transparent active:scale-100"><span title={crumb.label}>{crumb.label}</span></BreadcrumbLink>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </nav>
          </TopBar>
          <MobileNav key={pathname} groups={groups} group={group} item={item} title={de ? "Navigation" : "Navigation"} closeLabel={de ? "Schließen" : "Close"} openLabel={de ? "Navigation öffnen" : "Open navigation"} currentLabel={de ? "aktuell" : "current"} menuLabel={de ? "Menü" : "Menu"} />
          <main id="inhalt" tabIndex={-1} className="app-main flex w-full grow flex-col items-center px-4 pt-6 pb-20 outline-none sm:px-6">
            <div className="app-page-wrapper flex w-full max-w-[1600px] flex-col">{children}</div>
          </main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}
